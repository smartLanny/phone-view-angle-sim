"""把头像图片内嵌为 web/avatar.js（data URL），避免 file:// 下跨源图片污染 WebGL 纹理。

用法: python tools/embed_avatar.py [图片路径]
"""
import base64
import mimetypes
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(ROOT, "野生的装机宅头像.webp")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    mime = mimetypes.guess_type(src)[0] or "image/webp"
    with open(src, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    out = os.path.join(ROOT, "web", "avatar.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"window.AVATAR_SRC = 'data:{mime};base64,{b64}';\n")
    print(f"{src} -> {out} ({len(b64)} chars)")


if __name__ == "__main__":
    main()
