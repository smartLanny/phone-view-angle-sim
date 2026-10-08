/*
 * 手机机身几何（单位 mm），具体机型参数见 devices.js。
 * 局部坐标: x 右、y 上、z 指向屏幕外；原点在屏幕玻璃中心（旋转锚点），机身向 −z 延伸。
 */
(function (root) {
  'use strict';

  const SPEC = {
    W: 77.6, H: 163.39, T: 8.39,
    R: 12.2,              // 机身圆角
    glassInset: 1.16,     // 正面玻璃边缘到机身外轮廓
    backInset: 1.3,
    fillet: 1.25,         // 中框前后圆弧高度
    sideBulge: 0.12,      // 中框微弧外凸量
    // 背部相机模组；islandR 可为 [上圆角, 下圆角]
    islandW: 65.5, islandH: 41, islandTop: 5, islandR: 8, islandDepth: 2.8,
    islandMat: 'glass',   // 'glass' 深色玻璃 | 'frame' 与中框同材质
    lenses: [],           // [x, y, 半径, 凸起高度]，相对模组中心、正面视角坐标；高度 0 为平面部件
    buttons: [[41, 21, 1], [68, 11, 1]],   // [距顶部, 长度, 侧(1 右 / −1 左)]
    buttonThick: 2.6, buttonOut: 0.55,
  };

  const MAT = { FRAME: 0, BACK: 1, ISLAND: 2, BUTTON: 3 };

  function outline(hw, hh, r, segs) {
    const [rt, rb] = Array.isArray(r) ? r : [r, r];
    const pts = [];
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

  function basis(origin, U, V, W) {
    return {
      p: (u, v, w) => [0, 1, 2].map((k) => origin[k] + U[k] * u + V[k] * v + W[k] * w),
      n: (a, b, c) => {
        const v = [0, 1, 2].map((k) => U[k] * a + V[k] * b + W[k] * c);
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return v.map((x) => x / l);
      },
    };
  }

  class Mesh {
    constructor() { this.pos = []; this.nor = []; this.mat = []; this.uv = []; this.idx = []; }
    vert(p, n, m, uv = [0, 0]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.mat.push(m); this.uv.push(uv[0], uv[1]); return this.mat.length - 1; }
  }

  /**
   * 把截面轮廓沿圆角矩形扫掠成侧壁。profile 为 {d: 向内缩进, w: 高度}，
   * 须从“顶面一侧”按 w 递减排列，法线据此朝外。
   */
  function sweep(mesh, B, hw, hh, r, profile, segs, mat) {
    const ol = outline(hw, hh, r, segs);
    const np = profile.length;
    const pn = profile.map((_, j) => {
      const a = profile[Math.max(j - 1, 0)], b = profile[Math.min(j + 1, np - 1)];
      const dr = -(b.d - a.d), dw = b.w - a.w;
      const l = Math.hypot(dw, dr) || 1;
      return [-dw / l, dr / l];
    });
    const base = mesh.mat.length;
    for (const o of ol) {
      for (let j = 0; j < np; j++) {
        const rad = o.r - profile[j].d;
        const u = o.c[0] + o.n[0] * rad, v = o.c[1] + o.n[1] * rad;
        mesh.vert(B.p(u, v, profile[j].w), B.n(o.n[0] * pn[j][0], o.n[1] * pn[j][0], pn[j][1]), mat);
      }
    }
    const m = ol.length;
    for (let i = 0; i < m; i++) {
      const i2 = (i + 1) % m;
      for (let j = 0; j < np - 1; j++) {
        const a = base + i * np + j, b = base + i2 * np + j;
        mesh.idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }

  function cap(mesh, B, hw, hh, r, d, w, nw, segs, mat, uvOf = null) {
    const ol = outline(hw, hh, r, segs);
    const n = B.n(0, 0, nw);
    const c = mesh.vert(B.p(0, 0, w), n, mat, uvOf ? uvOf(0, 0) : undefined);
    const first = mesh.mat.length;
    for (const o of ol) {
      const rad = o.r - d;
      const x = o.c[0] + o.n[0] * rad, y = o.c[1] + o.n[1] * rad;
      mesh.vert(B.p(x, y, w), n, mat, uvOf ? uvOf(x, y) : undefined);
    }
    for (let i = 0; i < ol.length; i++) mesh.idx.push(c, first + i, first + ((i + 1) % ol.length));
  }

  function quarter(n, fn) {
    const out = [];
    for (let k = 0; k <= n; k++) out.push(fn(((k / n) * Math.PI) / 2));
    return out;
  }

  function build(overrides) {
    const s = Object.assign({}, SPEC, overrides || {});
    const hw = s.W / 2, hh = s.H / 2, T = s.T, f = s.fillet, sb = s.sideBulge;
    const body = new Mesh(), screen = new Mesh();
    const B = basis([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const backUv = s.backTextureCrop && ((x, y) => {
      const [u0, v0, u1, v1] = s.backTextureCrop;
      return [u0 + ((hw - x) / s.W) * (u1 - u0), 1 - v1 + ((y + hh) / s.H) * (v1 - v0)];
    });

    const prof = [
      ...quarter(8, (p) => ({ d: sb + (s.glassInset - sb) * (1 - Math.sin(p)), w: -f * (1 - Math.cos(p)) })),
    ];
    for (let k = 1; k < 8; k++) {
      const w = -f - ((T - 2 * f) * k) / 8;
      const t = (w + T / 2) / (T / 2 - f);
      prof.push({ d: sb * t * t, w });
    }
    prof.push(...quarter(8, (p) => ({ d: sb + (s.backInset - sb) * (1 - Math.sin(p)), w: -T + f * (1 - Math.cos(p)) })).reverse());
    sweep(body, B, hw, hh, s.R, prof, 24, MAT.FRAME);
    cap(body, B, hw, hh, s.R, s.backInset, -T, -1, 24, MAT.BACK, backUv);

    const iy = hh - s.islandTop - s.islandH / 2;
    const I = basis([0, iy, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const ifl = 1.0;
    const iprof = [{ d: 0, w: -T + 0.2 }, ...quarter(6, (p) => ({ d: ifl * (1 - Math.cos(p)), w: -T - (s.islandDepth - ifl) - ifl * Math.sin(p) }))];
    sweep(body, I, s.islandW / 2, s.islandH / 2, s.islandR, iprof, 16, MAT.FRAME);
    cap(body, I, s.islandW / 2, s.islandH / 2, s.islandR, ifl, -T - s.islandDepth, -1, 16,
      s.islandMat === 'frame' ? MAT.FRAME : MAT.ISLAND, backUv && ((x, y) => backUv(x, iy + y)));

    const itop = -T - s.islandDepth;
    for (const [lx, ly, lr, lh] of s.lenses) {
      const L = basis([lx, iy + ly, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
      if (lh > 0) {
        const lf = 0.4, ring = Math.min(1.4, lr * 0.2), top = itop - lh;
        const lp = [
          { d: 0, w: itop + 0.1 },
          ...quarter(4, (p) => ({ d: lf * (1 - Math.cos(p)), w: top + lf - lf * Math.sin(p) })),
          { d: ring, w: top },
          { d: ring, w: top + 0.35 },
        ];
        sweep(body, L, lr, lr, lr, lp, 20, MAT.FRAME);
        cap(body, L, lr, lr, lr, ring, top + 0.35, -1, 20, MAT.ISLAND,
          backUv && ((x, y) => backUv(lx + x, iy + ly + y)));
      } else {
        cap(body, L, lr, lr, lr, 0, itop - 0.05, -1, 12, MAT.ISLAND,
          backUv && ((x, y) => backUv(lx + x, iy + ly + y)));
      }
    }

    for (const [top, len, side = 1] of s.buttons) {
      const Bt = basis([side * hw, hh - top - len / 2, -T / 2], [0, 0, 1], [0, 1, 0], [side, 0, 0]);
      const bw = s.buttonThick / 2, bf = 0.3, bh = s.buttonOut;
      const bp = [...quarter(4, (p) => ({ d: bf * (1 - Math.sin(p)), w: bh - bf * (1 - Math.cos(p)) })), { d: 0, w: -0.4 }];
      sweep(body, Bt, bw, len / 2, bw, bp, 8, MAT.BUTTON);
      cap(body, Bt, bw, len / 2, bw, bf, bh, 1, 8, MAT.BUTTON);
    }

    cap(screen, B, hw, hh, s.R, s.glassInset, 0, 1, 24, 0);
    return { body, screen, spec: s };
  }

  root.Phone3D = { build, SPEC, MAT };
})(window);
