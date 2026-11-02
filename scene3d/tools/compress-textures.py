#!/usr/bin/env python3
"""
把模型里较大的 RGB PNG 贴图改存为 JPEG（质量 95、不做色度抽样），并重新生成网页内嵌的 assets/*.js。

为什么：屏幕仿真把每种贴图采样进 512² 纹理数组，三维场景里手机也只占屏幕一小块；
这些贴图（底色、粗糙度 / 金属度、法线、环境光遮蔽）存成无损 PNG 白白多出几百 KB 到 1.7 MB。
质量 95 时底色贴图 PSNR > 50 dB，噪点很多的法线 / 粗糙度贴图也在 37 dB 以上。
带透明通道的、灰度的、本来就是 JPEG 的、小于 40 KB 的贴图不动；几何数据不动。

用法（在仓库根目录）：python3 scene3d/tools/compress-textures.py iphoneduo iphone18pm iphone17pm
"""
import io, json, struct, sys, base64, re
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MIN_BYTES, QUALITY = 40_000, 95

def pad4(b, fill=b'\0'):
    return b + fill * (-len(b) % 4)

def compress(name):
    path = ROOT / 'scene3d/public/models' / f'{name}.glb'
    src = path.read_bytes()
    magic, version, _ = struct.unpack('<4sII', src[:12])
    assert magic == b'glTF' and version == 2
    jlen = struct.unpack('<I', src[12:16])[0]
    gltf = json.loads(src[20:20 + jlen])
    blen = struct.unpack('<I', src[20 + jlen:24 + jlen])[0]
    binc = src[28 + jlen:28 + jlen + blen]
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
    print(f'{name}: {len(src) / 1e6:.2f} → {len(glb) / 1e6:.2f} MB（贴图省 {saved / 1e6:.2f} MB）')

for n in sys.argv[1:] or ['iphoneduo', 'iphone18pm', 'iphone17pm']:
    compress(n)
