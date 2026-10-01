/*
 * 界面里的两个数据图：
 *   Viz.createPad    观看方向极坐标盘（热力图 + 拖动设置方向）
 *   Viz.createCharts 亮度 / 色偏随离轴角变化的小多图
 * 只负责绘制和交互，数据由 app.js 提供。
 */
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const norm360 = (a) => ((a % 360) + 360) % 360;

  // ---------- 色阶 ----------
  // 单色蓝：dataviz 参考调色板 blue 700 → 100，低值深、高值浅
  const RAMP = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5',
    '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lerpStops = (stops) => (t) => {
    t = Math.min(Math.max(t, 0), 1);
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    return c0.map((v, k) => v + (c1[k] - v) * f);
  };
  // 仪器常用的 Jet 彩虹：深蓝 → 蓝 → 青 → 黄 → 红 → 深红
  const JET = lerpStops([[0, [0, 0, 0.5]], [0.125, [0, 0, 1]], [0.375, [0, 1, 1]], [0.625, [1, 1, 0]], [0.875, [1, 0, 0]], [1, [0.5, 0, 0]]]);
  // Turbo（Google 2019）：彩虹的改良版，亮度变化更均匀，不容易看出假边界
  const TURBO = (x) => {
    x = Math.min(Math.max(x, 0), 1);
    const v4 = [1, x, x * x, x * x * x], v2 = [x ** 4, x ** 5];
    const dot = (a, b) => a.reduce((s, q, j) => s + q * b[j], 0);
    return [
      dot(v4, [0.13572138, 4.6153926, -42.66032258, 132.13108234]) + dot(v2, [-152.94239396, 59.28637943]),
      dot(v4, [0.09140261, 2.19418839, 4.84296658, -14.18503333]) + dot(v2, [4.27729857, 2.82956604]),
      dot(v4, [0.1066733, 12.64194608, -60.58204836, 110.36276771]) + dot(v2, [-89.90310912, 27.34824973]),
    ].map((v) => Math.min(Math.max(v, 0), 1));
  };
  const MONO = lerpStops(RAMP.map((h, i) => [i / (RAMP.length - 1), hex(h)]));

  /**
   * banded: 按等值线分级显示（每一级一个颜色）；grid: 网格线用深色还是浅色；
   * flipAngle: 离轴角分布里是否反向（单色蓝让 0° 为浅色）。
   */
  const PALETTES = {
    jet: { label: '仪器彩虹', fn: JET, banded: false, grid: 'dark', flipAngle: false },
    band: { label: '分级色带', fn: JET, banded: true, grid: 'dark', flipAngle: false },
    turbo: { label: 'Turbo', fn: TURBO, banded: false, grid: 'dark', flipAngle: false },
    mono: { label: '单色蓝', fn: MONO, banded: false, grid: 'light', flipAngle: true },
  };
  const palette = (name) => PALETTES[name] || PALETTES.jet;
  /** 0..1 → [r, g, b] 0..255；levels > 0 且分级时取所在级的中间色。 */
  function colorAt(name, t, levels) {
    const P = palette(name);
    if (P.banded && levels > 0) t = (Math.min(Math.floor(Math.min(Math.max(t, 0), 1) * levels), levels - 1) + 0.5) / levels;
    return P.fn(t).map((v) => Math.round(v * 255));
  }
  /** 图例用的 CSS 渐变；分级时为硬边色块。 */
  function paletteCSS(name, levels, reverse) {
    const P = palette(name), stops = [];
    const at = (t) => `rgb(${colorAt(name, reverse ? 1 - t : t, levels).join(',')})`;
    if (P.banded && levels > 0) {
      for (let i = 0; i < levels; i++) {
        const c = at((i + 0.5) / levels);
        stops.push(`${c} ${(i / levels * 100).toFixed(2)}%`, `${c} ${((i + 1) / levels * 100).toFixed(2)}%`);
      }
    } else {
      for (let i = 0; i <= 24; i++) stops.push(`${at(i / 24)} ${(i / 24 * 100).toFixed(1)}%`);
    }
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  }
  /** 256×1 RGBA 色表，给着色器用（连续色，分级在着色器里做）。 */
  function paletteBytes(name, reverse) {
    const P = palette(name), out = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const c = P.fn(reverse ? 1 - i / 255 : i / 255);
      out.set([c[0] * 255, c[1] * 255, c[2] * 255, 255].map(Math.round), i * 4);
    }
    return out;
  }

  // 眼睛方向的文字描述（ψ 为观看者视角下的方位：0 右、90 上）
  const DIR8 = ['右侧', '右上方', '上方', '左上方', '左侧', '左下方', '下方', '右下方'];
  const dirName = (psi) => DIR8[Math.round(norm360(psi) / 45) % 8];

  function hidpi(canvas) {
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h, dpr };
  }

  /**
   * 观看方向盘。坐标：圆心 = 正对屏幕，半径 ∝ 离轴角（外圈 = maxTheta），
   * 方位为观看者看到的方向（右 = 眼睛在屏幕右侧）。
   * opts.onInput(theta, psi, done)
   */
  function createPad(canvas, opts) {
    const maxT = opts.maxTheta || 70;
    const st = {
      theta: 0, psi: 0, rot: 0, eyes: null,
      sampler: null, fieldKey: '', spokes: [], hatch: [], pal: 'jet', levels: 10,
      hover: null, dragging: false,
    };
    let heat = null, heatKey = '';
    const M = 16;   // 外圈文字留白

    function geom() {
      const w = canvas.clientWidth;
      return { w, cx: w / 2, cy: w / 2, R: w / 2 - M };
    }

    function buildHeat(R, dpr) {
      const N = Math.max(8, Math.round(2 * R * dpr));
      const key = `${st.fieldKey}|${st.rot}|${N}`;
      if (key === heatKey && heat) return heat;
      heatKey = key;
      heat = heat || document.createElement('canvas');
      heat.width = heat.height = N;
      const g = heat.getContext('2d');
      const img = g.createImageData(N, N), d = img.data;
      // 先采样数值，再上色并描等值线（相邻像素跨级处画黑线，和仪器导出图一样）
      const T = new Float32Array(N * N).fill(NaN);
      for (let j = 0; j < N; j++) {
        const y = 1 - (j + 0.5) / N * 2;
        for (let i = 0; i < N; i++) {
          const x = (i + 0.5) / N * 2 - 1;
          const rr = Math.hypot(x, y);
          if (rr > 1.01) continue;
          const psiW = Math.atan2(y, x) / DEG;
          T[j * N + i] = Math.min(Math.max(st.sampler(Math.min(rr, 1) * maxT, psiW + st.rot), 0), 1);
        }
      }
      const L = st.levels;
      const lvl = (t) => Math.min(Math.floor(t * L), L - 1);
      const lineW = Math.max(1, Math.round(dpr * 0.6));
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const t = T[j * N + i];
          if (Number.isNaN(t)) continue;
          let c = colorAt(st.pal, t, L);
          const q = lvl(t);
          let edge = false;
          for (let k = 1; k <= lineW && !edge; k++) {
            const r = i + k < N ? T[j * N + i + k] : NaN, b = j + k < N ? T[(j + k) * N + i] : NaN;
            edge = (!Number.isNaN(r) && lvl(r) !== q) || (!Number.isNaN(b) && lvl(b) !== q);
          }
          if (edge) c = palette(st.pal).grid === 'dark' ? c.map((v) => v * 0.25) : c.map((v) => v + (255 - v) * 0.45);
          const o = (j * N + i) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      return heat;
    }

    const toXY = (th, psi, G) => {
      const r = (th / maxT) * G.R;
      return [G.cx + r * Math.cos(psi * DEG), G.cy - r * Math.sin(psi * DEG)];
    };

    function draw() {
      const { g, dpr } = hidpi(canvas);
      const G = geom();
      g.clearRect(0, 0, G.w, G.w);
      if (!st.sampler || G.R <= 0) return;

      // 热力图
      g.save();
      g.beginPath(); g.arc(G.cx, G.cy, G.R, 0, Math.PI * 2); g.clip();
      g.imageSmoothingEnabled = true;
      g.drawImage(buildHeat(G.R, dpr), G.cx - G.R, G.cy - G.R, 2 * G.R, 2 * G.R);

      const dark = palette(st.pal).grid === 'dark';
      // 无实测、靠镜像补全的扇区：45° 斜线纹理
      for (const [a0, a1] of st.hatch) {
        g.save();
        g.beginPath(); g.moveTo(G.cx, G.cy);
        g.arc(G.cx, G.cy, G.R + 1, -(a0 - st.rot) * DEG, -(a1 - st.rot) * DEG, true);
        g.closePath(); g.clip();
        g.strokeStyle = dark ? 'rgba(255,255,255,.42)' : 'rgba(10,11,14,.45)'; g.lineWidth = 1;
        g.beginPath();
        for (let k = -2 * G.R; k < 2 * G.R; k += 5) { g.moveTo(G.cx + k - G.R, G.cy + G.R); g.lineTo(G.cx + k + G.R, G.cy - G.R); }
        g.stroke();
        g.restore();
      }

      // 等角圈（每 10°）
      g.lineWidth = 1;
      for (let t = 10; t < maxT; t += 10) {
        g.strokeStyle = dark
          ? (t % 30 === 0 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)')
          : (t % 30 === 0 ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.12)');
        g.beginPath(); g.arc(G.cx, G.cy, (t / maxT) * G.R, 0, Math.PI * 2); g.stroke();
      }
      // 实测方向
      g.strokeStyle = dark ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.30)';
      g.beginPath();
      for (const p of st.spokes) {
        const [x, y] = toXY(maxT, p - st.rot, G);
        g.moveTo(G.cx, G.cy); g.lineTo(x, y);
      }
      g.stroke();
      g.restore();

      // 外圈
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
      g.beginPath(); g.arc(G.cx, G.cy, G.R + 0.5, 0, Math.PI * 2); g.stroke();

      // 刻度文字（带暗色描边保证在任何底色上可读）
      g.font = '500 10.5px system-ui, sans-serif';
      g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.lineJoin = 'round';
      for (const t of [30, 60]) {
        const y = G.cy - (t / maxT) * G.R - 1;
        g.strokeStyle = 'rgba(8,9,12,.8)'; g.lineWidth = 3; g.strokeText(t + '°', G.cx + 3, y);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(t + '°', G.cx + 3, y);
      }
      g.fillStyle = '#737985';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('右', G.cx + G.R + M / 2, G.cy);
      g.fillText('左', G.cx - G.R - M / 2, G.cy);
      g.fillText('上', G.cx, G.cy - G.R - M / 2);
      g.fillText('下', G.cx, G.cy + G.R + M / 2);

      // 悬停位置
      if (st.hover && !st.dragging) {
        const [hx, hy] = toXY(st.hover.theta, st.hover.psi, G);
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(hx, hy, 5, 0, Math.PI * 2); g.stroke();
      }

      // 当前眼睛方向
      const eyes = st.eyes || [[st.theta, st.psi]];
      const [ex, ey] = toXY(st.theta, st.psi, G);
      g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(G.cx, G.cy); g.lineTo(ex, ey); g.stroke();
      for (const [t, p] of eyes) {
        const [x, y] = toXY(t, p, G);
        g.fillStyle = '#fff'; g.strokeStyle = '#0d0e11'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, eyes.length > 1 ? 4.5 : 6, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(G.cx, G.cy, 2, 0, Math.PI * 2); g.fill();
    }

    // 指针 → (θ, ψ)，带轻微吸附：θ 吸到整度 / 0°，ψ 在 ±4° 内吸到 15° 的倍数
    function pick(e) {
      const rc = canvas.getBoundingClientRect(), G = geom();
      const x = e.clientX - rc.left - G.cx, y = -(e.clientY - rc.top - G.cy);
      let th = Math.min((Math.hypot(x, y) / G.R) * maxT, maxT);
      let psi = norm360(Math.atan2(y, x) / DEG);
      const snap = Math.round(psi / 15) * 15;
      if (Math.abs(psi - snap) < 4) psi = norm360(snap);
      th = th < 1.5 ? 0 : Math.round(th);
      return { theta: th, psi, inside: Math.hypot(x, y) <= G.R + M };
    }
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      st.dragging = true;
      const p = pick(e);
      opts.onInput(p.theta, p.psi, false);
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pick(e);
      if (st.dragging) { opts.onInput(p.theta, p.psi, false); return; }
      st.hover = p.inside && e.pointerType === 'mouse' ? p : null;
      opts.onHover && opts.onHover(st.hover);
      draw();
    });
    const end = (e) => {
      if (!st.dragging) return;
      st.dragging = false;
      const p = pick(e);
      opts.onInput(p.theta, p.psi, true);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => { st.dragging = false; });
    canvas.addEventListener('pointerleave', () => { st.hover = null; opts.onHover && opts.onHover(null); draw(); });

    return {
      /** sampler(θ, ψ_手机坐标) → 0..1；o.pal 色阶名，o.levels 等值线级数；fieldKey 变化时重建热力图。 */
      setField(key, sampler, o) {
        if (key === st.fieldKey) return;
        st.fieldKey = key; st.sampler = sampler; heatKey = '';
        Object.assign(st, o || {});
      },
      update(s) { Object.assign(st, s); draw(); },
      draw,
    };
  }

  /**
   * 亮度、色偏两张小多图，共用 x 轴（离轴角 0…maxTheta）。
   * series: [{ label, color, lum: number[], jncd: number[] }]，数组按 1° 采样。
   */
  function createCharts(el, opts) {
    const maxT = opts.maxTheta || 70;
    const st = { series: [], cursor: 0, hover: null, jMax: 8, lMax: 100, ph: 58 };
    const PL = 30, PR = 8, TOP = 22;

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const at = (arr, t) => {
      const i = Math.min(Math.floor(t), arr.length - 2), f = t - i;
      return arr[i] + (arr[i + 1] - arr[i]) * f;
    };

    function chart(w, key, title, unit, yMax, ticks, fmt, showX) {
      const PH = st.ph;
      const H = TOP + PH + (showX ? 18 : 6);
      const X = (t) => PL + (t / maxT) * (w - PL - PR);
      const Y = (v) => TOP + PH - (Math.min(v, yMax) / yMax) * PH;
      let s = `<svg viewBox="0 0 ${w} ${H}" height="${H}" data-k="${key}" role="img" aria-label="${esc(title)}随离轴角变化">`;
      for (const v of ticks) {
        s += `<line class="${v === 0 ? 'ch-base' : 'ch-grid'}" x1="${PL}" x2="${w - PR}" y1="${Y(v)}" y2="${Y(v)}"/>`;
        s += `<text class="ch-tick" x="${PL - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`;
      }
      if (showX) {
        for (let t = 0; t <= maxT; t += 10) {
          if (t % 20 && t !== maxT) continue;
          s += `<text class="ch-tick" x="${X(t)}" y="${TOP + PH + 14}" text-anchor="middle">${t}°</text>`;
        }
      }
      st.series.forEach((sr) => {
        const arr = sr[key];
        let d = '';
        for (let t = 0; t <= maxT; t++) d += (t ? 'L' : 'M') + X(t).toFixed(1) + ',' + Y(arr[t]).toFixed(1);
        if (st.series.length === 1) {
          s += `<path d="${d}L${X(maxT)},${Y(0)}L${X(0)},${Y(0)}Z" fill="${sr.color}" fill-opacity=".12"/>`;
        }
        s += `<path class="ch-line" d="${d}" stroke="${sr.color}"/>`;
      });
      const mark = (t, cls) => {
        let m = `<line class="${cls}" x1="${X(t)}" x2="${X(t)}" y1="${TOP - 2}" y2="${TOP + PH}"/>`;
        st.series.forEach((sr) => {
          m += `<circle cx="${X(t)}" cy="${Y(at(sr[key], t))}" r="4" fill="${sr.color}" stroke="#141518" stroke-width="2"/>`;
        });
        return m;
      };
      s += mark(st.cursor, 'ch-cursor');
      if (st.hover != null) s += mark(st.hover, 'ch-hover');

      // 标题行：左侧名称，右侧为当前（或悬停处）读数
      const t = st.hover != null ? st.hover : st.cursor;
      const vals = st.series.map((sr) =>
        (st.series.length > 1 ? `<tspan fill="${sr.color}">●</tspan> ` : '') + `<tspan class="ch-val">${fmt(at(sr[key], t))}</tspan>`).join('  ');
      s += `<text class="ch-title" x="0" y="12">${esc(title)}<tspan class="ch-tick" dx="4">${esc(unit)}</tspan></text>`;
      s += `<text class="ch-title" x="${w - PR}" y="12" text-anchor="end"><tspan class="ch-tick">${Math.round(t)}° </tspan>${vals}</text>`;
      s += `<rect class="ch-hit" x="${PL}" y="0" width="${w - PL - PR}" height="${H}"/>`;
      return s + '</svg>';
    }

    function render() {
      const w = el.clientWidth;
      if (!w || !st.series.length) { el.innerHTML = ''; return; }
      const lMax = st.lMax, jMax = st.jMax;   // 量程由调用方固定，切换机型时刻度不跳
      el.innerHTML =
        chart(w, 'lum', '相对亮度', '%', lMax, [0, 50, 100].filter((v) => v <= lMax), (v) => Math.round(v) + '%', false) +
        chart(w, 'jncd', '色偏', 'JNCD', jMax, [0, jMax / 2, jMax], (v) => v.toFixed(1), true);
    }

    const thetaAt = (e) => {
      const rc = el.getBoundingClientRect();
      const t = ((e.clientX - rc.left - PL) / (rc.width - PL - PR)) * maxT;
      return Math.min(Math.max(Math.round(t), 0), maxT);
    };
    let down = false;
    el.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.ch-hit')) return;
      down = true; el.setPointerCapture(e.pointerId);
      opts.onPick(thetaAt(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (down) { opts.onPick(thetaAt(e)); return; }
      const h = e.target.closest('.ch-hit') ? thetaAt(e) : null;
      if (h !== st.hover) { st.hover = h; render(); }
    });
    el.addEventListener('pointerup', () => { down = false; });
    el.addEventListener('pointerleave', () => { if (st.hover != null) { st.hover = null; render(); } });

    return {
      update(s) { Object.assign(st, s); render(); },
      render,
    };
  }

  root.Viz = { createPad, createCharts, PALETTES, palette, colorAt, paletteCSS, paletteBytes, dirName, norm360 };
})(window);
