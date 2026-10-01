/*
 * 手机机身几何（单位 mm，最后整体缩放到米）。由原型 web/phone3d.js 移植。
 * 局部坐标: x 右、y 上、z 指向屏幕外；原点在屏幕玻璃中心，机身向 −z 延伸。
 * 镜头、背面部件的 x 也按“从正面看”的方向给（从背面看时左右相反）。
 */
import * as THREE from 'three';

export const MAT = {
  FRAME: 0, BACK: 1, ISLAND: 2, BUTTON: 3, LENS_RING: 4, LENS_GLASS: 5, DARK: 6, FLASH: 7, ISLAND_RIM: 8,
} as const;
export const MAT_COUNT = 9;

export interface BodySpec {
  W: number; H: number; T: number;
  R: number;              // 机身圆角
  glassInset: number;     // 正面玻璃边缘到机身外轮廓
  backInset: number;
  fillet: number;         // 中框前后圆弧高度
  sideBulge: number;      // 中框微弧外凸量
  island: { w: number; h: number; top: number; r: number | [number, number]; depth: number; mat: 'glass' | 'frame'; rim: number };
  lenses: [number, number, number, number][];          // [x, y(相对模组中心), 半径, 凸起高度]
  flats: { x: number; y: number; w: number; h: number; r: number; mat: number }[];   // 背面平贴部件（相对机身中心）
  buttons: [number, number, number][];                 // [距顶部, 长度, 侧(1 右 / −1 左)]
  buttonThick: number; buttonOut: number;
}

type V3 = [number, number, number];
type Basis = { p: (u: number, v: number, w: number) => V3; n: (a: number, b: number, c: number) => V3 };

function outline(hw: number, hh: number, r: number | [number, number], segs: number) {
  const [rt, rb] = Array.isArray(r) ? r : [r, r];
  const pts: { c: [number, number]; n: [number, number]; r: number }[] = [];
  for (const [sx, sy, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
    const rc = sy > 0 ? rt : rb;
    const cx = hw - rc, cy = hh - rc;
    for (let k = 0; k <= segs; k++) {
      const a = ((a0 + (90 * k) / segs) * Math.PI) / 180;
      pts.push({ c: [sx * cx, sy * cy], n: [Math.cos(a), Math.sin(a)], r: rc });
    }
  }
  return pts;
}

function basis(o: V3, U: V3, V: V3, W: V3): Basis {
  return {
    p: (u, v, w) => [0, 1, 2].map((k) => o[k] + U[k] * u + V[k] * v + W[k] * w) as V3,
    n: (a, b, c) => {
      const v = [0, 1, 2].map((k) => U[k] * a + V[k] * b + W[k] * c);
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return v.map((x) => x / l) as V3;
    },
  };
}

class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = [];
  idx: number[][] = Array.from({ length: MAT_COUNT }, () => []);
  vert(p: V3, n: V3, uv: [number, number] = [0, 0]) {
    this.pos.push(...p); this.nor.push(...n); this.uv.push(...uv);
    return this.pos.length / 3 - 1;
  }
  /** 按顶点法线统一三角形绕序（各基底的手性不同，逐个三角形校正最省事）。 */
  private orient() {
    const P = this.pos, N = this.nor;
    for (const list of this.idx) {
      for (let t = 0; t < list.length; t += 3) {
        const [a, b, c] = [list[t], list[t + 1], list[t + 2]];
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
        if (fx * nx + fy * ny + fz * nz < 0) { list[t + 1] = c; list[t + 2] = b; }
      }
    }
  }
  build(scale: number) {
    this.orient();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos.map((v) => v * scale), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const all: number[] = [];
    this.idx.forEach((list, m) => { if (list.length) { g.addGroup(all.length, list.length, m); all.push(...list); } });
    g.setIndex(all);
    return g;
  }
}

/** 把截面轮廓沿圆角矩形扫掠成侧壁。profile 为 {d: 向内缩进, w: 高度}，从“顶面一侧”按 w 递减排列。 */
function sweep(m: Builder, B: Basis, hw: number, hh: number, r: number | [number, number], profile: { d: number; w: number }[], segs: number, mat: number) {
  const ol = outline(hw, hh, r, segs);
  const np = profile.length;
  const pn = profile.map((_, j) => {
    const a = profile[Math.max(j - 1, 0)], b = profile[Math.min(j + 1, np - 1)];
    const dr = -(b.d - a.d), dw = b.w - a.w;
    const l = Math.hypot(dw, dr) || 1;
    return [-dw / l, dr / l];
  });
  const base = m.pos.length / 3;
  for (const o of ol) {
    for (let j = 0; j < np; j++) {
      const rad = o.r - profile[j].d;
      const u = o.c[0] + o.n[0] * rad, v = o.c[1] + o.n[1] * rad;
      m.vert(B.p(u, v, profile[j].w), B.n(o.n[0] * pn[j][0], o.n[1] * pn[j][0], pn[j][1]));
    }
  }
  const n = ol.length;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < np - 1; j++) {
      const a = base + i * np + j, b = base + i2 * np + j;
      m.idx[mat].push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
}

/** 圆角矩形平面。uvFlip: 背面部件从背面看时 x 方向反过来。 */
function cap(m: Builder, B: Basis, hw: number, hh: number, r: number | [number, number], d: number, w: number, nw: number, segs: number, mat: number, uvFlip = false) {
  const ol = outline(hw, hh, r, segs);
  const n = B.n(0, 0, nw);
  const uvOf = (u: number, v: number): [number, number] => [uvFlip ? 0.5 - u / (2 * hw) : 0.5 + u / (2 * hw), 0.5 + v / (2 * hh)];
  const c = m.vert(B.p(0, 0, w), n, uvOf(0, 0));
  const first = m.pos.length / 3;
  for (const o of ol) {
    const rad = o.r - d;
    const u = o.c[0] + o.n[0] * rad, v = o.c[1] + o.n[1] * rad;
    m.vert(B.p(u, v, w), n, uvOf(u, v));
  }
  const k = ol.length;
  for (let i = 0; i < k; i++) m.idx[mat].push(c, first + i, first + ((i + 1) % k));
}

const quarter = <T>(n: number, fn: (p: number) => T) => Array.from({ length: n + 1 }, (_, k) => fn(((k / n) * Math.PI) / 2));

export function buildBody(s: BodySpec, scale = 0.001) {
  const hw = s.W / 2, hh = s.H / 2, T = s.T, f = s.fillet, sb = s.sideBulge;
  const m = new Builder();
  const B = basis([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);

  // 中框：前后圆弧 + 中间微微外凸
  const prof = quarter(8, (p) => ({ d: sb + (s.glassInset - sb) * (1 - Math.sin(p)), w: -f * (1 - Math.cos(p)) }));
  for (let k = 1; k < 8; k++) {
    const w = -f - ((T - 2 * f) * k) / 8;
    const t = (w + T / 2) / (T / 2 - f);
    prof.push({ d: sb * t * t, w });
  }
  prof.push(...quarter(8, (p) => ({ d: sb + (s.backInset - sb) * (1 - Math.sin(p)), w: -T + f * (1 - Math.cos(p)) })).reverse());
  sweep(m, B, hw, hh, s.R, prof, 24, MAT.FRAME);
  cap(m, B, hw, hh, s.R, s.backInset, -T, -1, 24, MAT.BACK);

  // 相机模组：金属围边 + 顶面（玻璃或与中框同材质）
  const I = s.island;
  const iy = hh - I.top - I.h / 2;
  const IB = basis([0, iy, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const ifl = 0.9;
  const iprof = [{ d: 0, w: -T + 0.2 }, ...quarter(6, (p) => ({ d: ifl * (1 - Math.cos(p)), w: -T - (I.depth - ifl) - ifl * Math.sin(p) }))];
  sweep(m, IB, I.w / 2, I.h / 2, I.r, iprof, 16, MAT.ISLAND_RIM);
  const itop = -T - I.depth;
  if (I.rim > 0) {
    // 顶面外圈一道金属边，内部是玻璃
    cap(m, IB, I.w / 2, I.h / 2, I.r, ifl, itop, -1, 16, MAT.ISLAND_RIM);
    const ir: number | [number, number] = Array.isArray(I.r) ? [I.r[0] - I.rim, I.r[1] - I.rim] : I.r - I.rim;
    cap(m, IB, I.w / 2 - I.rim, I.h / 2 - I.rim, ir, 0, itop - 0.03, -1, 16, I.mat === 'frame' ? MAT.FRAME : MAT.ISLAND, true);
  } else {
    cap(m, IB, I.w / 2, I.h / 2, I.r, ifl, itop, -1, 16, I.mat === 'frame' ? MAT.FRAME : MAT.ISLAND, true);
  }

  // 镜头：金属环 + 玻璃
  for (const [lx, ly, lr, lh] of s.lenses) {
    const L = basis([lx, iy + ly, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const top = itop - 0.05 - lh;
    const ring = Math.min(1.6, lr * 0.22);
    const lp = [
      { d: 0, w: itop + 0.1 },
      ...quarter(4, (p) => ({ d: 0.35 * (1 - Math.cos(p)), w: top + 0.35 - 0.35 * Math.sin(p) })),
      { d: ring, w: top },
      { d: ring, w: top + 0.5 },
    ];
    sweep(m, L, lr, lr, lr, lp, 24, MAT.LENS_RING);
    cap(m, L, lr, lr, lr, ring, top + 0.5, -1, 24, MAT.LENS_GLASS);
  }
  // 背面平贴部件（潜望/传感器窗口、闪光灯）
  for (const fl of s.flats) {
    const F = basis([fl.x, fl.y, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    cap(m, F, fl.w / 2, fl.h / 2, fl.r, 0, -T - 0.06, -1, 16, fl.mat);
  }

  // 侧键
  for (const [top, len, side] of s.buttons) {
    const Bt = basis([side * hw, hh - top - len / 2, -T / 2], [0, 0, 1], [0, 1, 0], [side, 0, 0]);
    const bw = s.buttonThick / 2, bf = 0.3, bh = s.buttonOut;
    const bp = [...quarter(4, (p) => ({ d: bf * (1 - Math.sin(p)), w: bh - bf * (1 - Math.cos(p)) })), { d: 0, w: -0.4 }];
    sweep(m, Bt, bw, len / 2, bw, bp, 8, MAT.BUTTON);
    cap(m, Bt, bw, len / 2, bw, bf, bh, 1, 8, MAT.BUTTON);
  }
  return m.build(scale);
}

/** 屏幕玻璃区域（正面），带 uv，着色器里再按真实显示区与圆角裁切。 */
export function buildScreenGeometry(s: BodySpec, scale = 0.001) {
  const m = new Builder();
  const B = basis([0, 0, 0.02], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  cap(m, B, s.W / 2, s.H / 2, s.R, s.glassInset, 0.02, 1, 32, 0);
  return m.build(scale);
}
