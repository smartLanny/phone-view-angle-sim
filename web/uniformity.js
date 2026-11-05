/*
 * 屏幕均匀度（二维亮度计实测，来自屏幕数据库 smartLanny/svm-full-range-visualizer），给 app.js 用。
 * 数据由 tools/uniformity/build.py 生成：uniformity/index.js 随页面加载（条件、指标、来源），
 * 每台的网格 uniformity/<id>.js（约 150–200 KB）在打开均匀度时才加载。
 *
 *   Uniformity.info(device)               该机型的均匀度数据（条件、指标），没有则为 null
 *   Uniformity.condition(device, id)      某个条件（'300' / '100' / '10'）
 *   Uniformity.load(device)               Promise，加载网格
 *   Uniformity.ready(device)              网格是否已加载
 *   Uniformity.gains(device, id, model)   每格三基色的相对增益（纹理数据 + 双线性取样函数）
 *
 * 屏幕坐标：毫米，原点在显示区中心，右 / 上为正（与着色器的 vLocal 相同）。网格覆盖整个显示区矩形，
 * 第一行是屏幕顶边（有挖孔的一边）。
 *
 * 增益：亮度图给出每处亮度相对典型值的比 U，色温图给出相对典型色温的偏移 ΔT。色温只确定了色度沿黑体
 * 轨迹方向的变化（另一方向，偏绿 / 偏品红，仪器没有导出），所以这里让白点沿黑体轨迹平移：
 *   xy = 本机可视角数据的法线白点 + [xy_黑体(T0 + ΔT) − xy_黑体(T0)]，Y = U，
 * 再用同一份数据的三基色矩阵换成三基色的驱动增益。显示内容的每个像素先乘这个增益，再按离轴角变换。
 */
(function (root) {
  'use strict';

  const IDX = root.UNIF_INDEX || { devices: {} };
  const info = (device) => (IDX.devices || {})[device] || null;
  const condition = (device, id) => (info(device)?.conditions || []).find((c) => c.id === id) || null;

  const pending = {};
  const ready = (device) => { const m = info(device); return !!(m && root.UNIF_MAPS?.[m.id]); };
  function load(device) {
    const m = info(device);
    if (!m) return Promise.reject(new Error('该机型没有均匀度数据'));
    if (ready(device)) return Promise.resolve();
    return pending[m.id] || (pending[m.id] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${m.file}?v=${IDX.version || ''}`;
      s.onload = () => (ready(device) ? resolve() : reject(new Error('均匀度数据格式不对')));
      s.onerror = () => { delete pending[m.id]; s.remove(); reject(new Error('无法加载均匀度数据')); };
      document.head.appendChild(s);
    }));
  }

  /** 8 位、每行左邻差分的网格 → Float32Array。 */
  function unpack(enc, cols, rows) {
    const bin = atob(enc.data), out = new Float32Array(cols * rows), k = (enc.hi - enc.lo) / 255;
    for (let r = 0; r < rows; r++) {
      let q = 0;
      for (let c = 0; c < cols; c++) { const i = r * cols + c; q = (q + bin.charCodeAt(i)) & 255; out[i] = enc.lo + q * k; }
    }
    return out;
  }
  /** 双线性取样，与 WebGL 的 LINEAR + CLAMP_TO_EDGE 一致。 */
  function sampler(cols, rows, half) {
    const [hw, hh] = half;
    return (arr, x, y, n = 1, k = 0) => {
      const fx = Math.min(Math.max((x / (2 * hw) + 0.5) * cols - 0.5, 0), cols - 1);
      const fy = Math.min(Math.max((0.5 - y / (2 * hh)) * rows - 0.5, 0), rows - 1);
      const x0 = Math.min(Math.floor(fx), cols - 2), y0 = Math.min(Math.floor(fy), rows - 2), ax = fx - x0, ay = fy - y0;
      const i = (y0 * cols + x0) * n + k, j = i + cols * n;
      return (arr[i] * (1 - ax) + arr[i + n] * ax) * (1 - ay) + (arr[j] * (1 - ax) + arr[j + n] * ax) * ay;
    };
  }

  const fields = {};
  function field(device, id) {
    const m = info(device), maps = m && root.UNIF_MAPS?.[m.id], c = maps?.conditions?.[id];
    if (!c) return null;
    const key = `${m.id}|${id}`;
    if (fields[key]) return fields[key];
    const { cols, rows } = maps;
    return (fields[key] = { cols, rows, half: m.half, lum: unpack(c.lum, cols, rows), cct: c.cct ? unpack(c.cct, cols, rows) : null, at: sampler(cols, rows, m.half) });
  }

  // 黑体轨迹色度（Kim et al. 2002 的三次近似，4000–25000 K）
  function planckXY(T) {
    const x = -3.0258469e9 / (T * T * T) + 2.1070379e6 / (T * T) + 0.2226347e3 / T + 0.240390;
    return [x, 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483];
  }
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  /** 本机的三基色矩阵（法线方向，R + G + B = 白，白 Y = 1；行主序，列为 R、G、B 的 XYZ），与 model.js 的 MrefInv 互逆。 */
  function panel(model) {
    const { R, G, B, W } = model.ref;
    const M = [R[0], G[0], B[0], R[1], G[1], B[1], R[2], G[2], B[2]];
    const iM = inv3(M), s = [0, 1, 2].map((r) => iM[r * 3] * W[0] + iM[r * 3 + 1] * W[1] + iM[r * 3 + 2] * W[2]);
    const P = M.map((v, i) => v * s[i % 3]);
    return { P, Pinv: inv3(P) };
  }

  const gainCache = new Map();
  /**
   * 每格的三基色增益：{ data: Float32Array(RGBA，纹理用), at(x, y) → [gR, gG, gB] }。
   * model 为该机型当前状态（profile）的 AngleModel；结果按机型、条件、模型缓存。
   */
  function gains(device, id, model) {
    const f = field(device, id), c = condition(device, id);
    if (!f || !c || !model) return null;
    let byModel = gainCache.get(model);
    if (!byModel) gainCache.set(model, (byModel = {}));
    const key = `${device}|${id}`;
    if (byModel[key]) return byModel[key];
    const { Pinv } = panel(model), W = model.ref.W, sw = W[0] + W[1] + W[2];
    const xw = W[0] / sw, yw = W[1] / sw, T0 = c.typical.cct || 6500, p0 = planckXY(T0);
    const n = f.cols * f.rows, data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const U = f.lum[i];
      let r = 1, g = 1, b = 1;
      if (f.cct) {
        const p = planckXY(T0 + f.cct[i]), x = xw + p[0] - p0[0], y = yw + p[1] - p0[1];
        const X = x / y, Z = (1 - x - y) / y;
        r = Pinv[0] * X + Pinv[1] + Pinv[2] * Z;
        g = Pinv[3] * X + Pinv[4] + Pinv[5] * Z;
        b = Pinv[6] * X + Pinv[7] + Pinv[8] * Z;
      }
      data[i * 4] = U * r; data[i * 4 + 1] = U * g; data[i * 4 + 2] = U * b; data[i * 4 + 3] = 1;
    }
    const at = (x, y) => [0, 1, 2].map((k) => f.at(data, x, y, 4, k));
    return (byModel[key] = { cols: f.cols, rows: f.rows, half: f.half, data, at, lum: (x, y) => f.at(f.lum, x, y), cct: (x, y) => (f.cct ? f.at(f.cct, x, y) : 0) });
  }

  root.Uniformity = { index: IDX, info, condition, load, ready, gains, panel };
})(window);
