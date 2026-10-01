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

  // 蓝色顺序色阶，深 → 浅（dataviz 参考调色板 blue 700 → 100）。低值深、高值浅。
  const RAMP = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5',
    '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
  const RAMP_RGB = RAMP.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  function rampAt(t) {
    t = Math.min(Math.max(t, 0), 1) * (RAMP_RGB.length - 1);
    const i = Math.min(Math.floor(t), RAMP_RGB.length - 2), f = t - i;
    const a = RAMP_RGB[i], b = RAMP_RGB[i + 1];
    return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * f);
  }
  const rampCSS = (reverse) => {
    const c = reverse ? RAMP.slice().reverse() : RAMP;
    return `linear-gradient(90deg, ${c.map((h, i) => `${h} ${(i / (c.length - 1) * 100).toFixed(1)}%`).join(', ')})`;
  };

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
      sampler: null, fieldKey: '', spokes: [], hatch: [],
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
      for (let j = 0; j < N; j++) {
        const y = 1 - (j + 0.5) / N * 2;
        for (let i = 0; i < N; i++) {
          const x = (i + 0.5) / N * 2 - 1;
          const rr = Math.hypot(x, y);
          if (rr > 1.01) continue;
          const psiW = Math.atan2(y, x) / DEG;
          const c = rampAt(st.sampler(Math.min(rr, 1) * maxT, psiW + st.rot));
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

      // 无实测、靠镜像补全的扇区：45° 斜线纹理
      for (const [a0, a1] of st.hatch) {
        g.save();
        g.beginPath(); g.moveTo(G.cx, G.cy);
        g.arc(G.cx, G.cy, G.R + 1, -(a0 - st.rot) * DEG, -(a1 - st.rot) * DEG, true);
        g.closePath(); g.clip();
        g.strokeStyle = 'rgba(10,11,14,.45)'; g.lineWidth = 1.2;
        g.beginPath();
        for (let k = -2 * G.R; k < 2 * G.R; k += 5) { g.moveTo(G.cx + k - G.R, G.cy + G.R); g.lineTo(G.cx + k + G.R, G.cy - G.R); }
        g.stroke();
        g.restore();
      }

      // 等角圈（每 10°）
      g.lineWidth = 1;
      for (let t = 10; t < maxT; t += 10) {
        g.strokeStyle = t % 30 === 0 ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.12)';
        g.beginPath(); g.arc(G.cx, G.cy, (t / maxT) * G.R, 0, Math.PI * 2); g.stroke();
      }
      // 实测方向
      g.strokeStyle = 'rgba(255,255,255,.30)';
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
      /** sampler(θ, ψ_手机坐标) → 0..1；fieldKey 变化时重建热力图。 */
      setField(key, sampler) { if (key !== st.fieldKey) { st.fieldKey = key; st.sampler = sampler; heatKey = ''; } },
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
    const st = { series: [], cursor: 0, hover: null, jMax: 8, lMax: 100 };
    const PL = 30, PR = 8, PH = 58, TOP = 22;

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const at = (arr, t) => {
      const i = Math.min(Math.floor(t), arr.length - 2), f = t - i;
      return arr[i] + (arr[i + 1] - arr[i]) * f;
    };

    function chart(w, key, title, unit, yMax, ticks, fmt, showX) {
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

    function niceMax(v) {
      const steps = [1, 2, 2.5, 4, 5, 8, 10];
      const e = Math.pow(10, Math.floor(Math.log10(v)));
      return steps.map((s) => s * e).find((s) => s >= v) || 10 * e;
    }

    function render() {
      const w = el.clientWidth;
      if (!w || !st.series.length) { el.innerHTML = ''; return; }
      const lMax = st.lMax, jMax = niceMax(st.jMax);
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

  root.Viz = { createPad, createCharts, rampAt, rampCSS, RAMP, dirName, norm360 };
})(window);
