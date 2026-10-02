/*
 * 数据面板（默认收起，工具栏“数据”或 D 键打开）：
 *   观看方向盘——极坐标热力图，显示这块屏幕各方向的亮度 / 色偏，圆点是当前观看者（地铁场景两个人都标）；
 *   曲线——沿当前观看方向，亮度、色偏随离轴角的变化；有防窥数据时两条曲线对比。
 * 绘图沿用屏幕仿真模式的 web/viz.js（window.Viz），数据全部来自实测模型。
 */
import type { AngleModel } from './optics/model';
import { uvPrime, JNCD, norm360 } from './optics/model';

export interface PanelProfile { id: string; label: string; model: AngleModel; lut: { data: Float32Array; width: number }; active: boolean }
export interface PanelEye { theta: number; psi: number; who: string }

const SERIES = ['#3987e5', '#d95926'];

/** 由查找表算出亮度比与 JNCD 网格（θ 1° × ψ 1°），双线性插值采样。 */
function gridOf(model: AngleModel, lut: { data: Float32Array; width: number }) {
  const w = lut.width, refW = model.ref.W, refUV = uvPrime(refW);
  const lum = new Float32Array(w * 360), jn = new Float32Array(w * 360);
  for (let psi = 0; psi < 360; psi++) {
    for (let th = 0; th < w; th++) {
      const o = (((3 * 360) + psi) * w + th) * 4;
      const W = [lut.data[o], lut.data[o + 1], lut.data[o + 2]];
      const uv = uvPrime(W);
      lum[psi * w + th] = W[1] / refW[1];
      jn[psi * w + th] = Math.hypot(uv[0] - refUV[0], uv[1] - refUV[1]) / JNCD;
    }
  }
  const sample = (arr: Float32Array) => (theta: number, psi: number) => {
    const x = Math.min(Math.max(theta, 0), w - 1), x0 = Math.min(Math.floor(x), w - 2), fx = x - x0;
    const y = norm360(psi), y0 = Math.floor(y) % 360, y1 = (y0 + 1) % 360, fy = y - Math.floor(y);
    const a = arr[y0 * w + x0], b = arr[y0 * w + x0 + 1], c = arr[y1 * w + x0], d = arr[y1 * w + x0 + 1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  return { lum: sample(lum), jncd: sample(jn) };
}

export function createDataPanel(host: HTMLElement, maxTheta: number) {
  const el = document.createElement('div');
  el.className = 's3d-data';
  el.hidden = true;
  el.innerHTML = `
    <div class="s3d-data-h"><span>数据 <i data-d="dev"></i></span>
      <div class="s3d-seg mini" data-d="metric"><button data-v="lum" class="on">亮度</button><button data-v="jncd">色偏</button></div></div>
    <div class="s3d-data-body">
      <div class="s3d-pad-col">
        <canvas class="s3d-pad" aria-label="各观看方向的实测亮度 / 色偏"></canvas>
        <div class="s3d-pad-read" data-d="read"></div>
        <div class="s3d-pad-scale"><div class="s3d-ramp" data-d="ramp"></div><div class="s3d-ramp-ticks" data-d="ticks"></div></div>
      </div>
      <div class="s3d-curve-col">
        <div class="s3d-curve-h" data-d="dir"></div>
        <div class="s3d-legend" data-d="legend"></div>
        <div class="s3d-charts" data-d="charts"></div>
      </div>
    </div>`;
  host.appendChild(el);
  const q = (k: string) => el.querySelector(`[data-d="${k}"]`) as HTMLElement;
  const Viz = window.Viz;

  let metric: 'lum' | 'jncd' = 'lum';
  let hover: { theta: number; psi: number } | null = null;
  const grids = new Map<string, ReturnType<typeof gridOf>>();
  const gridFor = (p: PanelProfile) => grids.get(p.id) || (grids.set(p.id, gridOf(p.model, p.lut)), grids.get(p.id)!);
  const seriesCache = new Map<string, { lum: number[]; jncd: number[] }>();
  const seriesFor = (p: PanelProfile, psi: number) => {
    const key = `${p.id}|${Math.round(psi)}`;
    let s = seriesCache.get(key);
    if (!s) {
      s = { lum: [], jncd: [] };
      for (let t = 0; t <= maxTheta; t++) { const e = p.model.evalAt(t, Math.round(psi)); s.lum.push(e.yRatio * 100); s.jncd.push(e.jncd); }
      if (seriesCache.size > 200) seriesCache.clear();
      seriesCache.set(key, s);
    }
    return s;
  };

  const pad = Viz.createPad(el.querySelector('.s3d-pad') as HTMLCanvasElement, {
    maxTheta,
    onInput: () => { /* 只读：观看方向由场景决定 */ },
    onHover: (h) => { hover = h; readout(); },
  });
  const charts = Viz.createCharts(q('charts'), { maxTheta, onPick: () => { /* 只读 */ } });

  let last: { profiles: PanelProfile[]; eyes: PanelEye[]; jMax: number; device: string } | null = null;
  let lastKey = '';

  function readout() {
    if (!last) return;
    const act = last.profiles.find((p) => p.active) || last.profiles[0];
    const g = gridFor(act);
    const h = hover || last.eyes[0];
    if (!h) return;
    const v = g[metric](h.theta, h.psi);
    const where = h.theta < 0.5 ? '正对' : `${Math.round(h.theta)}° ${Viz.dirName(h.psi)}`;
    const val = metric === 'lum' ? `亮度 ${Math.round(v * 100)}%` : `色偏 ${v.toFixed(1)} JNCD`;
    q('read').innerHTML = `<span>${hover ? '指针处' : (last.eyes[0]?.who ?? '')}</span> ${where} · <b>${val}</b>`;
  }

  function render(force = false) {
    if (!last || el.hidden) return;
    const { profiles, eyes, jMax } = last;
    const act = profiles.find((p) => p.active) || profiles[0];
    const main = eyes[0];
    const key = `${act.id}|${metric}|${eyes.map((e) => `${e.theta.toFixed(1)},${e.psi.toFixed(0)}`).join('|')}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const g = gridFor(act);
    const levels = metric === 'lum' ? 10 : jMax / 2;
    pad.setField(`${act.id}|${metric}`, (th, ps) => (metric === 'lum' ? g.lum(th, ps) : g.jncd(th, ps) / jMax), { pal: 'jet', levels });
    const spokes = act.model.lines.filter((l) => !l.virtual).map((l) => l.psi);
    const hatch: [number, number][] = [];
    act.model.lines.forEach((l, i) => {
      const n = act.model.lines[(i + 1) % act.model.lines.length];
      if (l.virtual || n.virtual) hatch.push([l.psi, l.psi + (norm360(n.psi - l.psi) || 360)]);
    });
    pad.update({ theta: main.theta, psi: main.psi, rot: 0, spokes, hatch, eyes: eyes.length > 1 ? eyes.map((e) => [e.theta, e.psi]) : null });
    q('ramp').style.background = Viz.paletteCSS('jet', levels, false);
    q('ticks').innerHTML = (metric === 'lum' ? ['0%', '50%', '100%'] : ['0', String(jMax / 2), `${jMax} JNCD`]).map((t) => `<span>${t}</span>`).join('');
    q('dev').textContent = last.device;

    // 曲线：沿主观看者的方向；有防窥数据时两条对比
    const series = profiles.map((p, i) => ({ label: p.label, color: SERIES[i % 2], ...seriesFor(p, main.psi) }));
    q('dir').textContent = `沿${main.theta < 0.5 ? '右侧' : Viz.dirName(main.psi)}方向 · 屏幕中心`;
    const leg = series.length > 1 ? series.map((s, i) => `<span class="${profiles[i].active ? 'on' : ''}"><i style="background:${s.color}"></i>${s.label}</span>`).join('') : '';
    if (q('legend').dataset.html !== leg) { q('legend').innerHTML = leg; q('legend').dataset.html = leg; }
    charts.update({ series, cursor: Math.min(main.theta, maxTheta), jMax, lMax: 100, ph: 44 });
    readout();
  }

  q('metric').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    metric = b.dataset.v as 'lum' | 'jncd';
    q('metric').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    render(true);
  });

  return {
    el,
    get visible() { return !el.hidden; },
    setVisible(v: boolean) { el.hidden = !v; if (v) requestAnimationFrame(() => { pad.draw(); charts.render(); render(true); }); },
    update(profiles: PanelProfile[], eyes: PanelEye[], jMax: number, device: string) {
      last = { profiles, eyes, jMax, device };
      render();
    },
  };
}
