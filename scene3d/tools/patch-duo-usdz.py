#!/usr/bin/env python3
"""
用苹果官网 iPhone Duo AR 模型（USDZ）补全网页用的 iphoneduo.glb。

原 glb 由 USDZ 转换而来，几何、UV、底色 / 金属度粗糙度 / 法线贴图都与原文件一致（逐项核对过），
但转换时丢掉了两样东西，这里补回：

1. 环境光遮蔽（AO）贴图：原材质几乎都接了 occlusion 贴图（按钮缝、天线缝、镜头圈、扬声器网、
   背板相机台阴影……），glb 里一张都没有。按原材质的 UV 组（st → TEXCOORD_0，st1 → TEXCOORD_1）
   挂到 occlusionTexture。原文件里中框等 7 种材质展开 / 合上用两张不同的 AO（姿态变体里替换），
   这里合成一张：R = 展开，G = 合上，并在材质 extras 里标 aoClosedInGreen，渲染端按开合角混合。
   常量遮蔽（原文件直接写 0.41 / 0）用原文件里的 1×1、4×4 小图表示。
2. 颜色变体：原文件有 Star White（星白色）和 Night Sky（夜空色）两套。glb 只有星白色。
   这里用 KHR_materials_variants 加上夜空色：复制受影响的材质并改底色 / 金属度 / 粗糙度 / 清漆，
   换掉 4 张底色贴图（背板覆层的透明度仍取原文件 opacity 贴图，烘进 alpha）。

材质数值取自原文件（星白色：Color 变体覆盖；夜空色：底层默认值；UsdPreviewSurface 未写的输入按其默认值）。
依赖 Pillow、numpy。用法（在 scene3d 目录下）：

    python3 tools/patch-duo-usdz.py /path/to/iPhone_Duo_e-sim_Star-White_Variant.usdz public/models/iphoneduo.glb
    node tools/embed-duo.mjs

USDZ 本身（© Apple）不进仓库。
"""
import io, json, struct, sys, zipfile
import numpy as np
from PIL import Image

AO_SIZE = 512
# 材质名 → (AO 贴图, UV 组)；'const' 表示原文件写的是常量
AO = {
    'DHVeopyQCCjAHKQ': ('eLHPUXBUiNIFPvE.jpg', 0), 'VKnKoHfJjSdRybB': ('eLHPUXBUiNIFPvE.jpg', 0),
    'bnbUHmVcBNyhFgl': ('PlfJwuXpFgcfAdz.jpg', 0), 'oEGeLQAOjZgdIFG': ('TzYVtWJouKRcoEt.jpg', 0),
    'ZdlykFGlVXrMgnF': ('NIkNdQidncmTXRN.png', 0), 'udkIoumZEJmNcgx': ('OojuzFaMfhmMMQJ.png', 0),
    'iWJmrhAGVXsplAU': ('OojuzFaMfhmMMQJ.png', 0), 'kJeamnuzMHYZdFm': ('dGXJTDPlTkOQabf.jpg', 0),
    'kUUqfCXsMaJHyje': ('FAMtGVpXliwWBrA.jpg', 1), 'tbdwzjlMQCYGFiW': ('vkcFRmtsVsGOTlu.png', 0),
    'zzpHLLWMeplrvNu': ('vkcFRmtsVsGOTlu.png', 0), 'nyGbnltkiVgOVaK': ('ZcxyUBDxwrfjkaY.jpg', 0),
    'yeSylDxiUWUEdUq': ('ruKXUyAdnObASeD.jpg', 0), 'nfSKIKcFQpPcaTk': ('SUHpVLjLHwaMAVl.jpg', 0),
    'uJFPWgDhmWStPgF': ('OojuzFaMfhmMMQJ.png', 0),   # 原文件 occlusion = 0
    # 展开用 lOid…，合上用 JLdu…（同一套 UV）
    'yakTRrHfzYtGymu': ('PAIR', 0), 'pOHYMArkYgGMSvE': ('PAIR', 0), 'AfMuGuGyrRdWvGa': ('PAIR', 0),
    'MyBIzTBvbXlVjff': ('PAIR', 0), 'TJvImvzeubEEDzE': ('PAIR', 0), 'lncqqAffdcKCPyc': ('PAIR', 0),
}
PAIR = ('lOidToIFtyVJmEb.jpg', 'JLdujVWHiQQwOsQ.jpg')
# 夜空色与星白色不同的材质参数（底色为线性值）
NIGHT = {
    'bnbUHmVcBNyhFgl': {'baseColor': [0.18, 0.18, 0.18]},
    'oEGeLQAOjZgdIFG': {'baseColor': [0.0861, 0.091975, 0.1]},
    'yakTRrHfzYtGymu': {'baseColor': [0.00165, 0.017848, 0.033]},
    'kJeamnuzMHYZdFm': {'baseColorTexture': 'iVBwAaHfsiIrNHE.jpg'},
    'kUUqfCXsMaJHyje': {'baseColor': [0.01782, 0.024143, 0.033]},
    'pOHYMArkYgGMSvE': {'baseColor': [0.05, 0.070826, 0.1]},
    'MyBIzTBvbXlVjff': {'baseColor': [0.0042, 0.01538, 0.03], 'roughness': 0.8, 'metallic': 0.2},
    'nyGbnltkiVgOVaK': {'baseColorTexture': 'VEgwRzgWesAmUdM.png'},
    'eNDiNFhhBNyrPgP': {'baseColor': [0.012, 0.036, 0.06], 'clearcoat': 1.0, 'clearcoatRoughness': 0.01, 'metallic': 0.2},
    'TJvImvzeubEEDzE': {'baseColor': [0.028, 0.045498, 0.07]},
    'qsaDpVIHURYREdD': {'baseColor': [0.0054, 0.0162, 0.027], 'metallic': 0.2},
    'qMQBeWGUCGfErnO': {'baseColor': [0.0128, 0.0384, 0.064], 'metallic': 0.2},
    'hpXWDkYkMocrDql': {'baseColorTexture': 'odObODVqSULpCqb.jpg', 'metallic': 0.2},
    'lncqqAffdcKCPyc': {'baseColor': [0.0042, 0.01538, 0.03], 'metallic': 0.0},
    'nfSKIKcFQpPcaTk': {'baseColorTexture': 'yjmmGYHswNoyCzX.jpg', 'opacityTexture': 'fxAdjuEBqczWSSx.jpg', 'metallic': 0.2},
    'djGRseSgLsvgsjU': {'baseColor': [0.0, 0.012133, 0.028], 'metallic': 0.2},
}


def main(usdz_path, glb_path):
    raw = open(glb_path, 'rb').read()
    jlen = struct.unpack_from('<I', raw, 12)[0]
    j = json.loads(raw[20:20 + jlen])
    bin_ = bytearray(raw[28 + jlen:])
    if j.get('asset', {}).get('extras', {}).get('patchedFromUsdz'):
        sys.exit('已经补过，不要重复运行（先还原 glb）')
    z = zipfile.ZipFile(usdz_path)
    files = {n.split('/')[-1]: n for n in z.namelist()}
    read = lambda name: z.read(files[name])

    def add_image(data, mime):
        while len(bin_) % 4: bin_.append(0)
        j['bufferViews'].append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)})
        bin_.extend(data)
        j['images'].append({'bufferView': len(j['bufferViews']) - 1, 'mimeType': mime})
        j['textures'].append({'source': len(j['images']) - 1, 'sampler': 0})
        return len(j['textures']) - 1

    def png(im):
        buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True); return buf.getvalue()

    def gray(name):
        im = Image.open(io.BytesIO(read(name))).convert('L')
        if max(im.size) > AO_SIZE: im = im.resize((min(im.size[0], AO_SIZE), min(im.size[1], AO_SIZE)), Image.LANCZOS)
        return im

    # ---- AO ----
    tex_of = {}
    for mat_name, (src, uv) in AO.items():
        if src not in tex_of:
            if src == 'PAIR':
                a, b = (np.asarray(gray(n)) for n in PAIR)
                tex_of[src] = add_image(png(Image.fromarray(np.dstack([a, b, a]))), 'image/png')
            else:
                tex_of[src] = add_image(png(gray(src)), 'image/png')
    by_name = {m['name']: i for i, m in enumerate(j['materials'])}
    for mat_name, (src, uv) in AO.items():
        m = j['materials'][by_name[mat_name]]
        m['occlusionTexture'] = {'index': tex_of[src], **({'texCoord': 1} if uv else {})}
        if src == 'PAIR': m.setdefault('extras', {})['aoClosedInGreen'] = True

    # ---- 夜空色 ----
    variants = j.setdefault('extensions', {}).setdefault('KHR_materials_variants', {'variants': []})
    variants['variants'] = [{'name': 'Star White'}, {'name': 'Night Sky'}]
    j.setdefault('extensionsUsed', [])
    if 'KHR_materials_variants' not in j['extensionsUsed']: j['extensionsUsed'].append('KHR_materials_variants')
    night_of = {}
    for mat_name, d in NIGHT.items():
        src = j['materials'][by_name[mat_name]]
        m = json.loads(json.dumps(src)); m['name'] = mat_name + '_NightSky'
        p = m.setdefault('pbrMetallicRoughness', {})
        if 'baseColor' in d: p['baseColorFactor'] = d['baseColor'] + [p.get('baseColorFactor', [1, 1, 1, 1])[3]]
        if 'baseColorTexture' in d:
            im = Image.open(io.BytesIO(read(d['baseColorTexture']))).convert('RGB')
            if 'opacityTexture' in d:   # 透明度烘进 alpha（与原 glb 的做法一致）
                op = Image.open(io.BytesIO(read(d['opacityTexture']))).convert('L').resize(im.size, Image.LANCZOS)
                im.putalpha(op)
                p['baseColorTexture'] = {'index': add_image(png(im), 'image/png')}
            else:
                p['baseColorTexture'] = {'index': add_image(read(d['baseColorTexture']), 'image/jpeg' if d['baseColorTexture'].endswith('.jpg') else 'image/png')}
        if 'metallic' in d: p['metallicFactor'] = d['metallic']
        if 'roughness' in d: p['roughnessFactor'] = d['roughness']
        if 'clearcoat' in d:
            cc = m.setdefault('extensions', {}).setdefault('KHR_materials_clearcoat', {})
            cc['clearcoatFactor'] = d['clearcoat']
            if 'clearcoatRoughness' in d: cc['clearcoatRoughnessFactor'] = d['clearcoatRoughness']
            if 'KHR_materials_clearcoat' not in j['extensionsUsed']: j['extensionsUsed'].append('KHR_materials_clearcoat')
        j['materials'].append(m)
        night_of[by_name[mat_name]] = len(j['materials']) - 1
    for mesh in j['meshes']:
        for prim in mesh['primitives']:
            if prim.get('material') in night_of:
                prim.setdefault('extensions', {})['KHR_materials_variants'] = {'mappings': [
                    {'material': prim['material'], 'variants': [0]}, {'material': night_of[prim['material']], 'variants': [1]}]}

    j.setdefault('asset', {}).setdefault('extras', {})['patchedFromUsdz'] = True
    while len(bin_) % 4: bin_.append(0)
    j['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
    open(glb_path, 'wb').write(out)
    print(f'{glb_path}: {len(raw) / 1e6:.2f} MB → {len(out) / 1e6:.2f} MB，AO {len(AO)} 种材质，夜空色 {len(NIGHT)} 种材质')


if __name__ == '__main__':
    if len(sys.argv) != 3: sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
