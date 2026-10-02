/*
 * 双眼视差演示（从人眼视角出发）：
 *   两只眼睛相距一个瞳距（默认 63 mm），都注视屏幕中心，各自从自己的位置看同一块屏幕。
 *   开始时画面就是人眼视角的整体画面；随后从正中间分开成左右两半，两半各自滑开、缩成左眼 / 右眼完整看到的画面
 *   （两眼的位置也从中点逐渐分到各自的位置），再滑回中间叠在一起（各 50%）。
 *   叠在一起时模拟大脑的融合：两眼都注视屏幕中心，融合把两眼的错位拉回大半（镜头向两眼中点靠拢，保留 FUSE_KEEP 的视差），
 *   所以屏幕中心对齐、越往边缘（和屏幕中心不在同一深度的地方）越能看出轻微的不重合；
 *   屏幕颜色仍按各自眼睛的位置算，并按双眼累加（平方和）放大色偏：两眼各自有色偏、角度又不同，
 *   叠在一起比只用一只眼（或两眼中点）看更容易看出偏色。亮度不放大（双眼看亮度接近平均）。
 *   退出时反过来合回一个整体，再回到普通的人眼视角。
 * 屏幕着色仍按“这只眼睛”的位置查实测数据，所以两边的亮度 / 色偏是真实的差别；
 * 叠加是示意：画面各取一半混合，色偏按双眼累加放大，不代表大脑实际融合出来的样子。
 *
 * 渲染：每只眼睛先画到主画布左下角的一块区域，再拷到各自的面板画布上（同一套色调映射与 sRGB 输出，颜色和主画面一致）。
 */
import * as THREE from 'three';
import { anglesOf, xyzToLab, deltaE2000, uvPrime, JNCD, type AngleModel, type Eval } from './optics/model';
import { SECOND } from './annotate';

export type StereoLayout = 'split' | 'overlay' | 'wiggle';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
type Rect = [number, number, number, number];
const mixR = (a: Rect, b: Rect, t: number): Rect => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t), mix(a[3], b[3], t)];
/** 自动播放的时间轴（ms，从镜头到达人眼后算起）：停在整体画面 → 从中间分开 → 并排停留 → 叠在一起 */
const T = { whole: 800, split: 2600, hold: 5800, merge: 7400 };
/** 叠在一起时保留的视差比例（0 = 完全对齐，1 = 两眼原本的错位） */
const FUSE_KEEP = 0.25;
/** 双眼累加后的色偏（JNCD）：两眼各自的色偏按平方和合成 */
const binoShift = (l: number, r: number) => Math.hypot(l, r);

/** s：0 = 一个整体（人眼视角）→ 1 = 左右眼并排；o：0 = 并排 → 1 = 叠在一起 */
interface Look { s: number; o: number }
export interface EyeRead { theta: number; ev: Eval; eye: THREE.Vector3 }

export class Stereo {
  /** 正在显示（含退出时合回整体的动画） */
  active = false;
  ipd = 0.063;
  layout: StereoLayout = 'split';
  private t0 = 0;
  private auto = true;
  private exiting = false;
  private frozen: number | null = null;          // 调试：把时间轴停在某一刻
  private tween: { from: Look; to: Look; t0: number; dur: number } | null = null;
  private cur: Look = { s: 0, o: 0 };
  private wiggleT0 = 0;

  private el: HTMLDivElement;
  private panels: { wrap: HTMLDivElement; cv: HTMLCanvasElement; g: CanvasRenderingContext2D; badge: HTMLDivElement }[];
  private info: HTMLDivElement;
  private camL = new THREE.PerspectiveCamera(40, 0.8, 0.01, 30);
  private camR = new THREE.PerspectiveCamera(40, 0.8, 0.01, 30);
  reads: [EyeRead, EyeRead] | null = null;
  onChange: () => void = () => {};
  onExit: () => void = () => {};

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 's3d-stereo';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="st-back"></div>
      ${['L', 'R'].map((e) => `<div class="st-panel" data-eye="${e}"><canvas></canvas><div class="st-badge"></div></div>`).join('')}
      <div class="st-tag" data-st="tag"><b>左眼 + 右眼</b>叠加 · 色偏按双眼累加</div>
      <div class="st-info">
        <div class="st-diff" data-st="diff"></div>
        <div class="st-ctrl">
          <div class="s3d-seg" data-st="layout"><button data-v="split">并排</button><button data-v="overlay">叠加</button><button data-v="wiggle">左右交替</button></div>
          <label class="st-ipd"><span>瞳距</span><input type="range" data-st="ipd" min="54" max="72" step="1" value="63"><b data-st="ipdV">63 mm</b></label>
          <button class="s3d-btn" data-st="replay">重播</button>
          <button class="s3d-btn" data-st="exit">退出</button>
        </div>
      </div>`;
    host.prepend(this.el);
    this.panels = [...this.el.querySelectorAll('.st-panel')].map((w) => {
      const cv = w.querySelector('canvas') as HTMLCanvasElement;
      return { wrap: w as HTMLDivElement, cv, g: cv.getContext('2d')!, badge: w.querySelector('.st-badge') as HTMLDivElement };
    });
    this.info = this.el.querySelector('.st-info') as HTMLDivElement;
    const q = (k: string) => this.el.querySelector(`[data-st="${k}"]`) as HTMLElement;
    q('layout').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b) this.setLayout(b.dataset.v as StereoLayout);
    });
    q('ipd').addEventListener('input', (e) => this.setIpd(+(e.target as HTMLInputElement).value));
    q('replay').addEventListener('click', () => this.replay());
    q('exit').addEventListener('click', () => this.onExit());
  }

  /** 正在做动画（自动播放、切换显示方式、退出合拢）——演示序列等它结束再走下一步 */
  get busy() { return this.active && (this.auto || !!this.tween || this.exiting || !this.t0); }
  /** 是否正在退出（合回整体） */
  get leaving() { return this.exiting; }

  setIpd(mm: number) {
    this.ipd = mm / 1000;
    (this.el.querySelector('[data-st="ipd"]') as HTMLInputElement).value = String(mm);
    (this.el.querySelector('[data-st="ipdV"]') as HTMLElement).textContent = `${mm} mm`;
  }

  start() {
    if (this.active && !this.exiting) return;
    this.active = true;
    this.exiting = false;
    this.t0 = 0; this.auto = true; this.tween = null; this.frozen = null;
    this.cur = { s: 0, o: 0 };
    this.el.classList.remove('out');
    this.syncLayoutBtn();
    this.onChange();
  }
  /** animated：合回一个整体再退出（留在人眼视角时用）；false：立刻收起（镜头要离开人眼时用） */
  stop(animated = true) {
    if (!this.active) return;
    if (animated && this.t0 && !this.el.hidden) {
      if (this.exiting) return;
      this.exiting = true; this.auto = false; this.frozen = null;
      this.tween = { from: { ...this.cur }, to: { s: 0, o: 0 }, t0: performance.now(), dur: 900 };
      this.onChange();
      return;
    }
    this.finish();
  }
  private finish() {
    this.active = false; this.exiting = false; this.tween = null;
    this.el.hidden = true;
    this.onChange();
  }
  replay() { this.t0 = 0; this.auto = true; this.tween = null; this.frozen = null; this.exiting = false; this.cur = { s: 0, o: 0 }; this.syncLayoutBtn(); }
  /** 调试 / 截图：把自动播放停在时间轴的 ms 处 */
  seek(ms: number) { this.auto = true; this.tween = null; this.frozen = ms; }
  setLayout(l: StereoLayout) {
    if (!this.active) return;
    this.auto = false;
    this.frozen = null;
    this.exiting = false;
    this.layout = l;
    const to: Look = l === 'split' ? { s: 1, o: 0 } : { s: 1, o: 1 };
    this.tween = { from: { ...this.cur }, to, t0: performance.now(), dur: this.cur.s < 0.5 ? 1600 : 800 };
    if (l === 'wiggle') this.wiggleT0 = performance.now();
    this.syncLayoutBtn();
  }
  private syncLayoutBtn() {
    this.el.querySelectorAll('[data-st="layout"] button').forEach((b) =>
      b.classList.toggle('on', !this.auto && (b as HTMLElement).dataset.v === this.layout));
  }

  private autoLook(e: number): Look {
    if (e < T.whole) return { s: 0, o: 0 };
    if (e < T.split) return { s: ease(clamp01((e - T.whole) / (T.split - T.whole))), o: 0 };
    if (e < T.hold) return { s: 1, o: 0 };
    if (e < T.merge) return { s: 1, o: ease(clamp01((e - T.hold) / (T.merge - T.hold))) };
    return { s: 1, o: 1 };
  }

  /**
   * 每帧（镜头已在人眼视角时）调用。eye 为两眼中点；screen / up 为屏幕中心与手机“上”方向（世界坐标）；
   * baseFov / baseQuat 为人眼视角镜头的视场与朝向（整体画面时和它完全一致，分开后转向屏幕、按面板重新取景）。
   * renderEye 由 app 提供：设置屏幕的眼睛位置、隐藏头部，再把场景画到当前视口。
   * 返回 true 表示主画面被完全挡住，不用再画。
   */
  render(now: number, o: {
    renderer: THREE.WebGLRenderer; W: number; H: number; k: number; baseFov: number; baseQuat: THREE.Quaternion;
    eye: THREE.Vector3; screen: THREE.Vector3; up: THREE.Vector3;
    phoneInv: THREE.Matrix4; model: AngleModel; fitFov: (eye: THREE.Vector3, fill: number) => number;
    /** chroma：屏幕色偏的倍数（双眼叠加时放大，其余为 1） */
    renderEye: (eye: THREE.Vector3, cam: THREE.PerspectiveCamera, chroma: number) => void;
    /** 工具栏排成两行时多出来的高度（未缩放的 px），底部多留出来 */
    bottomExtra?: number;
  }): boolean {
    if (!this.t0) { this.t0 = now; this.el.hidden = false; }
    const e = this.frozen ?? now - this.t0;
    if (this.auto) {
      this.cur = this.autoLook(e);
      if (e >= T.merge && this.frozen === null) { this.auto = false; this.layout = 'overlay'; this.syncLayoutBtn(); }
    } else {
      if (this.tween) {
        const k = ease(clamp01((now - this.tween.t0) / this.tween.dur));
        const { from: f, to } = this.tween;
        this.cur = { s: mix(f.s, to.s, k), o: mix(f.o, to.o, k) };
        if (k >= 1) {
          this.tween = null;
          if (this.exiting) { this.finish(); return false; }
        }
      }
    }
    const { s, o: ov } = this.cur;
    const wiggle = !this.auto && !this.exiting && this.layout === 'wiggle' && !this.tween;
    const wiggleR = wiggle && Math.floor((now - this.wiggleT0) / 380) % 2 === 1;

    // ---------- 布局 ----------
    const { W, H, k } = o;
    const narrow = W < 760;
    const m = (narrow ? 10 : 16) * k, gap = (narrow ? 10 : 16) * k, top = 64 * k, bottom = ((narrow ? 272 : 232) + (o.bottomExtra || 0)) * k;
    const phMax = Math.max(120, H - top - bottom);
    const a = THREE.MathUtils.clamp(((W - 2 * m - gap) / 2) / phMax, 0.42, 0.9);   // 并排时面板宽高比（竖向，框住竖放的手机）
    const pw = Math.floor(Math.min((W - 2 * m - gap) / 2, phMax * a)), ph = Math.floor(pw / a);
    const cx = W / 2, y = top + (phMax - ph) / 2;
    const split: [Rect, Rect] = [[cx - gap / 2 - pw, y, pw, ph], [cx + gap / 2, y, pw, ph]];
    const whole: [Rect, Rect] = [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]];
    const merged: Rect = [cx - pw / 2, y, pw, ph];
    // 面板位置：整体 → 并排 → 叠加；面板里的画面：整体时是全屏画面的左 / 右半边，分开后是各自完整的画面
    const rects = [0, 1].map((i) => (ov > 0 ? mixR(split[i], merged, ov) : mixR(whole[i], split[i], s)));
    const inner = [0, 1].map((i) => (ov > 0 ? [0, 0, pw, ph] as Rect : mixR([i ? -W / 2 : 0, 0, W, H], [0, 0, pw, ph], s)));

    // ---------- 两只眼睛：从中点逐渐分到各自的位置 ----------
    const dir = o.screen.clone().sub(o.eye).normalize();
    // 两眼连线：垂直于视线和人眼视角镜头的“上”（坐着时就是水平方向；侧卧时“上”是头顶方向，两眼上下分开）
    let right = new THREE.Vector3().crossVectors(dir, o.up);
    if (right.lengthSq() < 1e-6) right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    right.normalize();
    // 两只眼睛共用中点视线的“上”方向（垂直于视线和两眼连线）：两眼只差一个绕这个轴的转角，
    // 不会因为低头看手机而互相歪斜（用世界“上”会让两眼画面差一个旋转，整块屏幕都对不齐）
    const camUp = new THREE.Vector3().crossVectors(right, dir).normalize();
    const half = (this.ipd / 2) * s;
    const eyes = [o.eye.clone().addScaledVector(right, -half), o.eye.clone().addScaledVector(right, half)];
    const fullEyes = [o.eye.clone().addScaledVector(right, -this.ipd / 2), o.eye.clone().addScaledVector(right, this.ipd / 2)];
    const cams = [this.camL, this.camR];
    // 读数（按两眼最终的位置）；叠加时两边画面的色偏都乘上 gain，混合后的色偏 ≈ 双眼累加值
    const reads = fullEyes.map((ey) => {
      const l = ey.clone().applyMatrix4(o.phoneInv).sub(new THREE.Vector3(0, 0, 0.0003));
      const an = anglesOf(l);
      return { theta: an.theta, ev: o.model.evalAt(an.theta, an.psi), eye: ey };
    }) as [EyeRead, EyeRead];
    this.reads = reads;
    const mid = anglesOf(o.eye.clone().applyMatrix4(o.phoneInv).sub(new THREE.Vector3(0, 0, 0.0003)));
    const monoShift = o.model.evalAt(mid.theta, mid.psi).jncd;            // 不考虑双眼：只从两眼中点看
    const bino = binoShift(reads[0].ev.jncd, reads[1].ev.jncd);
    const avg = (reads[0].ev.jncd + reads[1].ev.jncd) / 2;
    const gain = avg > 0.05 ? THREE.MathUtils.clamp(bino / avg, 1, 2) : 1;
    const chroma = mix(1, gain, wiggle ? 0 : ov);                         // 左右交替时每次只看一只眼，不放大
    const r = o.renderer, pr = r.getPixelRatio(), Hpx = r.domElement.height;
    const autoShadow = r.shadowMap.autoUpdate;
    r.setScissorTest(true);
    eyes.forEach((ey, i) => {
      const [, , cw, ch] = inner[i];
      const cwPx = Math.max(2, Math.round(cw * pr)), chPx = Math.max(2, Math.round(ch * pr));
      const cam = cams[i];
      // 叠在一起时模拟大脑的融合：两眼的错位被拉回大半（镜头向两眼中点靠拢），中心对齐、边缘保留一点不重合
      const cp = ey.clone().lerp(o.eye, ov * (1 - FUSE_KEEP));
      cam.position.copy(cp);
      cam.up.copy(camUp);
      cam.lookAt(o.screen);                             // 分开后两眼都注视屏幕中心（辐辏）
      const look = cam.quaternion.clone();              // 注意：slerpQuaternions 会先把第一个参数拷进自己，目标必须另存一份
      cam.quaternion.slerpQuaternions(o.baseQuat, look, s);   // 整体画面时朝向和人眼视角镜头一致
      cam.aspect = cw / ch;
      cam.fov = mix(o.baseFov, o.fitFov(cp, 0.74), s);
      cam.near = 0.01;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      r.setViewport(0, 0, cw, ch);
      r.setScissor(0, 0, cw, ch);
      if (i > 0) r.shadowMap.autoUpdate = false;        // 阴影每帧只更新一次
      o.renderEye(ey, cam, chroma);
      const p = this.panels[i];
      if (p.cv.width !== cwPx || p.cv.height !== chPx) { p.cv.width = cwPx; p.cv.height = chPx; }
      p.g.drawImage(r.domElement, 0, Hpx - chPx, cwPx, chPx, 0, 0, cwPx, chPx);
    });
    r.shadowMap.autoUpdate = autoShadow;
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);

    // ---------- 读数 ----------
    const verg = o.screen.clone().sub(fullEyes[0]).angleTo(o.screen.clone().sub(fullEyes[1])) * 180 / Math.PI;
    const refW = o.model.ref.W;
    const de = deltaE2000(xyzToLab(reads[0].ev.W, refW), xyzToLab(reads[1].ev.W, refW));
    const uvL = uvPrime(reads[0].ev.W), uvR = uvPrime(reads[1].ev.W);
    const jn = Math.hypot(uvL[0] - uvR[0], uvL[1] - uvR[1]) / JNCD;
    const dLum = Math.abs(reads[0].ev.yRatio - reads[1].ev.yRatio) * 100;

    // ---------- DOM ----------
    this.el.style.setProperty('--k', String(k));
    this.el.style.setProperty('--sp', s.toFixed(3));        // 分开的程度：圆角、描边跟着出现
    const names = ['左眼', '右眼'];
    this.panels.forEach((p, i) => {
      const [x0, y0, w0, h0] = rects[i];
      Object.assign(p.wrap.style, { left: x0 + 'px', top: y0 + 'px', width: w0 + 'px', height: h0 + 'px',
        opacity: String(i ? (wiggle ? (wiggleR ? 1 : 0) : 1 - 0.5 * ov) : 1) });
      const [ix, iy, iw, ih] = inner[i];
      Object.assign(p.cv.style, { left: ix + 'px', top: iy + 'px', width: iw + 'px', height: ih + 'px' });
      const rd = reads[i];
      const html = `<i style="--c:${i ? SECOND : 'var(--ac)'}"></i><b>${names[i]}</b><span>${rd.theta.toFixed(0)}°</span>` +
        (narrow ? `<span><b>${Math.round(rd.ev.yRatio * 100)}%</b></span>` : `<span>亮度 <b>${Math.round(rd.ev.yRatio * 100)}%</b></span><span>色偏 <b>${rd.ev.jncd.toFixed(1)}</b></span>`);
      if (p.badge.dataset.html !== html) { p.badge.innerHTML = html; p.badge.dataset.html = html; }
      const showBadge = wiggle ? (i === 1) === wiggleR : s > 0.6 && ov < 0.5;
      p.badge.style.opacity = String(showBadge ? 1 : 0);
    });
    const q = (kk: string) => this.el.querySelector(`[data-st="${kk}"]`) as HTMLElement;
    const merged2 = ov > 0.98 && !wiggle;
    Object.assign(q('tag').style, { transform: `translate(${merged[0]}px, ${merged[1]}px)`, opacity: merged2 ? '1' : '0' });
    const fmt = (v: number, d = 1) => v.toFixed(d);
    const diff = `<span>两眼相距 <b>${Math.round(this.ipd * 1000)} mm</b></span>` +
      `<span>两条视线夹角 <b>${fmt(verg)}°</b></span>` +
      `<span>屏幕中心离轴角 左 <b>${fmt(reads[0].theta, 0)}°</b> · 右 <b>${fmt(reads[1].theta, 0)}°</b></span>` +
      `<span>亮度差 <b>${fmt(dLum)}%</b></span>` +
      `<span>两眼色差 ΔE00（含亮度）<b>${fmt(de)}</b></span><span>色度差 Δu′v′ <b>${fmt(jn)}</b> JNCD</span>` +
      `<span>双眼叠加色偏 <b>${fmt(bino)}</b> JNCD（只看两眼中点 ${fmt(monoShift)}）</span>` +
      (reads.some((rd) => rd.ev.clamped) ? '<span class="warn">超出实测范围（> 70°）按 70° 计</span>' : '');
    if (q('diff').dataset.html !== diff) { q('diff').innerHTML = diff; q('diff').dataset.html = diff; }
    // 说明区：整体画面时只露出第一句，分开后再显示读数与控制
    Object.assign(this.info.style, { top: (y + ph + 12 * k) + 'px' });
    this.info.style.setProperty('--sp', clamp01((s - 0.3) / 0.5).toFixed(3));
    return true;
  }
}
