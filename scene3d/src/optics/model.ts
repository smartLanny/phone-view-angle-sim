/*
 * 可视角光学模型，由原型 web/model.js 移植（数学不变）。
 *
 * 坐标约定（手机坐标系，从屏幕正面看）:
 *   u = 手机右方（短边方向），v = 手机上方（长边方向），n = 屏幕法线指向观察者。
 *   观察方向用 (θ, ψ) 表示：θ 为与法线夹角，ψ 为方向在屏幕面内的方位角，
 *   从 +u 逆时针量到 +v（ψ=0 右，90 上，180 左，270 下）。
 *
 * 测量几何: 手机竖放后在面内顺时针转 φ，再绕世界竖直轴离轴转 θ ∈ [-70°, 70°]。
 *   每个文件提供两条半径线: +θ → ψ = φ，−θ → ψ = φ + 180°。
 *   只有 0/30/60/90/180/210/240/270° 八个方位有实测，其余两个象限用上下镜像（ψ → −ψ）补全。
 */

export type XYZ = [number, number, number];
type Prim = 'W' | 'R' | 'G' | 'B';
const PRIMS: Prim[] = ['W', 'R', 'G', 'B'];

export interface MeasureSet { name: string; file: string; phi: number; data: Record<Prim | 'K', XYZ[]> }
export interface Profile { id: string; device: string; privacy: boolean; privacyKind?: 'mode' | 'film'; sets: MeasureSet[] }
export interface AngData { units: string; angles: number[]; profiles: Profile[] }

export const norm360 = (a: number) => ((a % 360) + 360) % 360;
const angDist = (a: number, b: number) => { const d = Math.abs(norm360(a) - norm360(b)); return Math.min(d, 360 - d); };

type M3 = number[];
function inv3(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}
function mul3(a: M3, b: M3): M3 {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
const mulVec = (m: M3, v: number[]) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]) as XYZ;
const fromCols = (c0: number[], c1: number[], c2: number[]): M3 => [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
const scaleCols = (m: M3, s: number[]) => m.map((v, i) => v * s[i % 3]);
const mulEl = (a: number[], b: number[]) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]] as XYZ;

export function uvPrime(X: number[]) {
  const d = X[0] + 15 * X[1] + 3 * X[2];
  return d > 0 ? [4 * X[0] / d, 9 * X[1] / d] : [0, 0];
}
const duv = (a: number[], b: number[]) => { const p = uvPrime(a), q = uvPrime(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); };

/** 1 JNCD = Δu′v′ 0.004（显示行业惯用值）。 */
export const JNCD = 0.004;

export function xyzToLab(X: number[], white: number[]) {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X[0] / white[0]), fy = f(X[1] / white[1]), fz = f(X[2] / white[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000（kL = kC = kH = 1），按 Sharma 2005 实现。 */
export function deltaE2000(lab1: number[], lab2: number[]) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const rad = Math.PI / 180, p7 = 25 ** 7;
  const cos = (d: number) => Math.cos(d * rad), sin = (d: number) => Math.sin(d * rad);
  const Cb7 = ((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + p7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (a === 0 && b === 0 ? 0 : norm360(Math.atan2(b, a) / rad));
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p);
  const chroma = C1 * C2 !== 0;
  let dh = 0;
  if (chroma) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * sin(dh / 2);
  const Lb = (L1 + L2) / 2, Cb = (C1 + C2) / 2;
  let hb = h1 + h2;
  if (chroma) { if (Math.abs(h1 - h2) > 180) hb += hb < 360 ? 360 : -360; hb /= 2; }
  const T = 1 - 0.17 * cos(hb - 30) + 0.24 * cos(2 * hb) + 0.32 * cos(3 * hb + 6) - 0.2 * cos(4 * hb - 63);
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Cb7p = Cb ** 7;
  const RT = -2 * Math.sqrt(Cb7p / (Cb7p + p7)) * sin(2 * dTheta);
  const SL = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cb, SH = 1 + 0.015 * Cb * T;
  const l = dL / SL, c = dC / SC, h = dH / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

export interface ModelOpts { rotation?: 'cw' | 'ccw'; positive?: 'right' | 'left'; fill?: 'interp' | 'mirror' | 'vmirror' }
export interface Eval {
  theta: number; psi: number; clamped: boolean; T: M3; W: XYZ;
  yRatio: number; duv: number; jncd: number; de00: number;
}
interface Line { psi: number; set: number; sign: number; virtual: boolean }

export function createModel(data: { angles: number[]; sets: MeasureSet[] }, o: ModelOpts = {}) {
  const opts = { rotation: 'cw', positive: 'right', fill: 'vmirror', ...o };
  const angles = data.angles;
  const i0 = angles.indexOf(0);
  if (i0 < 0) throw new Error('数据中缺少 0° 测量');
  const aMin = angles[0], step = angles[1] - angles[0], aMax = angles[angles.length - 1];
  const thetaMax = Math.min(-aMin, aMax);

  // 每个文件用自己的 0° 值归一化，消除不同测量批次之间的亮度 / 白点漂移
  const sets = data.sets.map((s) => {
    const ratio = {} as Record<Prim, number[][]>, normal = {} as Record<Prim, number[]>;
    const wy = s.data.W[i0][1];
    for (const p of PRIMS) {
      const n0 = s.data[p][i0];
      ratio[p] = s.data[p].map((v) => v.map((c, k) => c / n0[k]));
      normal[p] = n0.map((c) => c / wy);
    }
    return { name: s.name, file: s.file, phi: s.phi, ratio, normal };
  });

  // 法线方向参考：各文件 0° 值（白场 Y=1 归一）的平均
  const ref = {} as Record<Prim, XYZ>;
  for (const p of PRIMS) ref[p] = [0, 1, 2].map((k) => sets.reduce((acc, s) => acc + s.normal[p][k], 0) / sets.length) as XYZ;
  // 三基色按 R+G+B = W 做缩放校正，使白场严格等于实测白
  const Mref = fromCols(ref.R, ref.G, ref.B);
  const s0 = mulVec(inv3(Mref), ref.W);
  const MrefInv = inv3(scaleCols(Mref, s0));
  const refLab = xyzToLab(ref.W, ref.W);

  const rotSign = opts.rotation === 'cw' ? 1 : -1;
  const flip = opts.positive === 'right' ? 0 : 180;
  const lines: Line[] = [];
  sets.forEach((s, si) => {
    const psiPos = norm360(rotSign * s.phi + flip);
    lines.push({ psi: psiPos, set: si, sign: 1, virtual: false });
    lines.push({ psi: norm360(psiPos + 180), set: si, sign: -1, virtual: false });
  });
  const mirrorOf = ({ mirror: (p: number) => 180 - p, vmirror: (p: number) => -p } as Record<string, (p: number) => number>)[opts.fill];
  if (mirrorOf) {
    for (const l of lines.filter((x) => !x.virtual)) {
      const m = norm360(mirrorOf(l.psi));
      if (!lines.some((q) => angDist(q.psi, m) < 0.5)) lines.push({ ...l, psi: m, virtual: true });
    }
  }
  lines.sort((a, b) => a.psi - b.psi);

  // 单调三次 Hermite 插值（非均匀节点），不会越过相邻数据点形成假峰
  function slope(y0: number, y1: number, y2: number, h0: number, h1: number) {
    const s0 = (y1 - y0) / h0, s1 = (y2 - y1) / h1;
    if (s0 * s1 <= 0) return 0;
    const m = (h1 * s0 + h0 * s1) / (h0 + h1);
    const lim = 3 * Math.min(Math.abs(s0), Math.abs(s1));
    return Math.sign(m) * Math.min(Math.abs(m), lim);
  }
  function hermite(y1: number, y2: number, m1: number, m2: number, h: number, w: number) {
    const w2 = w * w, w3 = w2 * w;
    return (2 * w3 - 3 * w2 + 1) * y1 + (w3 - 2 * w2 + w) * h * m1 + (-2 * w3 + 3 * w2) * y2 + (w3 - w2) * h * m2;
  }
  const cubic = (v0: number[], v1: number[], v2: number[], v3: number[], h0: number, h1: number, h2: number, w: number) =>
    v1.map((_, k) => hermite(v1[k], v2[k], slope(v0[k], v1[k], v2[k], h0, h1), slope(v1[k], v2[k], v3[k], h1, h2), h1, w));

  function sampleLine(line: Line, theta: number) {
    const t = Math.min(Math.max(line.sign * theta, aMin), aMax);
    const f = (t - aMin) / step, n = angles.length;
    const i = Math.min(Math.floor(f), n - 2), w = f - i;
    const at = (j: number) => Math.min(Math.max(j, 0), n - 1);
    const ratio = sets[line.set].ratio;
    const out = {} as Record<Prim, number[]>;
    for (const p of PRIMS) { const r = ratio[p]; out[p] = cubic(r[at(i - 1)], r[i], r[i + 1], r[at(i + 2)], step, step, step, w); }
    return out;
  }

  function ratioAt(theta: number, psi: number) {
    psi = norm360(psi);
    const n = lines.length;
    let hi = lines.findIndex((l) => l.psi > psi);
    if (hi < 0) hi = 0;
    const k = (hi - 1 + n) % n;
    const L = (j: number) => lines[((j % n) + n) % n];
    const gap = (a: Line, b: Line) => norm360(b.psi - a.psi) || 360;
    const h0 = gap(L(k - 1), L(k)), h1 = gap(L(k), L(k + 1)), h2 = gap(L(k + 1), L(k + 2));
    const w = norm360(psi - L(k).psi) / h1;
    const r = [k - 1, k, k + 1, k + 2].map((j) => sampleLine(L(j), theta));
    const out = {} as Record<Prim, number[]>;
    for (const p of PRIMS) out[p] = cubic(r[0][p], r[1][p], r[2][p], r[3][p], h0, h1, h2, w);
    return out;
  }

  /** θ, ψ 单位为度。返回该方向上的线性 RGB 变换矩阵 T（行主序）等。 */
  function evalAt(theta: number, psi: number): Eval {
    const clamped = theta > thetaMax;
    const th = Math.min(Math.max(theta, 0), thetaMax);
    const r = ratioAt(th, psi);
    const R = mulEl(ref.R, r.R), G = mulEl(ref.G, r.G), B = mulEl(ref.B, r.B);
    const W = mulEl(ref.W, r.W);
    const M = fromCols(R, G, B);
    const s = mulVec(inv3(M), W);
    const T = mul3(MrefInv, scaleCols(M, s));
    const d = duv(W, ref.W);
    return { theta: th, psi: norm360(psi), clamped, T, W, yRatio: W[1] / ref.W[1], duv: d, jncd: d / JNCD, de00: deltaE2000(refLab, xyzToLab(W, ref.W)) };
  }

  /** 查找表: 宽 = θ 0..thetaMax（1°），高 = 4 块 × 360 行（ψ 0..359，1°）。块 0-2 为 T 的三行，块 3 为白场 XYZ。 */
  function buildLUT() {
    const w = thetaMax + 1, h = 360 * 4;
    const buf = new Float32Array(w * h * 4);
    for (let psi = 0; psi < 360; psi++) {
      for (let th = 0; th < w; th++) {
        const e = evalAt(th, psi);
        const rows = [e.T.slice(0, 3), e.T.slice(3, 6), e.T.slice(6, 9), e.W];
        rows.forEach((v, blk) => {
          const o = (((blk * 360) + psi) * w + th) * 4;
          buf[o] = v[0]; buf[o + 1] = v[1]; buf[o + 2] = v[2]; buf[o + 3] = 1;
        });
      }
    }
    return { width: w, height: h, data: buf };
  }

  return { angles, thetaMax, lines, ref, evalAt, buildLUT };
}
export type AngleModel = ReturnType<typeof createModel>;

/** 读取 data.js（格式：window.ANG_DATA = {...};），以后加 iPhone 数据只要换 / 合并这个文件。 */
export async function loadAngData(url: string): Promise<AngData> {
  const txt = await (await fetch(url)).text();
  return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
}

/** 离轴角 θ 与方位角 ψ（度）：d 为从屏幕上的点指向眼睛的向量（手机局部坐标）。 */
export function anglesOf(d: { x: number; y: number; z: number }) {
  return {
    theta: Math.atan2(Math.hypot(d.x, d.y), d.z) * 180 / Math.PI,
    psi: norm360(Math.atan2(d.y, d.x) * 180 / Math.PI),
  };
}
