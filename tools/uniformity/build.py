#!/usr/bin/env python3
"""把屏幕数据库（smartLanny/svm-full-range-visualizer）的均匀度热力图转成本页用的数据。

    python3 tools/uniformity/build.py [--src <svm-full-range-visualizer 的本地 checkout>]
    python3 tools/uniformity/build.py --check      # 只核对 web/uniformity/ 是否与源数据一致

源数据：data/uniformity/index.json 和 data/uniformity/maps/*.png。PNG 是数据库自己的
render.py / export_maps.py 把 Radiant ProMetric 的亮度、色温矩阵按一条 8 段色条（index.json 的
colorStops）着色、1 mm 滤波后导出的；色条两端对应的数值记在每张图的 scale 里。这里把颜色按同一条
色条反查回数值（每个像素取色条上最近的点），再
  * 用数据库记录的指标核对：9 点均匀性、面均匀性（P0.1 / P99.9）、偏离 ≥ 10 % 的面积、9 点 / 全屏
    色温差，超出容差就报错，不输出；
  * 按热力图的屏幕轮廓对到本页 devices.js 的显示区（热力图的挖孔在上方，与机型参数核对过），
    重采样到每台 384 行的网格；屏幕外和挖孔里的格子取最近的有效值；
  * 写 web/uniformity/index.js（指标、条件、来源，随页面加载）和 web/uniformity/<id>.js（网格，
    打开均匀度时才加载）。

测量相机的视角：二维亮度计离屏幕只有几十厘米时，相机看屏幕边缘本身就是斜的，热力图里已经包含这部分
衰减；页面再按眼睛的位置乘一次视角衰减就重复了。tools/uniformity/camera.json 写上某台的测量距离后，
这里用同一台机型的可视角数据（model.js）按相机位置先除掉这部分。距离未知时不扣除（不猜）。

依赖 numpy、scipy、pillow（与数据库的均匀度脚本相同）和 node。
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "uniformity"
CAMERA = Path(__file__).with_name("camera.json")
# 本页机型名（data.js 的 device）→ 数据库机型 id
DEVICES = {
    "iPhone 18 Pro Max GH3": "iphone-18-pro-max",
    "小米 18 Pro Max": "xiaomi-18-pro-max",
    "华为 Mate 90 Pro Max 典藏版": "huawei-mate-90-pro-max",
    "iPhone 17 Pro Max GV3": "iphone-17-pro-max",
}
ROWS = 320                      # 每台 320 行（约 0.5 mm 一格，与热力图的 1 mm 滤波相当）
CCT_SMOOTH_MM = 1.5             # 色温另加的高斯平滑（σ，mm），见下
# 核对容差（9 点用的是原始矩阵的圆内平均，热力图是 1 mm 滤波后的值，所以略放宽）
TOL = {"ua": 0.3, "u9": 0.4, "dev10": 0.1, "cctArea": 8.0, "cct9": 8.0}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def find_src(explicit):
    for c in [explicit, os.environ.get("SVM_DIR"), ROOT.parent / "smartlanny" / "svm-full-range-visualizer",
              ROOT.parent / "svm-full-range-visualizer"]:
        if c and (Path(c) / "data" / "uniformity" / "index.json").exists():
            return Path(c).resolve()
    raise SystemExit("找不到屏幕数据库的 checkout：用 --src 指定，或设环境变量 SVM_DIR")


def git(src, *args):
    try:
        return subprocess.run(["git", "-C", str(src), *args], capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def node(*args):
    r = subprocess.run(["node", str(Path(__file__).with_name("sim.mjs")), *args], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


class Decoder:
    """把热力图颜色反查成色条上的位置 t ∈ [0, 1]。"""

    def __init__(self, stops):
        xs = [s[0] for s in stops]
        self.cmap = lambda t: np.stack([np.interp(np.clip(t, 0, 1), xs, [s[1][c] for s in stops]) for c in range(3)], -1)
        self.t = np.linspace(0, 1, 16385)
        self.tree = cKDTree(self.cmap(self.t))

    def __call__(self, path):
        a = np.asarray(Image.open(path).convert("RGBA")).astype(np.float64)
        # 导出时浮点颜色直接截断成 uint8（astype），补回半个色阶再查
        d, i = self.tree.query((a[..., :3] + 0.5).reshape(-1, 3))
        return self.t[i].reshape(a.shape[:2]), d.reshape(a.shape[:2]), a[..., 3] / 255.0


def nine(v, mask):
    """数据库 render.py 的 9 点：屏幕外接框 10 % / 50 % / 90 % 处、半径为短边 4 % 的圆内平均。"""
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    H, W = y1 - y0, x1 - x0
    r = 0.04 * W
    yy, xx = np.mgrid[0:v.shape[0], 0:v.shape[1]]
    pts = []
    for fy in (0.1, 0.5, 0.9):
        for fx in (0.1, 0.5, 0.9):
            cy, cx = y0 + fy * H, x0 + fx * W
            sel = ((yy - cy) ** 2 + (xx - cx) ** 2 <= r * r) & mask
            pts.append((fx, fy, float(v[sel].mean())))
    return pts


def fill_nearest(v, mask):
    idx = ndi.distance_transform_edt(~mask, return_distances=False, return_indices=True)
    return v[tuple(idx)]


def mccamy(xyz):
    X, Y, Z = xyz[..., 0], xyz[..., 1], xyz[..., 2]
    s = X + Y + Z
    x, y = X / s, Y / s
    n = (x - 0.3320) / (0.1858 - y)
    return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33


class Angles:
    """某个 profile 的白场亮度比与 XYZ，θ 0…30°、ψ 1° 网格上双线性插值。"""

    def __init__(self, profile):
        a = node("angles", profile)
        self.th = np.array(a["theta"])
        self.y = np.array(a["yRatio"])
        self.W = np.array(a["W"])
        self.ref = np.array(a["refW"])

    def at(self, theta, psi):
        ti = np.interp(theta, self.th, np.arange(len(self.th)))
        t0 = np.clip(np.floor(ti).astype(int), 0, len(self.th) - 2)
        ft = ti - t0
        p = np.mod(psi, 360.0)
        p0 = np.floor(p).astype(int) % 360
        p1 = (p0 + 1) % 360
        fp = p - np.floor(p)
        def bil(arr):
            ft_ = ft[..., None] if arr.ndim == 3 else ft
            fp_ = fp[..., None] if arr.ndim == 3 else fp
            a0 = arr[t0, p0] * (1 - ft_) + arr[t0 + 1, p0] * ft_
            a1 = arr[t0, p1] * (1 - ft_) + arr[t0 + 1, p1] * ft_
            return a0 * (1 - fp_) + a1 * fp_
        return bil(self.y), bil(self.W)


def encode(v, digits):
    """8 位量化（量程取这张图自己的最小 / 最大值，一级约为 0.1–0.35 % 或 2–6 K，与热力图本身的色阶精度相当），
    每行按左邻差分（mod 256）后 base64：数值平滑，差分后大多是 0 / ±1，经网页服务器 gzip 后很小。"""
    k = 10 ** digits
    lo, hi = np.floor(v.min() * k) / k, np.ceil(v.max() * k) / k
    q = np.round((v - lo) / (hi - lo) * 255).astype(np.int16)
    d = np.diff(np.concatenate([np.zeros((q.shape[0], 1), np.int16), q], 1), axis=1) % 256
    return {"lo": round(float(lo), digits), "hi": round(float(hi), digits), "data": base64.b64encode(d.astype(np.uint8).tobytes()).decode("ascii")}


def build(src):
    index_path = src / "data" / "uniformity" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    decode = Decoder(index["colorStops"])
    geometry = node("geometry")
    camera = json.loads(CAMERA.read_text(encoding="utf-8")) if CAMERA.exists() else {}
    phones = {p["id"]: p for p in index["phones"]}
    source = {
        "repo": "https://github.com/smartLanny/svm-full-range-visualizer",
        "branch": git(src, "branch", "--show-current"),
        "commit": git(src, "rev-parse", "HEAD"),
        "indexSha256": sha256(index_path),
    }
    meta, files, report = {}, {}, []
    for device, did in DEVICES.items():
        phone = phones[did]
        hw, hh = geometry[device]["half"]
        cols = int(round(ROWS * hw / hh))
        cam = camera.get(did)
        angles = Angles(cam["profile"]) if cam else None
        conds, grids = [], {}
        for c in phone["conditions"]:
            m = c["maps"]["luminance"]
            png = src / "data" / "uniformity" / m["asset"]
            if sha256(png) != m["assetSha256"]:
                raise SystemExit(f"{png}: sha256 与 index.json 不符")
            t, _, alpha = decode(png)
            mask = alpha >= 0.5
            s = m["scale"]
            lum = (s["minPercentOfTypical"] + t * (s["maxPercentOfTypical"] - s["minPercentOfTypical"])) / 100.0
            ppm = lum.shape[0] / 160.0          # 与 render.py 一致：按 160 mm 长边估算每毫米像素数
            inner = ndi.binary_erosion(mask, iterations=int(round(ppm * 1.5)))
            typ = float(np.median(lum[inner]))
            lum = lum / typ                      # 典型值（屏幕内部的中位数）= 1
            v = lum[inner]
            pts = nine(lum, mask)
            pv = np.array([p[2] for p in pts])
            got = {"ua": float(np.percentile(v, 0.1) / np.percentile(v, 99.9) * 100), "u9": float(pv.min() / pv.max() * 100),
                   "dev10": float(np.mean(np.abs(v - 1) >= 0.10) * 100)}
            rec = c["metrics"]["luminance"]
            want = {"ua": rec["areaUniformityPct"], "u9": rec["ninePointUniformityPct"], "dev10": rec["deviation10PctArea"]}
            cct = None
            ccheck = {}
            if "colorTemperature" in c["maps"]:
                cm = c["maps"]["colorTemperature"]
                cpng = src / "data" / "uniformity" / cm["asset"]
                if sha256(cpng) != cm["assetSha256"]:
                    raise SystemExit(f"{cpng}: sha256 与 index.json 不符")
                ct, _, _ = decode(cpng)
                cs = cm["scale"]
                cct = cs["minOffsetFromTypicalK"] + ct * (cs["maxOffsetFromTypicalK"] - cs["minOffsetFromTypicalK"])
                cct = cct - float(np.median(cct[inner]))
                cv = cct[inner]
                cp = np.array([p[2] for p in nine(cct, mask)])
                csat = float(np.mean((ct[mask] <= 1e-4) | (ct[mask] >= 1 - 1e-4)))
                crec = c["metrics"]["colorTemperature"]
                ccheck = {"got": {"cctArea": float(np.percentile(cv, 99.9) - np.percentile(cv, 0.1)), "cct9": float(cp.max() - cp.min())},
                          "want": {"cctArea": crec["areaSpreadK"], "cct9": crec["ninePointSpreadK"]}, "clipped": csat}
            # 核对
            bad = [k for k in want if abs(got[k] - want[k]) > TOL[k]]
            if ccheck and ccheck["clipped"] < 1e-4:
                bad += [k for k in ccheck["want"] if abs(ccheck["got"][k] - ccheck["want"][k]) > TOL[k]]
            line = f"{did:24s} {c['id']:>3s}  " + "  ".join(f"{k} {got[k]:6.2f}/{want[k]:6.2f}" for k in want)
            if ccheck:
                line += "  " + "  ".join(f"{k} {ccheck['got'][k]:6.1f}/{ccheck['want'][k]:6.1f}" for k in ccheck["want"])
                if ccheck["clipped"] >= 1e-4:
                    line += f"  （色温图 {ccheck['clipped'] * 100:.2f}% 超出色条，色温差只能核对到色条范围内）"
            report.append(line)
            if bad:
                raise SystemExit("反查出的数值与数据库指标不符：" + line)

            # 对到本页的显示区
            ys, xs = np.where(mask)
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            jj, ii = np.meshgrid(np.arange(cols), np.arange(ROWS))
            X = (jj + 0.5) / cols * 2 * hw - hw
            Y = hh - (ii + 0.5) / ROWS * 2 * hh
            pc = x0 + (X + hw) / (2 * hw) * (x1 - x0) - 0.5
            pr = y0 + (hh - Y) / (2 * hh) * (y1 - y0) - 0.5
            sigma = 0.42 * (y1 - y0) / ROWS
            def resample(img):
                f = ndi.gaussian_filter(fill_nearest(img, mask), sigma)
                return ndi.map_coordinates(f, [pr, pc], order=1, mode="nearest")
            glum = resample(lum)
            # 色温再做 1.5 mm 高斯平滑：30 cm 外人眼对 1–2 mm 尺度的色度起伏不敏感（色度的空间分辨力远低于亮度），
            # 低灰阶时仪器的色温噪声却正好在这个尺度，不平滑的话色偏分布图会画出满屏的碎等值线。指标核对用的是平滑前的值
            gcct = resample(ndi.gaussian_filter(fill_nearest(cct, mask), CCT_SMOOTH_MM * ppm)) if cct is not None else None
            corrected = None
            if cam:
                cx, cy = cam.get("offsetMm", [0.0, 0.0])
                dx, dy = cx - X, cy - Y
                th = np.degrees(np.arctan2(np.hypot(dx, dy), cam["distanceMm"]))
                ps = np.degrees(np.arctan2(dy, dx))
                yr, Wc = angles.at(th, ps)
                glum = glum / yr
                glum = glum / np.median(glum)
                if gcct is not None:
                    gcct = gcct - (mccamy(Wc) - float(mccamy(angles.ref[None, :])[0]))
                    gcct = gcct - np.median(gcct)
                corrected = {"distanceMm": cam["distanceMm"], "offsetMm": [cx, cy], "profile": cam["profile"],
                             "maxPct": round(float((1 / yr).max() - 1) * 100, 2)}
            grids[c["id"]] = {"lum": encode(glum, 4), **({"cct": encode(gcct, 1)} if gcct is not None else {})}
            ctyp = c["metrics"].get("colorTemperature")
            conds.append({
                "id": c["id"], "label": c["label"], "pattern": c["pattern"], "nits": c["referenceNits"],
                "typical": {"lum": rec["typical"], **({"cct": round(ctyp["typical"], 1)} if ctyp else {})},
                "metrics": {"u9": rec["ninePointUniformityPct"], "ua": rec["areaUniformityPct"], "dev10": rec["deviation10PctArea"],
                            **({"cct9": ctyp["ninePointSpreadK"], "cctArea": ctyp["areaSpreadK"]} if ctyp else {})},
                "nine": [[fx, fy, round(u, 5)] for fx, fy, u in pts],
                "cct": cct is not None,
                **({"cctClippedPct": round(ccheck["clipped"] * 100, 2)} if ccheck and ccheck["clipped"] >= 1e-4 else {}),
                "camera": corrected,
                "source": {"lum": m["measurementSource"], **({"cct": c["maps"]["colorTemperature"]["measurementSource"]} if cct is not None else {})},
            })
        meta[device] = {"id": did, "name": phone["name"], "file": f"uniformity/{did}.js", "cols": cols, "rows": ROWS,
                        "half": [round(hw, 5), round(hh, 5)], "conditions": conds}
        files[did] = {"cols": cols, "rows": ROWS, "conditions": grids}
    return source, meta, files, report


HEAD = "/* 由 tools/uniformity/build.py 生成，不要手改。来源：屏幕数据库 smartLanny/svm-full-range-visualizer 的均匀度热力图 */\n"


def compact(obj, indent=1):
    """缩进的 JSON，但纯数字的数组写在一行（9 点坐标、尺寸），便于看 diff。"""
    text = json.dumps(obj, ensure_ascii=False, indent=indent)
    return re.sub(r"\[\s*([-0-9.e, \n]+?)\s*\]", lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]", text)


def render(source, meta, files):
    out = {}
    for did, f in files.items():
        out[f"{did}.js"] = HEAD + f"(window.UNIF_MAPS = window.UNIF_MAPS || {{}})[{json.dumps(did)}] = " + json.dumps(f, ensure_ascii=False) + ";\n"
    version = hashlib.sha256("".join(out[k] for k in sorted(out)).encode()).hexdigest()[:12]   # 网格文件的缓存版本
    out["index.js"] = HEAD + "window.UNIF_INDEX = " + compact(
        {"schemaVersion": 1, "version": version, "source": source, "devices": meta}) + ";\n"
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", help="svm-full-range-visualizer 的本地 checkout（默认找本仓库旁边的目录或 $SVM_DIR）")
    ap.add_argument("--check", action="store_true", help="只核对 web/uniformity/ 是否最新，不写文件")
    args = ap.parse_args(argv)
    src = find_src(args.src)
    source, meta, files, report = build(src)
    print("\n".join(report))
    out = render(source, meta, files)
    if args.check:
        stale = [n for n, text in out.items() if not (OUT / n).exists() or (OUT / n).read_text(encoding="utf-8") != text]
        if stale:
            raise SystemExit(f"web/uniformity/ 过期：{', '.join(stale)}（重新运行 tools/uniformity/build.py）")
        print("web/uniformity/ 与源数据一致")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for n, text in out.items():
        (OUT / n).write_text(text, encoding="utf-8")
        print(f"web/uniformity/{n}  {len(text.encode()) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
