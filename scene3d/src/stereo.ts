/*
 * 双眼视差演示（从人眼视角出发）：
 *   两只眼睛相距一个瞳距（默认 63 mm），都注视屏幕中心，各自从自己的位置看同一块屏幕。
 *   先把画面分成左眼 / 右眼并排，再滑回中间叠在一起（各 50%），展示两眼之间的视差与亮度、色偏差。
 * 屏幕着色仍按“这只眼睛”的位置查实测数据，所以两边的亮度 / 色偏是真实的差别；
 * 叠加只是把两张画面各取一半混合的示意，不代表大脑实际融合出来的样子。
 *
 * 渲染：每只眼睛先画到主画布左下角的一块区域，再拷到各自的面板画布上（同一套色调映射与 sRGB 输出，颜色和主画面一致）。
 */
import * as THREE from 'three';
import { anglesOf, xyzToLab, deltaE2000, uvPrime, JNCD, type AngleModel, type Eval } from './optics/model';
import { SECOND } from './annotate';

export type StereoLayout = 'split' | 'overlay' | 'wiggle';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 自动播放的时间轴（ms，从进入人眼视角后算起） */
const T = { intro: 700, split: 1900, hold: 5200, merge: 6800 };

interface Look { sep: number; aL: number; aR: number }
export interface EyeRead { theta: number; ev: Eval; eye: THREE.Vector3 }

export class Stereo {
  active = false;
  ipd = 0.063;
  layout: StereoLayout = 'split';
  /** 0 = 等待镜头进入人眼视角；之后为时间轴起点 */
  private t0 = 0;
  private auto = true;
  private frozen: number | null = null;          // 调试：把时间轴停在某一刻
  private tween: { from: Look; to: Look; t0: number; dur: number } | null = null;
  private cur: Look = { sep: 0, aL: 0, aR: 0 };
  private back = 0;
  private wiggleT0 = 0;

  private el: HTMLDivElement;
  private backEl: HTMLDivElement;
  private panels: { wrap: HTMLDivElement; cv: HTMLCanvasElement; g: CanvasRenderingContext2D; badge: HTMLDivElement }[];
  private info: HTMLDivElement;
  private camL = new THREE.PerspectiveCamera(40, 0.8, 0.01, 30);
  private camR = new THREE.PerspectiveCamera(40, 0.8, 0.01, 30);
  reads: [EyeRead, EyeRead] | null = null;
  onChange: () => void = () => {};

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 's3d-stereo';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="st-back"></div>
      ${['L', 'R'].map((e) => `<div class="st-panel" data-eye="${e}"><canvas></canvas><div class="st-badge"></div></div>`).join('')}
      <div class="st-tag" data-st="tag"><b>左眼 + 右眼</b>叠加 · 各 50%</div>
      <div class="st-info">
        <div class="st-step" data-st="step"></div>
        <div class="st-diff" data-st="diff"></div>
        <div class="st-ctrl">
          <div class="s3d-seg" data-st="layout"><button data-v="split">并排</button><button data-v="overlay">叠加</button><button data-v="wiggle">左右交替</button></div>
          <label class="st-ipd"><span>瞳距</span><input type="range" data-st="ipd" min="54" max="72" step="1" value="63"><b data-st="ipdV">63 mm</b></label>
          <button class="s3d-btn" data-st="replay">重播</button>
          <button class="s3d-btn" data-st="exit">退出</button>
        </div>
        <div class="st-note">叠加为示意（两眼画面各取 50%），不代表大脑实际融合的结果；亮度与色偏按各自眼睛的位置查实测数据。</div>
      </div>`;
    host.prepend(this.el);
    this.backEl = this.el.querySelector('.st-back') as HTMLDivElement;
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
    q('ipd').addEventListener('input', (e) => {
      const v = +(e.target as HTMLInputElement).value;
      this.ipd = v / 1000;
      q('ipdV').textContent = `${v} mm`;
    });
    q('replay').addEventListener('click', () => this.replay());
    q('exit').addEventListener('click', () => this.onExit());
  }

  onExit: () => void = () => {};

  start() {
    if (this.active) return;
    this.active = true;
    this.t0 = 0; this.auto = true; this.tween = null; this.frozen = null;
    this.cur = { sep: 0, aL: 0, aR: 0 }; this.back = 0;
    this.el.hidden = false;
    this.el.classList.remove('out');
    this.syncLayoutBtn();
    this.onChange();
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    this.el.classList.add('out');                       // 面板保留最后一帧，淡出
    setTimeout(() => { if (!this.active) this.el.hidden = true; }, 400);
    this.onChange();
  }
  replay() { this.t0 = 0; this.auto = true; this.tween = null; this.frozen = null; this.cur = { sep: 0, aL: 0, aR: 0 }; this.back = 0; this.syncLayoutBtn(); }
  /** 调试 / 截图：把自动播放停在时间轴的 ms 处 */
  seek(ms: number) { this.auto = true; this.tween = null; this.frozen = ms; }
  setLayout(l: StereoLayout) {
    this.auto = false;
    this.frozen = null;
    this.layout = l;
    const to: Look = l === 'split' ? { sep: 1, aL: 1, aR: 1 } : { sep: 0, aL: 1, aR: l === 'overlay' ? 0.5 : 1 };
    this.tween = { from: { ...this.cur }, to, t0: performance.now(), dur: 750 };
    if (l === 'wiggle') this.wiggleT0 = performance.now();
    this.syncLayoutBtn();
  }
  private syncLayoutBtn() {
    this.el.querySelectorAll('[data-st="layout"] button').forEach((b) =>
      b.classList.toggle('on', !this.auto && (b as HTMLElement).dataset.v === this.layout));
  }

  /** 自动播放：人眼视角 → 分成左右眼并排 → 停留 → 叠在一起 */
  private autoLook(e: number): { look: Look; back: number; step: string } {
    if (e < T.intro) {
      const k = ease(clamp01(e / T.intro));
      return { look: { sep: 0, aL: k, aR: 0 }, back: k, step: '① 人眼视角：两只眼睛其实各看各的' };
    }
    if (e < T.split) {
      const k = ease(clamp01((e - T.intro) / (T.split - T.intro)));
      return { look: { sep: k, aL: 1, aR: k }, back: 1, step: '② 分开：左眼、右眼从各自的位置看同一块屏幕' };
    }
    if (e < T.hold) return { look: { sep: 1, aL: 1, aR: 1 }, back: 1, step: '② 左眼、右眼看到的屏幕：离轴角不同，亮度和色偏也不同' };
    if (e < T.merge) {
      const k = ease(clamp01((e - T.hold) / (T.merge - T.hold)));
      return { look: { sep: 1 - k, aL: 1, aR: 1 - 0.5 * k }, back: 1, step: '③ 叠在一起' };
    }
    return { look: { sep: 0, aL: 1, aR: 0.5 }, back: 1, step: '③ 两眼画面叠在一起：深度不同的地方出现重影（视差），颜色不同的地方两眼要互相“抵消”' };
  }

  /**
   * 每帧（镜头已在人眼视角时）调用。eye 为两眼中点；screen / up 为屏幕中心与手机“上”方向（世界坐标）。
   * renderEye 由 app 提供：设置屏幕的眼睛位置、隐藏头部，再把场景画到当前视口。
   * 返回 true 表示主画面被完全挡住，可以不画。
   */
  render(now: number, o: {
    renderer: THREE.WebGLRenderer; W: number; H: number; k: number;
    eye: THREE.Vector3; screen: THREE.Vector3; up: THREE.Vector3;
    phoneInv: THREE.Matrix4; model: AngleModel; fitFov: (eye: THREE.Vector3, fill: number) => number;
    renderEye: (eye: THREE.Vector3, cam: THREE.PerspectiveCamera) => void;
  }): boolean {
    if (!this.t0) this.t0 = now;
    const e = this.frozen ?? now - this.t0;
    let step = '';
    if (this.auto) {
      const a = this.autoLook(e);
      this.cur = a.look; this.back = a.back; step = a.step;
      if (e >= T.merge && this.frozen === null) { this.auto = false; this.layout = 'overlay'; this.syncLayoutBtn(); }
    } else {
      this.back = 1;
      if (this.tween) {
        const k = ease(clamp01((now - this.tween.t0) / this.tween.dur));
        const { from: f, to } = this.tween;
        this.cur = { sep: f.sep + (to.sep - f.sep) * k, aL: f.aL + (to.aL - f.aL) * k, aR: f.aR + (to.aR - f.aR) * k };
        if (k >= 1) this.tween = null;
      }
      step = this.layout === 'split' ? '左眼、右眼并排' : this.layout === 'overlay' ? '两眼画面叠加（各 50%）' : '左右眼交替显示：注意画面的跳动（视差）和颜色的变化';
    }
    let { sep, aL, aR } = this.cur;
    let wiggleR = false;
    if (!this.auto && this.layout === 'wiggle' && !this.tween) {
      wiggleR = Math.floor((now - this.wiggleT0) / 380) % 2 === 1;
      aL = 1; aR = wiggleR ? 1 : 0;
    }

    // ---------- 面板布局 ----------
    const { W, H, k } = o;
    const narrow = W < 760;
    const m = (narrow ? 10 : 16) * k, gap = (narrow ? 10 : 16) * k, top = 64 * k, bottom = (narrow ? 272 : 232) * k;
    const phMax = Math.max(120, H - top - bottom);
    const a = THREE.MathUtils.clamp(((W - 2 * m - gap) / 2) / phMax, 0.42, 0.9);   // 面板宽高比（竖向，框住竖放的手机）
    const pw = Math.floor(Math.min((W - 2 * m - gap) / 2, phMax * a)), ph = Math.floor(pw / a);
    const cx = W / 2, y = top + (phMax - ph) / 2;
    const off = (pw + gap) / 2 * sep;
    const rects = [cx - pw / 2 - off, cx - pw / 2 + off];

    // ---------- 两只眼睛 ----------
    const dir = o.screen.clone().sub(o.eye).normalize();
    let right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right = new THREE.Vector3().crossVectors(dir, o.up);
    right.normalize();
    const eyes = [o.eye.clone().addScaledVector(right, -this.ipd / 2), o.eye.clone().addScaledVector(right, this.ipd / 2)];
    const cams = [this.camL, this.camR];
    const r = o.renderer, pr = r.getPixelRatio();
    const pwPx = Math.round(pw * pr), phPx = Math.round(ph * pr), Hpx = r.domElement.height;
    const autoShadow = r.shadowMap.autoUpdate;
    r.setScissorTest(true);
    eyes.forEach((ey, i) => {
      const cam = cams[i];
      cam.position.copy(ey);
      cam.up.copy(o.up);
      cam.lookAt(o.screen);                             // 两眼都注视屏幕中心（辐辏）
      cam.aspect = pw / ph;
      cam.fov = o.fitFov(ey, 0.74);
      cam.near = 0.01;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      r.setViewport(0, 0, pw, ph);
      r.setScissor(0, 0, pw, ph);
      if (i > 0) r.shadowMap.autoUpdate = false;        // 阴影每帧只更新一次
      o.renderEye(ey, cam);
      const p = this.panels[i];
      if (p.cv.width !== pwPx || p.cv.height !== phPx) { p.cv.width = pwPx; p.cv.height = phPx; }
      p.g.drawImage(r.domElement, 0, Hpx - phPx, pwPx, phPx, 0, 0, pwPx, phPx);
    });
    r.shadowMap.autoUpdate = autoShadow;
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);

    // ---------- 读数 ----------
    const reads = eyes.map((ey) => {
      const l = ey.clone().applyMatrix4(o.phoneInv).sub(new THREE.Vector3(0, 0, 0.0003));
      const an = anglesOf(l);
      return { theta: an.theta, ev: o.model.evalAt(an.theta, an.psi), eye: ey };
    }) as [EyeRead, EyeRead];
    this.reads = reads;
    const vL = o.screen.clone().sub(eyes[0]), vR = o.screen.clone().sub(eyes[1]);
    const verg = vL.angleTo(vR) * 180 / Math.PI;
    const refW = o.model.ref.W;
    const de = deltaE2000(xyzToLab(reads[0].ev.W, refW), xyzToLab(reads[1].ev.W, refW));
    const uvL = uvPrime(reads[0].ev.W), uvR = uvPrime(reads[1].ev.W);
    const jn = Math.hypot(uvL[0] - uvR[0], uvL[1] - uvR[1]) / JNCD;
    const dLum = Math.abs(reads[0].ev.yRatio - reads[1].ev.yRatio) * 100;

    // ---------- DOM ----------
    this.el.style.setProperty('--k', String(k));
    this.backEl.style.opacity = String(this.back);
    const names = ['左眼', '右眼'];
    this.panels.forEach((p, i) => {
      Object.assign(p.wrap.style, { left: rects[i] + 'px', top: y + 'px', width: pw + 'px', height: ph + 'px', opacity: String(i ? aR : aL) });
      const rd = reads[i];
      const html = `<i style="--c:${i ? SECOND : 'var(--ac)'}"></i><b>${names[i]}</b><span>${rd.theta.toFixed(0)}°</span>` +
        (narrow ? `<span><b>${Math.round(rd.ev.yRatio * 100)}%</b></span>` : `<span>亮度 <b>${Math.round(rd.ev.yRatio * 100)}%</b></span><span>色偏 <b>${rd.ev.jncd.toFixed(1)}</b></span>`);
      if (p.badge.dataset.html !== html) { p.badge.innerHTML = html; p.badge.dataset.html = html; }
      // 叠在一起时只留上面那块（右眼）的标签位置给“叠加”说明
      const showBadge = sep > 0.5 || (this.layout === 'wiggle' && !this.auto && !this.tween ? (i === 1) === wiggleR : false);
      p.badge.style.opacity = String(showBadge ? 1 : 0);
      p.wrap.classList.toggle('merged', sep < 0.02);
    });
    const q = (kk: string) => this.el.querySelector(`[data-st="${kk}"]`) as HTMLElement;
    // 叠在一起时的说明标签（单独一层，不跟着右眼面板半透明）
    const merged = sep < 0.02 && aR > 0.3 && aR < 0.7;
    Object.assign(q('tag').style, { transform: `translate(${rects[0]}px, ${y}px)`, opacity: merged ? '1' : '0' });
    if (q('step').textContent !== step) q('step').textContent = step;
    const fmt = (v: number, d = 1) => v.toFixed(d);
    const diff = `<span>两眼相距 <b>${Math.round(this.ipd * 1000)} mm</b></span>` +
      `<span>两条视线夹角 <b>${fmt(verg)}°</b></span>` +
      `<span>屏幕中心离轴角 左 <b>${fmt(reads[0].theta, 0)}°</b> · 右 <b>${fmt(reads[1].theta, 0)}°</b></span>` +
      `<span>亮度差 <b>${fmt(dLum)}%</b></span>` +
      `<span>两眼色差 ΔE00（含亮度）<b>${fmt(de)}</b></span><span>色度差 Δu′v′ <b>${fmt(jn)}</b> JNCD</span>` +
      (reads.some((rd) => rd.ev.clamped) ? '<span class="warn">超出实测范围（> 70°）按 70° 计</span>' : '');
    if (q('diff').dataset.html !== diff) { q('diff').innerHTML = diff; q('diff').dataset.html = diff; }
    Object.assign(this.info.style, { top: (y + ph + 12 * k) + 'px', opacity: String(clamp01((this.back - 0.5) * 2)) });
    return this.back >= 0.999;
  }
}
