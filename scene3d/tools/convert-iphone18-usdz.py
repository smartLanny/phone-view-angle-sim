#!/usr/bin/env python3
"""
苹果官网 iPhone 18 Pro AR 模型（iphone-18-pro-e-sim.usdz，© Apple）→ 网页用的 iphone18pm.glb（等比放大成 Pro Max）。

不依赖 USD 库：用同目录的 usdc_reader.py 直接读 USDC，按 USD 的组合规则在各层之间取值
（顶层本地意见 → 手机上的颜色变体 → 根上的颜色变体 → payload）。

- 文件里有两台一样的手机（AR 展示用），只取第一台；屏幕网格（壁纸自发光贴图）不要，网页自己画屏幕。
- 坐标换成手机局部坐标：x 右、y 上、z 指向屏幕外，原点在屏幕玻璃正面、显示区中心，单位米。
  原文件单位厘米、Y 向上、屏幕朝 −z，相当于绕 y 转 180°。
- 放大成 Pro Max：长、宽分别按官方 163.4 / 78.0 mm 放大（原模型机身 149.96 × 71.78 mm，约 ×1.09），
  厚度不变（两款都是 8.75 mm）。
- 四种颜色（Burgundy 酒红 / Glacier 冰川 / Silver 银 / Black 黑）写成 KHR_materials_variants，默认 Burgundy（与原文件一致）。
- 材质 UsdPreviewSurface → glTF 金属度 / 粗糙度：
  底色贴图原样用（原文件只取 rgb，带 alpha 的去掉 alpha）；粗糙度、金属度的单通道贴图打包进 glTF 的 G / B 通道；
  法线贴图（scale 2、bias −1，切线空间 +Y）原样用；遮蔽贴图取 R 通道原样用；贴图按原 UV 组（st / st1）挂 texCoord 0 / 1；
  opacity < 1 → BLEND；clearcoat → KHR_materials_clearcoat；UsdPreviewSurface 没写的输入按其默认值。
- 网格单面（原文件没写 doubleSided，USD 默认单面）；法线为原文件的 faceVarying 法线，随缩放按逆转置变换。

依赖 numpy、Pillow。用法（在 scene3d 目录下）：

    python3 tools/convert-iphone18-usdz.py /path/to/iphone-18-pro-e-sim.usdz public/models/iphone18pm.glb
    node tools/embed-phone18.mjs

运行结束会打印量出的显示区、灵动岛等数据（填进 web/devices.js 与 src/phone/devices.ts）。USDZ 本身不进仓库。
"""
import io, json, re, struct, sys, zipfile
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from usdc_reader import Crate

ROOT = '/KvFiGLnoDCgrTiu'                                 # defaultPrim，带 Color 变体集
PHONE = ROOT + '/xYOCLbDjKmKlJoU/UBGArkKGrAMRRnj'           # 第一台手机（自己也有 Color 变体集，由根变体选）
VARIANTS = ['Burgundy', 'Glacier', 'Silver', 'Black']     # 网页颜色顺序；第一项为默认
TARGET_W, TARGET_H = 78.0, 163.4                          # iPhone 18 Pro Max 官方长宽（mm）
FRAME_MESH = 'tOqBbRZfYgrynTi'                            # 中框：取它的外轮廓当机身长宽
PREVIEW_DEFAULTS = {'diffuseColor': (0.18, 0.18, 0.18), 'metallic': 0.0, 'roughness': 0.5, 'opacity': 1.0,
                    'opacityThreshold': 0.0, 'clearcoat': 0.0, 'clearcoatRoughness': 0.01, 'occlusion': 1.0,
                    'emissiveColor': (0.0, 0.0, 0.0)}
WRAP = {'repeat': 10497, 'clamp': 33071, 'mirror': 33648}
strip_variants = lambda p: re.sub(r'\{[^}]*\}', '', p)


class Stage:
    """某个颜色变体下的组合视图：按强弱顺序在几个“位置”上查同一个属性。"""

    def __init__(self, top, payload, color):
        self.top, self.payload, self.color = top, payload, color
        sel = top.get(ROOT + '{Color=%s}' % color + PHONE[len(ROOT):], 'variantSelection')
        self.inner = sel['Color']                         # 手机上的变体名（Burgundy → HhzOJovMXzyEbwB 等）

    def sites(self, p):
        out = [(self.top, p)]                             # 顶层本地意见（覆盖了所有网格的点、法线）
        if p == PHONE or p.startswith((PHONE + '/', PHONE + '.')):
            out.append((self.top, PHONE + '{Color=%s}' % self.inner + p[len(PHONE):]))   # 材质参数
        if p.startswith((ROOT + '/', ROOT + '.')):
            out.append((self.top, ROOT + '{Color=%s}' % self.color + p[len(ROOT):]))     # 只写了变体选择
        out.append((self.payload, p))                     # payload：几何、UV、材质网络
        return out

    def field(self, p, f):
        for layer, q in self.sites(p):
            s = layer.specs.get(q)
            if s and f in s[1]: return layer.value(s[1][f])
        return None

    def attr(self, p, name): return self.field(p + '.' + name, 'default')

    def target(self, p, name, kind='connectionPaths'):
        v = self.field(p + '.' + name, kind)
        if not v: return None
        lst = v.get('explicit') or v.get('prepended') or v.get('added') or v.get('appended')
        return strip_variants(lst[0]) if lst else None

    def prims(self, under):
        out = set()
        for layer in (self.top, self.payload):
            for q, (t, _) in layer.specs.items():
                q = strip_variants(q)
                if t == 6 and q.startswith(under + '/'): out.add(q)
        return sorted(out)

    # ---- 变换 ----
    def local(self, p):
        M = np.eye(4)
        for op in self.attr(p, 'xformOpOrder') or []:
            M = M @ op_matrix(self, p, op)
        return M

    def world(self, p):
        parts = p.strip('/').split('/'); M = np.eye(4)
        for k in range(1, len(parts) + 1): M = M @ self.local('/' + '/'.join(parts[:k]))
        return M


def _rot(axis, deg):
    a = np.radians(deg); c, s = np.cos(a), np.sin(a)
    return {'X': np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), 'Y': np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            'Z': np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[axis]


def op_matrix(S, p, opname):
    inv = opname.startswith('!invert!'); name = opname.replace('!invert!', '')
    v = S.attr(p, name); kind = name.split(':')[1]; M = np.eye(4)
    if v is None: raise ValueError('缺少 ' + p + '.' + name)
    if kind == 'translate': M[:3, 3] = np.array(v, float)
    elif kind == 'scale': M[:3, :3] = np.diag(np.array(v, float) if np.ndim(v) else [float(v)] * 3)
    elif kind in ('rotateX', 'rotateY', 'rotateZ'): M[:3, :3] = _rot(kind[-1], float(v))
    elif kind.startswith('rotate') and len(kind) == 9:    # rotateXYZ 等：按名字里的顺序依次转（列向量：R = Rz·Ry·Rx）
        R = np.eye(3)
        for ax, ang in zip(kind[6:], np.array(v, float)): R = _rot(ax, ang) @ R
        M[:3, :3] = R
    elif kind == 'transform': M = np.array(v, float).reshape(4, 4).T
    else: raise ValueError('不支持的变换 ' + name)
    return np.linalg.inv(M) if inv else M


# ---------------- 材质 ----------------
def shader_inputs(S, mat):
    """材质 → {输入名: 常量 或 ('tex', 输出通道, 贴图参数)}；连了贴图时忽略输入上的默认值（与 USD 一致）。"""
    surf = S.target(mat, 'outputs:surface')
    sh = surf.split('.')[0]
    assert S.attr(sh, 'info:id') == 'UsdPreviewSurface', mat
    out = {}
    for inp in list(PREVIEW_DEFAULTS) + ['normal', 'ior', 'useSpecularWorkflow']:
        c = S.target(sh, 'inputs:' + inp)
        if c:
            node = c.split('.')[0]
            assert S.attr(node, 'info:id') == 'UsdUVTexture', (mat, inp)
            t = {k: S.attr(node, 'inputs:' + k) for k in ('file', 'scale', 'bias', 'wrapS', 'wrapT', 'sourceColorSpace')}
            t['file'] = str(t['file']).split('/')[-1]
            st = S.target(node, 'inputs:st')
            rd = st.split('.')[0] if st else None
            t['uv'] = 1 if rd and S.attr(rd, 'inputs:varname') == 'st1' else 0
            out[inp] = ('tex', c.split(':')[-1], t)
        else:
            v = S.attr(sh, 'inputs:' + inp)
            out[inp] = v if v is not None else PREVIEW_DEFAULTS.get(inp)
    assert not out.get('useSpecularWorkflow'), mat
    return out


is_tex = lambda v: isinstance(v, tuple) and len(v) == 3 and v[0] == 'tex'


class Builder:
    def __init__(self, files):
        self.files = files                                 # 贴图文件名 → bytes
        self.bin = bytearray()
        self.j = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
                  'materials': [], 'textures': [], 'images': [], 'samplers': [], 'accessors': [], 'bufferViews': [],
                  'buffers': [{'byteLength': 0}], 'extensionsUsed': []}
        self.tex_cache, self.img_cache, self.sampler_cache, self.mat_cache = {}, {}, {}, {}

    def view(self, data, target=None):
        while len(self.bin) % 4: self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target: v['target'] = target
        self.bin.extend(data); self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, arr, kind, target):
        arr = np.ascontiguousarray(arr)
        comp = {np.dtype('float32'): 5126, np.dtype('uint32'): 5125, np.dtype('uint16'): 5123}[arr.dtype]
        a = {'bufferView': self.view(arr.tobytes(), target), 'componentType': comp, 'count': len(arr), 'type': kind}
        if kind == 'VEC3' and comp == 5126: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def image(self, data, mime):
        key = (mime, bytes(data))
        if key not in self.img_cache:
            self.j['images'].append({'bufferView': self.view(data), 'mimeType': mime})
            self.img_cache[key] = len(self.j['images']) - 1
        return self.img_cache[key]

    def sampler(self, ws, wt):
        key = (WRAP.get(ws or 'repeat', 10497), WRAP.get(wt or 'repeat', 10497))
        if key not in self.sampler_cache:
            self.j['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': key[0], 'wrapT': key[1]})
            self.sampler_cache[key] = len(self.j['samplers']) - 1
        return self.sampler_cache[key]

    def texture(self, key, make, t):
        """key：内容标识（同样的源图 + 处理方式只放一次）；make() → (bytes, mime)"""
        key = key + (t.get('wrapS'), t.get('wrapT'))
        if key not in self.tex_cache:
            data, mime = make()
            self.j['textures'].append({'source': self.image(data, mime), 'sampler': self.sampler(t.get('wrapS'), t.get('wrapT'))})
            self.tex_cache[key] = len(self.j['textures']) - 1
        return self.tex_cache[key]

    # ---- 各用途的贴图 ----
    def src(self, name):
        data = self.files[name]
        return data, ('image/jpeg' if data[:3] == b'\xff\xd8\xff' else 'image/png')

    def color_tex(self, t):
        assert t['sourceColorSpace'] in ('sRGB', None, 'auto'), t
        def make():
            data, mime = self.src(t['file'])
            im = Image.open(io.BytesIO(data))
            if im.mode in ('RGBA', 'LA', 'PA') or 'transparency' in im.info:
                a = np.asarray(im.convert('RGBA'))[..., 3]
                if a.min() < 255:                          # 原材质只接 rgb 输出：alpha 不参与，去掉以免被当成透明度
                    return png(im.convert('RGB')), 'image/png'
            return data, mime
        return self.texture(('color', t['file']), make, t)

    def raw_tex(self, t, channel, role):
        """单通道数据贴图（遮蔽）：glTF 取 R，原文件也接 r 输出时直接用原图"""
        assert t['sourceColorSpace'] in ('raw', None), t
        if channel == 'r': return self.texture((role, t['file']), lambda: self.src(t['file']), t)
        return self.texture((role, t['file'], channel), lambda: (png(Image.fromarray(chan(self.files[t['file']], channel))), 'image/png'), t)

    def mr_tex(self, rough, metal):
        """粗糙度 / 金属度贴图打包：G = 粗糙度，B = 金属度；没有贴图的那一项填 1，由材质常量因子给值"""
        srcs = [x for x in (rough, metal) if x]
        for _, _, t in srcs: assert t['sourceColorSpace'] in ('raw', None), t
        t0 = srcs[0][2]
        def make():
            chans = {k: chan(self.files[v[2]['file']], v[1]) for k, v in (('g', rough), ('b', metal)) if v}
            size = max(max(c.shape) for c in chans.values())
            fit = lambda c: c if c.shape == (size, size) else np.asarray(Image.fromarray(c).resize((size, size), Image.LANCZOS))
            full = np.full((size, size), 255, np.uint8)
            rgb = np.dstack([full, fit(chans['g']) if 'g' in chans else full, fit(chans['b']) if 'b' in chans else full])
            return png(Image.fromarray(rgb)), 'image/png'      # 无损：常量通道必须保持 255
        key = ('mr', rough and (rough[2]['file'], rough[1]), metal and (metal[2]['file'], metal[1]))
        return self.texture(key, make, t0), t0['uv']

    def normal_tex(self, t):
        assert list(map(float, t['scale'] or [2, 2, 2, 1]))[:3] == [2, 2, 2] and list(map(float, t['bias'] or [-1, -1, -1, 0]))[:3] == [-1, -1, -1], t
        return self.texture(('normal', t['file']), lambda: self.src(t['file']), t)

    # ---- 材质 ----
    def material(self, name, d):
        m = {'name': name}
        pbr = m['pbrMetallicRoughness'] = {}
        ref = lambda idx, t: {'index': idx, **({'texCoord': 1} if t['uv'] else {})}
        dc, op = d['diffuseColor'], d['opacity']
        assert not is_tex(op), name                        # 这份文件里透明度都是常量
        if is_tex(dc):
            assert dc[1] == 'rgb', name
            t = dc[2]; sc = t.get('scale')
            pbr['baseColorTexture'] = ref(self.color_tex(t), t)
            assert not t.get('bias'), name
            fac = [float(x) for x in sc[:3]] if sc is not None else [1.0, 1.0, 1.0]
        else:
            fac = [float(x) for x in dc]
        pbr['baseColorFactor'] = fac + [float(op)]
        ro, me = d['roughness'], d['metallic']
        if is_tex(ro) or is_tex(me):
            idx, uv = self.mr_tex(ro if is_tex(ro) else None, me if is_tex(me) else None)
            for x in (ro, me):
                if is_tex(x): assert x[2]['uv'] == uv and not x[2].get('scale') and not x[2].get('bias'), name
            pbr['metallicRoughnessTexture'] = {'index': idx, **({'texCoord': 1} if uv else {})}
        pbr['metallicFactor'] = 1.0 if is_tex(me) else float(me)
        pbr['roughnessFactor'] = 1.0 if is_tex(ro) else float(ro)
        if is_tex(d.get('normal')):
            m['normalTexture'] = ref(self.normal_tex(d['normal'][2]), d['normal'][2])
        oc = d['occlusion']
        if is_tex(oc):
            assert not oc[2].get('scale') and not oc[2].get('bias'), name
            m['occlusionTexture'] = ref(self.raw_tex(oc[2], oc[1], 'ao'), oc[2])
        else: assert float(oc) == 1.0, name
        em = d['emissiveColor']
        assert not is_tex(em), name
        if any(float(x) > 0 for x in em): m['emissiveFactor'] = [float(x) for x in em]
        cc = float(d['clearcoat'])
        if cc > 0:
            m['extensions'] = {'KHR_materials_clearcoat': {'clearcoatFactor': cc, 'clearcoatRoughnessFactor': float(d['clearcoatRoughness'])}}
            if 'KHR_materials_clearcoat' not in self.j['extensionsUsed']: self.j['extensionsUsed'].append('KHR_materials_clearcoat')
        if float(d['opacityThreshold']) > 0:
            m['alphaMode'] = 'MASK'; m['alphaCutoff'] = float(d['opacityThreshold'])
        elif float(op) < 1:
            m['alphaMode'] = 'BLEND'
        key = json.dumps({k: v for k, v in m.items() if k != 'name'}, sort_keys=True)
        if key not in self.mat_cache:
            self.j['materials'].append(m)
            self.mat_cache[key] = len(self.j['materials']) - 1
        return self.mat_cache[key]

    def finish(self, out_path):
        while len(self.bin) % 4: self.bin.append(0)
        self.j['buffers'][0]['byteLength'] = len(self.bin)
        if not self.j['extensionsUsed']: del self.j['extensionsUsed']
        js = json.dumps(self.j, separators=(',', ':'), ensure_ascii=False).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin))
        out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin)
        Path(out_path).write_bytes(out)
        return len(out)


def png(im):
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True); return buf.getvalue()


def chan(data, channel):
    im = Image.open(io.BytesIO(data))
    if im.mode == 'L': return np.asarray(im)              # 灰度图：r = g = b
    return np.asarray(im.convert('RGBA'))[..., 'rgba'.index(channel)]


# ---------------- 几何 ----------------
def corner_index(S, mesh, name, fvc, fvi):
    """primvar 每个面角对应的取值下标（按 interpolation 和 indices 展开）"""
    vals = S.attr(mesh, name)
    if vals is None: return None, None
    interp = S.field(mesh + '.' + name, 'interpolation') or ('vertex' if name in ('normals', 'points') else 'constant')
    ind = S.attr(mesh, name + ':indices')
    n = int(fvc.sum())
    if interp == 'faceVarying': idx = np.arange(n)
    elif interp in ('vertex', 'varying'): idx = fvi
    elif interp == 'uniform': idx = np.repeat(np.arange(len(fvc)), fvc)
    else: idx = np.zeros(n, int)
    if ind is not None and len(ind): idx = np.asarray(ind, np.int64)[idx]
    return np.asarray(vals, np.float64).reshape(len(vals), -1), idx


def main(usdz_path, out_path):
    z = zipfile.ZipFile(usdz_path)
    layers = [n for n in z.namelist() if n.endswith('.usdc')]
    assert len(layers) == 2, layers                       # 第一个是根层（USDZ 规定），另一个是 payload
    top, payload = Crate(z.read(layers[0])), Crate(z.read(layers[1]))
    files = {n.split('/')[-1]: z.read(n) for n in z.namelist() if n.lower().endswith(('.png', '.jpg', '.jpeg'))}
    stages = {c: Stage(top, payload, c) for c in VARIANTS}
    S = stages[VARIANTS[0]]
    meshes = [p for p in S.prims(PHONE) if S.field(p, 'typeName') == 'Mesh' and S.field(p, 'active') not in (False, 0)]

    # 屏幕：材质的自发光接了贴图（壁纸）的那块网格
    def is_display(m):
        sh = S.target(S.target(m, 'material:binding', 'targetPaths'), 'outputs:surface').split('.')[0]
        return S.target(sh, 'inputs:emissiveColor') is not None
    display = [m for m in meshes if is_display(m)]
    assert len(display) == 1, display
    meshes.remove(display[0])

    def world_points(m):
        P = np.asarray(S.attr(m, 'points'), np.float64) * 10   # 厘米 → 毫米
        W = S.world(m); W[:3, 3] *= 10
        return P @ W[:3, :3].T + W[:3, 3], W
    frame = [m for m in meshes if m.endswith('/' + FRAME_MESH)][0]
    F, _ = world_points(frame)
    D, _ = world_points(display[0])
    zf = min(world_points(m)[0][:, 2].min() for m in meshes)          # 正面玻璃（屏幕朝 −z）
    c = np.array([(D[:, 0].min() + D[:, 0].max()) / 2, (D[:, 1].min() + D[:, 1].max()) / 2, zf])
    W0, H0 = F[:, 0].max() - F[:, 0].min(), F[:, 1].max() - F[:, 1].min()
    kx, ky = TARGET_W / W0, TARGET_H / H0
    A = np.diag([-kx, ky, -1.0]) / 1000                  # 绕 y 转 180° + 放大，毫米 → 米；行列式为正，三角形绕序不变

    B = Builder(files)
    B.j['asset'].update({'generator': 'phone-view-angle-sim tools/convert-iphone18-usdz.py', 'copyright': '© Apple Inc.',
                         'extras': {'source': 'Apple iPhone 18 Pro AR model (iphone-18-pro-e-sim.usdz, apple.com)',
                                    'scaleXY': [kx, ky], 'note': 'iPhone 18 Pro scaled to the iPhone 18 Pro Max body size'}})
    B.j['extensions'] = {'KHR_materials_variants': {'variants': [{'name': v} for v in VARIANTS]}}
    B.j['extensionsUsed'].append('KHR_materials_variants')
    mat_desc = {}
    stats = {'verts': 0, 'tris': 0}
    for m in meshes:
        name = m.split('/')[-1]
        fvc = np.asarray(S.attr(m, 'faceVertexCounts'), np.int64)
        fvi = np.asarray(S.attr(m, 'faceVertexIndices'), np.int64)
        assert (S.attr(m, 'orientation') or 'rightHanded') == 'rightHanded' and (S.attr(m, 'subdivisionScheme') or 'none') == 'none', m
        Pw, W = world_points(m)
        L = A @ W[:3, :3]
        assert np.linalg.det(L) > 0, m
        pos = (Pw - c) @ A.T
        nv, ni = corner_index(S, m, 'primvars:normals', fvc, fvi)
        if nv is None: nv, ni = corner_index(S, m, 'normals', fvc, fvi)
        assert nv is not None, m
        nrm = nv @ np.linalg.inv(L).T
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
        cols = [fvi, ni]; uvs = []
        for pv in ('primvars:st', 'primvars:st1'):
            v, i = corner_index(S, m, pv, fvc, fvi)
            uvs.append((v, i))
            if v is not None: cols.append(i)
        key = np.stack(cols, 1)
        uniq, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        attrs = {'POSITION': B.accessor(pos[uniq[:, 0]].astype(np.float32), 'VEC3', 34962),
                 'NORMAL': B.accessor(nrm[uniq[:, 1]].astype(np.float32), 'VEC3', 34962)}
        k = 2
        for slot, (v, i) in enumerate(uvs):
            if v is None: continue
            uv = v[uniq[:, k]].copy(); uv[:, 1] = 1 - uv[:, 1]; k += 1   # USD 的 v 轴向上，glTF 向下
            attrs['TEXCOORD_%d' % slot] = B.accessor(uv.astype(np.float32), 'VEC2', 34962)
        starts = np.concatenate([[0], np.cumsum(fvc)[:-1]])
        tris = [np.stack([starts, starts + j, starts + j + 1], 1)[fvc > j + 1] for j in range(1, fvc.max() - 1)]   # 扇形三角化
        tri = inv[np.concatenate(tris)].reshape(-1)
        idx = tri.astype(np.uint16 if len(uniq) < 65536 else np.uint32)
        # 材质：四种颜色各算一遍，相同的合并
        mat = S.target(m, 'material:binding', 'targetPaths')
        per = []
        for v in VARIANTS:
            St = stages[v]
            assert St.target(m, 'material:binding', 'targetPaths') == mat, m
            d = mat_desc.setdefault((mat, v), shader_inputs(St, mat))
            per.append(B.material(mat.split('/')[-1] + ('' if v == VARIANTS[0] else '_' + v), d))
        prim = {'attributes': attrs, 'indices': B.accessor(idx, 'SCALAR', 34963), 'material': per[0], 'mode': 4}
        if len(set(per)) > 1:
            groups = {}
            for vi, mi in enumerate(per): groups.setdefault(mi, []).append(vi)
            prim['extensions'] = {'KHR_materials_variants': {'mappings': [{'material': mi, 'variants': vs} for mi, vs in groups.items()]}}
        B.j['meshes'].append({'name': name, 'primitives': [prim]})
        B.j['nodes'].append({'name': name, 'mesh': len(B.j['meshes']) - 1})
        B.j['scenes'][0]['nodes'].append(len(B.j['nodes']) - 1)
        stats['verts'] += len(uniq); stats['tris'] += len(idx) // 3
    size = B.finish(out_path)

    # ---- 测量（原模型尺寸，毫米）：用显示区网格的边界轮廓 ----
    fvc = np.asarray(S.attr(display[0], 'faceVertexCounts'), np.int64)
    fvi = np.asarray(S.attr(display[0], 'faceVertexIndices'), np.int64)
    starts = np.concatenate([[0], np.cumsum(fvc)[:-1]])
    edges = {}
    for s0, n in zip(starts, fvc):
        f = fvi[s0:s0 + n]
        for a, b in zip(f, np.roll(f, -1)): edges[tuple(sorted((a, b)))] = edges.get(tuple(sorted((a, b))), 0) + 1
    rim = sorted({v for e, k in edges.items() if k == 1 for v in e})
    dx, dy = D[rim, 0] - c[0], D[rim, 1] - c[1]
    half = [dx.max(), dy.max()]
    hole = (np.abs(dx) < 12) & (dy > half[1] - 12) & (dy < half[1] - 0.05)   # 顶部中间、不在顶边上的边界点 = 灵动岛开孔
    outer = ~hole
    # 圆角：原文件是连续曲率的圆角（从边上约 13 mm 处开始弯），换算成等效圆角——
    # 对角线方向上轮廓离两条边的距离 d 与半径 R 的圆角相同：d = R·(1 − 1/√2)
    ox, oy = half[0] - np.abs(dx[outer]), half[1] - np.abs(dy[outer])
    near = (ox < 8) & (oy < 8) & (ox > 0.5) & (oy > 0.5)
    t = ox[near] - oy[near]; o = np.argsort(t); t, d = t[o], ((ox[near] + oy[near]) / 2)[o]
    R = float(np.interp(0, t, d)) / (1 - 2 ** -0.5)
    # 灵动岛开孔
    hx, hy = dx[hole], dy[hole]
    pill_w, pill_h = hx.max() - hx.min(), hy.max() - hy.min()
    r = pill_h / 2
    print(f'{out_path}: {size / 1e6:.2f} MB，{len(meshes)} 个网格，{stats["verts"]} 个顶点，{stats["tris"]} 个三角形，'
          f'{len(B.j["materials"])} 种材质，{len(B.j["images"])} 张贴图')
    print(f'原模型机身 {W0:.2f} × {H0:.2f} mm → 放大 ×{kx:.5f} / ×{ky:.5f}；正面玻璃 z = {zf:.3f} mm')
    print(f'原模型显示区 半宽 {half[0]:.3f}、半高 {half[1]:.3f} mm（放大后 {half[0] * kx:.3f} / {half[1] * ky:.3f}），等效圆角 R ≈ {R:.2f} mm')
    print(f'原模型灵动岛 {pill_w:.3f} × {pill_h:.3f} mm：中心距显示区顶边 {half[1] - (hy.max() + hy.min()) / 2:.3f}，'
          f'直线段半长 {pill_w / 2 - r:.3f}，半径 {r:.3f}；中心 x 偏 {(hx.max() + hx.min()) / 2:.3f}')


if __name__ == '__main__':
    if len(sys.argv) != 3: sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
