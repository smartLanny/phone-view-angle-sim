"""把 .ang2 可视角测量文件转换为网页使用的 web/data.js。

.ang2 是 Python pickle，结构为:
    {机型名: {"-70°": {"白": [X, Y, Z], "红": [...], "绿": [...], "蓝": [...], "黑": [...]}, ...}}

递归扫描数据目录，按机型名去掉方向词后分组为多套数据（例如 "小米 18 Pro Max" 与
"小米 18 Pro Max 防窥"），每套可包含多个面内方向，当前数据为 0° / 30° / 60° / 90° / 120° / 150°。
方向优先从文件名推断，文件名没有方向词时再从内部机型标签推断；内部标签原样保留。
所在文件夹名以机型名开头时，多出的部分作为后缀并入机型名，用于区分屏幕供应商
（例: 文件夹 "iphone18 Pro Max GH3" → 机型 "iPhone 18 Pro Max GH3"）。
机型名含“防窥”的为防窥状态；路径含“防窥膜”时标记为贴膜（privacyKind = film），否则为防窥模式。

用法:  python tools/convert_ang2.py [数据目录] [输出 data.js]
"""

import glob
import json
import os
import pickle
import re
import sys

PRIMARY_KEYS = {"白": "W", "红": "R", "绿": "G", "蓝": "B", "黑": "K"}


class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"拒绝加载对象 {module}.{name}")


def infer_phi(name):
    """面内顺时针旋转角：垂直(竖着)=0°，水平(横着)=90°，其余取名字里的角度。"""
    if "垂直" in name or "竖" in name:
        return 0
    if "水平" in name or "横" in name:
        return 90
    m = re.search(r"(\d+(?:\.\d+)?)\s*°", name)
    if m:
        return float(m.group(1))
    raise ValueError(f"无法从名称推断面内旋转角: {name}")


def folder_suffix(folder, device):
    """文件夹名以机型名开头（忽略空格与大小写）时，其余部分作为后缀（如屏幕供应商代号）。

    "iphone18 Pro Max GH3" + "iPhone 18 Pro Max" → "GH3"；不匹配时返回空串。
    """
    target = re.sub(r"\s+", "", device).lower()
    tokens = folder.split()
    acc = ""
    for i, t in enumerate(tokens):
        acc += t.lower()
        if acc == target:
            return " ".join(tokens[i + 1:])
        if not target.startswith(acc):
            return ""
    return ""


def parse_angle(key):
    return float(key.replace("°", "").strip())


def load(path):
    with open(path, "rb") as f:
        root = SafeUnpickler(f).load()
    (name, table), = root.items()
    angles = sorted(table.keys(), key=parse_angle)
    data = {v: [] for v in PRIMARY_KEYS.values()}
    for a in angles:
        for cn, key in PRIMARY_KEYS.items():
            data[key].append([round(float(x), 6) for x in table[a][cn]])
    try:
        phi = infer_phi(os.path.splitext(os.path.basename(path))[0])
    except ValueError:
        phi = infer_phi(name)
    return {
        "name": name,
        "file": os.path.basename(path),
        "phi": phi,
        "angles": [parse_angle(a) for a in angles],
        "data": data,
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(here)
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(here), "web", "data.js")

    files = sorted(glob.glob(os.path.join(src, "**", "*.ang2"), recursive=True))
    if not files:
        sys.exit(f"{src} 下没有 .ang2 文件")

    groups = {}
    for p in files:
        s = load(p)
        s["file"] = os.path.relpath(p, src).replace(os.sep, "/")
        key = " ".join(re.sub(r"垂直|水平|\d+(\.\d+)?°", " ", s["name"]).split())
        key = key.replace("防窥膜", "防窥")
        sub = os.path.dirname(os.path.relpath(p, src))
        base = " ".join(key.replace("防窥", " ").split())
        suffix = folder_suffix(os.path.basename(sub), base) if sub else ""
        # 后缀去掉防窥相关词（已由机型名标记），英文统一大写，保证同一供应商的各状态归为同一机型
        suffix = " ".join(t.upper() for t in suffix.split() if "防窥" not in t)
        if suffix and suffix not in key:
            key = f"{key} {suffix}"
        groups.setdefault(key, []).append(s)

    angles = None
    profiles = []
    for key, sets in groups.items():
        sets.sort(key=lambda s: s["phi"])
        phis = [s["phi"] for s in sets]
        if len(set(phis)) != len(phis):
            sys.exit(f"{key}: 存在重复方向 {phis}")
        for s in sets:
            if angles is None:
                angles = s["angles"]
            if s["angles"] != angles:
                sys.exit(f"{s['file']} 的角度序列与其他文件不一致")
        privacy = "防窥" in key
        profile = {
            "device": " ".join(key.replace("防窥", " ").split()),
            "privacy": privacy,
            "sets": [{k: s[k] for k in ("name", "file", "phi", "data")} for s in sets],
        }
        if privacy:
            # 路径含“防窥膜”视为贴膜，否则为机器自带的防窥模式
            profile["privacyKind"] = "film" if any("防窥膜" in s["file"] for s in sets) else "mode"
        profiles.append(profile)
    profiles.sort(key=lambda p: (p["device"], p["privacy"]))
    for i, p in enumerate(profiles):
        p["id"] = f"p{i}"

    payload = {"units": "XYZ (cd/m²)", "angles": angles, "profiles": profiles}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write("window.ANG_DATA = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    for p in profiles:
        state = {"film": " · 贴防窥膜", "mode": " · 防窥开"}.get(p.get("privacyKind"), "")
        print(f"[{p['id']}] {p['device']}{state}")
        for s in p["sets"]:
            print(f"    φ={s['phi']:>4}°  {s['name']}  ({s['file']})")
    print(f"已写入 {out}")


if __name__ == "__main__":
    main()
