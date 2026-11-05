#!/usr/bin/env python3
"""
压缩机身模型并重新生成网页内嵌的 assets/*.js（屏幕仿真和三维场景都从这里读模型）。

一、贴图：较大的 RGB PNG 改存为 JPEG（质量 95、不做色度抽样）。

为什么：屏幕仿真把每种贴图采样进 512² 纹理数组，三维场景里手机也只占屏幕一小块；
这些贴图（底色、粗糙度 / 金属度、法线、环境光遮蔽）存成无损 PNG 白白多出几百 KB 到 1.7 MB。
质量 95 时底色贴图 PSNR > 50 dB，噪点很多的法线 / 粗糙度贴图也在 37 dB 以上。
带透明通道的、灰度的、本来就是 JPEG 的、小于 40 KB 的贴图不动。

二、几何：float32 顶点数据只保留看得出的精度，低位尾数清零（四舍五入），gzip 后小很多；读取方式不变，两个渲染器都不用改。
  位置 15 位尾数（10 cm 以内误差 < 2 µm）、法线 10 位（< 0.1°）、UV 13 位（512 像素贴图上 < 0.1 像素）。
  另外去掉处处为白色（= 不起作用）的顶点颜色 COLOR_n，去掉之后不再被引用的数据。
重复运行结果不变（已是 JPEG 的跳过，已清零的位再清还是一样）。

用法（在仓库根目录）：python3 scene3d/tools/compress-models.py iphoneduo iphone18pm iphone17pm
"""
import io, json, struct, sys, base64, re
import numpy as np
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MIN_BYTES, QUALITY = 40_000, 95
MANTISSA = {'POSITION': 15, 'NORMAL': 10, 'TEXCOORD': 13}   # 保留的尾数位数（float32 共 23 位）
COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
DTYPE = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5122: '<i2', 5121: 'u1', 5120: 'i1'}

def pad4(b, fill=b'\0'):
    return b + fill * (-len(b) % 4)

def accessor_array(gltf, binc, i):
    a = gltf['accessors'][i]
    v = gltf['bufferViews'][a['bufferView']]
    n, dt = COMPONENTS[a['type']], np.dtype(DTYPE[a['componentType']])
    assert v.get('byteStride', n * dt.itemsize) == n * dt.itemsize, '交错存放的顶点数据不处理'
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return start, np.frombuffer(bytes(binc[start:start + a['count'] * n * dt.itemsize]), dtype=dt)

def geometry(gltf, binc):
    """顶点数据降精度、去掉白色顶点颜色，再删掉不再被引用的 accessor / bufferView。"""
    prims = [p for m in gltf['meshes'] for p in m['primitives']]
    assert not any('targets' in p for p in prims) and 'skins' not in gltf and 'animations' not in gltf
    # 1. 处处为白色的顶点颜色乘上去不改变任何东西
    for p in prims:
        for k in [k for k in p['attributes'] if k.startswith('COLOR_')]:
            a = gltf['accessors'][p['attributes'][k]]
            _, arr = accessor_array(gltf, binc, p['attributes'][k])
            full = 1.0 if a['componentType'] == 5126 else np.iinfo(arr.dtype).max
            if a.get('normalized', a['componentType'] == 5126) and (arr == full).all():
                del p['attributes'][k]
    # 2. float32 尾数清零
    done = set()
    for p in prims:
        for k, i in p['attributes'].items():
            keep = MANTISSA.get('TEXCOORD' if k.startswith('TEXCOORD_') else k)
            if keep is None or i in done or gltf['accessors'][i]['componentType'] != 5126:
                continue
            done.add(i)
            start, arr = accessor_array(gltf, binc, i)
            drop = 23 - keep
            u = arr.view('<u4').copy()
            u = (u + np.uint32(1 << (drop - 1))) & np.uint32((0xFFFFFFFF >> drop) << drop)
            binc[start:start + u.nbytes] = u.astype('<u4').tobytes()
            a = gltf['accessors'][i]
            if 'min' in a:   # 边界框跟着更新，保持与数据一致
                f = u.view('<f4').reshape(-1, COMPONENTS[a['type']])
                a['min'], a['max'] = f.min(0).tolist(), f.max(0).tolist()
    # 3. 删掉没人用的 accessor，再删掉没人用的 bufferView（后面重排 BIN 时就不再写进去）
    used = sorted({i for p in prims for i in list(p['attributes'].values()) + ([p['indices']] if 'indices' in p else [])})
    amap = {old: new for new, old in enumerate(used)}
    gltf['accessors'] = [gltf['accessors'][i] for i in used]
    for p in prims:
        p['attributes'] = {k: amap[i] for k, i in p['attributes'].items()}
        if 'indices' in p: p['indices'] = amap[p['indices']]
    vused = sorted({a['bufferView'] for a in gltf['accessors']} | {im['bufferView'] for im in gltf.get('images', []) if 'bufferView' in im})
    vmap = {old: new for new, old in enumerate(vused)}
    gltf['bufferViews'] = [gltf['bufferViews'][i] for i in vused]
    for a in gltf['accessors']: a['bufferView'] = vmap[a['bufferView']]
    for im in gltf.get('images', []):
        if 'bufferView' in im: im['bufferView'] = vmap[im['bufferView']]

def compress(name):
    path = ROOT / 'scene3d/public/models' / f'{name}.glb'
    src = path.read_bytes()
    magic, version, _ = struct.unpack('<4sII', src[:12])
    assert magic == b'glTF' and version == 2
    jlen = struct.unpack('<I', src[12:16])[0]
    gltf = json.loads(src[20:20 + jlen])
    blen = struct.unpack('<I', src[20 + jlen:24 + jlen])[0]
    binc = src[28 + jlen:28 + jlen + blen]
    binc = bytearray(binc)
    geometry(gltf, binc)
    views = gltf['bufferViews']
    image_view = {im['bufferView']: im for im in gltf.get('images', []) if 'bufferView' in im}
    # 按原顺序重排 BIN：图片视图换成新数据，其余原样，偏移按 4 字节对齐
    out, saved = bytearray(), 0
    for i, v in enumerate(views):
        data = binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
        im = image_view.get(i)
        if im and im.get('mimeType') == 'image/png' and len(data) >= MIN_BYTES:
            pic = Image.open(io.BytesIO(data))
            if pic.mode == 'RGB':
                buf = io.BytesIO()
                pic.save(buf, 'JPEG', quality=QUALITY, subsampling=0, optimize=True)
                if buf.tell() < len(data):
                    saved += len(data) - buf.tell()
                    data, im['mimeType'] = buf.getvalue(), 'image/jpeg'
        while len(out) % 4: out.append(0)
        v['byteOffset'], v['byteLength'] = len(out), len(data)
        out += data
    gltf['buffers'][0]['byteLength'] = len(out)
    js = pad4(json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode(), b' ')
    bn = pad4(bytes(out))
    glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bn)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(bn), b'BIN\0') + bn
    path.write_bytes(glb)
    # 网页内嵌版本：只替换引号里的 base64，保留原文件的写法
    asset = ROOT / 'web/assets' / f'{name}.js'
    text = asset.read_text()
    text, n = re.subn(r"(PHONE_ASSETS\.%s\s*=\s*')[A-Za-z0-9+/=]+(')" % name, lambda m: m.group(1) + base64.b64encode(glb).decode() + m.group(2), text)
    assert n == 1, f'{asset} 里没找到 {name} 的数据'
    asset.write_text(text)
    import gzip
    gz = lambda b: len(gzip.compress(base64.b64encode(b), 6)) / 1e6
    print(f'{name}: {len(src) / 1e6:.2f} → {len(glb) / 1e6:.2f} MB；网页下载（gzip 后）{gz(src):.2f} → {gz(glb):.2f} MB（贴图省 {saved / 1e6:.2f} MB）')

for n in sys.argv[1:] or ['iphoneduo', 'iphone18pm', 'iphone17pm']:
    compress(n)
