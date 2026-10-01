/*
 * 三维场景演示：挂到页面里的一个容器上（mount）。
 * 屏幕效果永远按观看者两眼中点计算，不按镜头位置；讲解视角里屏幕显示的也是眼睛看到的样子。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadCharacter, cloneCharacter, capturePose, applyPose, blendPose, eyeWorld, type Character, type PoseSnap } from './rig';
import { simplifyBody, NEUTRAL_MALE } from './simplify';
import { applyLook, type Look } from './look';
import { STYLES, gradientTexture } from './styles';
import { buildPhone, type PhoneModel } from './phone/model';
import { XIAOMI_18_PRO_MAX, type DeviceSpec } from './phone/devices';
import { createModel, anglesOf, type AngData, type AngleModel, type Profile } from './optics/model';
import { lutTexture } from './optics/screen';
import { Annotations } from './annotate';
import { CameraRig, type ViewMode } from './camera';
import { PRESETS, TABLE_Y, SUBWAY_SEAT, type Preset, type SceneState, type Props, type Ctx } from './presets';
import { CSS } from './ui-css';

export interface MountOptions {
  data: AngData;
  person: string | object;                     // glTF 地址或内嵌的 glTF JSON
  makePattern: (name: string, w: number, h: number) => HTMLCanvasElement;
  scene?: string;
  view?: ViewMode;
  pattern?: string;
  privacy?: boolean;
}

type Viewer = 'you' | 'nb';
const PATTERNS: [string, string][] = [['ui', '设置页'], ['read', '阅读'], ['white', '纯白'], ['checker', '色卡'], ['gray', '灰阶']];
const TRANSITION_MS = 1300;
const FADE_TO = 0.4;         // 切换结束后人物淡到的不透明度（人物本身已半透明，取 0.4 观感接近“0.3”）
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function mount(host: HTMLElement, opts: MountOptions) {
  const style = STYLES[0];
  host.classList.add('s3d');
  if (!document.getElementById('s3d-css')) {
    const st = document.createElement('style'); st.id = 's3d-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  // ---------- 渲染器与舞台 ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = style.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.domElement.className = 's3d-canvas';
  host.appendChild(renderer.domElement);
  const size = () => ({ W: host.clientWidth || innerWidth, H: host.clientHeight || innerHeight });

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = style.env;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: style.shadow }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  style.lights(scene, new THREE.Vector3(0, 0.95, 0.12));

  // 道具：凳子、桌子、地铁长椅（含扶杆）。各自一份材质，切换场景时淡入淡出
  const propMat = () => { const m = style.prop() as THREE.MeshStandardMaterial; m.transparent = true; return m; };
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m;
  };
  const stoolMat = propMat(), tableMat = propMat(), benchMat = propMat();
  const stool = mk(new THREE.CylinderGeometry(0.2, 0.2, 0.46, 48), stoolMat, 0, 0.23, -0.02);
  const table = new THREE.Group();
  table.add(mk(new THREE.BoxGeometry(1.2, 0.03, 0.7), tableMat, 0, TABLE_Y - 0.015, 0.58));
  for (const [x, z] of [[-0.56, 0.27], [0.56, 0.27], [-0.56, 0.89], [0.56, 0.89]]) table.add(mk(new THREE.CylinderGeometry(0.018, 0.018, TABLE_Y - 0.03, 16), tableMat, x, (TABLE_Y - 0.03) / 2, z));
  const bench = new THREE.Group();
  bench.add(mk(new THREE.BoxGeometry(1.7, 0.06, 0.46), benchMat, -0.35, SUBWAY_SEAT - 0.03, -0.02));
  bench.add(mk(new THREE.BoxGeometry(1.7, 0.34, 0.05), benchMat, -0.35, SUBWAY_SEAT + 0.2, -0.27));
  bench.add(mk(new THREE.BoxGeometry(1.7, 0.36, 0.04), benchMat, -0.35, 0.2, 0.17));
  bench.add(mk(new THREE.CylinderGeometry(0.018, 0.018, 2.3, 16), benchMat, 0.72, 1.15, 0.22));
  scene.add(stool, table, bench);
  const propObjs: Record<keyof Props, { obj: THREE.Object3D; mat: THREE.MeshStandardMaterial }> = {
    stool: { obj: stool, mat: stoolMat }, table: { obj: table, mat: tableMat }, bench: { obj: bench, mat: benchMat },
  };
  const setProps = (p: Props) => {
    for (const [k, { obj, mat }] of Object.entries(propObjs)) {
      const a = p[k as keyof Props];
      obj.visible = a > 0.01;
      mat.opacity = a;
      // 完全显示时用不透明材质：先于人物绘制，半透明人物后面能透出凳子 / 长椅
      mat.transparent = a < 0.999;
      mat.depthWrite = a > 0.98;
      obj.traverse((o) => { o.castShadow = a > 0.5; });
    }
  };

  // ---------- 人物：你、旁座乘客 ----------
  const you: Character = await loadCharacter(opts.person);
  const body = you.meshes.reduce((a, b) => (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
  for (const m of you.meshes) if (m !== body) m.visible = false;       // 不要头发、眼球、眉毛
  you.meshes.splice(0, you.meshes.length, body);
  simplifyBody(body, NEUTRAL_MALE);
  const nb = cloneCharacter(you);
  const lookYou: Look = applyLook(you, style.look);
  const lookNb: Look = applyLook(nb, style.look);
  scene.add(you.root, nb.root);

  // ---------- 手机与实测模型 ----------
  const device: DeviceSpec = XIAOMI_18_PRO_MAX;
  const phone: PhoneModel = buildPhone(device);
  phone.group.matrixAutoUpdate = false;
  scene.add(phone.group);
  const dims = { W: device.body.W / 1000, H: device.body.H / 1000, T: device.body.T / 1000, bump: device.body.island.depth / 1000 };
  const ctx: Ctx = { you, nb, dims };

  const models = new Map<string, { model: AngleModel; lut: ReturnType<typeof lutTexture> }>();
  const profilesOf = (dev: DeviceSpec) => opts.data.profiles.filter((p) => p.device === dev.dataDevice || p.device.startsWith(dev.dataDevice + ' '));
  const hasPrivacy = profilesOf(device).some((p) => p.privacy) && profilesOf(device).some((p) => !p.privacy);
  const privacyKind = profilesOf(device).find((p) => p.privacy)?.privacyKind || 'mode';
  let privacy = !!opts.privacy && hasPrivacy;
  let model!: AngleModel;
  const useProfile = () => {
    const ps = profilesOf(device);
    const p: Profile = ps.find((q) => q.privacy === privacy) || ps[0] || opts.data.profiles[0];
    let m = models.get(p.id);
    if (!m) { const mm = createModel({ angles: opts.data.angles, sets: p.sets }); m = { model: mm, lut: lutTexture(mm) }; models.set(p.id, m); }
    phone.screen.material.uniforms.uLut.value = m.lut.tex;
    phone.screen.material.uniforms.uLutW.value = m.lut.width;
    model = m.model;
  };
  useProfile();

  // 屏幕画面（按机型分辨率生成，铺满宽度不拉伸）
  let patternName = opts.pattern || 'ui';
  let imgTex: THREE.Texture | null = null;
  const setPattern = (name: string | HTMLCanvasElement) => {
    const sc = device.screen;
    const cv = typeof name === 'string' ? opts.makePattern(name, sc.resW, sc.resH) : name;
    if (typeof name === 'string') patternName = name;
    imgTex?.dispose();
    imgTex = new THREE.CanvasTexture(cv);           // 先画到 canvas 再做纹理，避免 ImageBitmap 不支持 flipY 导致上下颠倒
    imgTex.colorSpace = THREE.NoColorSpace;        // 着色器里自己做 sRGB → 线性
    imgTex.anisotropy = 8;
    imgTex.minFilter = THREE.LinearMipmapLinearFilter;
    const u = phone.screen.material.uniforms;
    u.uImg.value = imgTex;
    const da = sc.resW / sc.resH, ia = cv.width / cv.height;
    u.uImgScale.value.set(ia > da ? da / ia : 1, ia > da ? 1 : ia / da);
  };
  setPattern(patternName);

  // ---------- 界面 ----------
  const ui = document.createElement('div');
  ui.className = 's3d-ui';
  host.appendChild(ui);
  const ann = new Annotations(scene, style.accent, ui);
  const { W: W0, H: H0 } = size();
  const rig = new CameraRig(renderer.domElement, W0 / H0);
  const privacyLabel = privacyKind === 'film' ? '防窥膜' : '防窥';
  ui.insertAdjacentHTML('beforeend', `
    <div class="s3d-hud">
      <div class="s3d-scene" data-k="scene"></div>
      <div class="s3d-hero"><span data-k="theta">0°</span><span class="s3d-hero-sub" data-k="where"></span></div>
      <div class="s3d-stats"><span><i>亮度</i><b data-k="lum">100%</b></span><span><i>色偏</i><b data-k="jncd">0.0</b><i>JNCD</i></span><span><i>ΔE2000</i><b data-k="de">0.0</b></span></div>
      <div class="s3d-note" data-k="note"></div>
      <div class="s3d-warn" data-k="warn"></div>
    </div>
    <div class="s3d-inset" data-k="inset"><div class="s3d-inset-cap" data-k="insetCap"></div></div>
    <div class="s3d-adjust" data-k="adjust" hidden></div>
    <div class="s3d-bar">
      <div class="s3d-seg" data-k="scenes">${PRESETS.map((p) => `<button data-v="${p.id}">${p.name}</button>`).join('')}</div>
      <span class="s3d-div"></span>
      <div class="s3d-row2">
      <div class="s3d-seg" data-k="views"></div>
      <span class="s3d-div"></span>
      ${hasPrivacy ? `<label class="s3d-toggle"><input type="checkbox" data-k="privacy"><span class="s3d-sw"></span>${privacyLabel}</label>` : ''}
      <label class="s3d-select"><span>屏幕</span><select data-k="pattern">${PATTERNS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
      <button class="s3d-btn" data-k="adjustBtn" aria-expanded="false">调整</button>
      </div>
    </div>`);
  const $ = (k: string) => ui.querySelector(`[data-k="${k}"]`) as HTMLElement;
  ($('pattern') as HTMLSelectElement).value = patternName;
  $('pattern').addEventListener('change', (e) => setPattern((e.target as HTMLSelectElement).value));
  const privEl = ui.querySelector('[data-k="privacy"]') as HTMLInputElement | null;
  if (privEl) { privEl.checked = privacy; privEl.addEventListener('change', () => { privacy = privEl.checked; useProfile(); }); }
  const segOn = (k: string, v: string) => ui.querySelectorAll(`[data-k="${k}"] button`).forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.v === v));

  // ---------- 场景状态与过渡 ----------
  type Snap = { you: PoseSnap; nb: PoseSnap | null; phone: THREE.Matrix4; props: Props; nbAlpha: number; cam: { pos: THREE.Vector3; target: THREE.Vector3 } };
  const params: Record<string, Record<string, number>> = Object.fromEntries(PRESETS.map((p) => [p.id, { ...p.defaults }]));
  let preset: Preset = PRESETS.find((p) => p.id === opts.scene) || PRESETS[1];
  let viewer: Viewer = 'nb';
  let state!: SceneState;
  let phoneM = new THREE.Matrix4();
  let props: Props = { stool: 0, table: 0, bench: 0 };
  let nbAlpha = 0;
  let figFade = 1, fadeFrom = 1, fadeTo = 1, fadeT0 = 0, fadeDur = 300;
  let trans: null | { a: Snap; b: SceneState; t0: number; dur: number; p?: number } = null;

  /** 按预设和参数摆出目标状态，但不改变当前显示（摆完立刻还原当前姿势）。 */
  const buildState = (p: Preset) => {
    const curYou = capturePose(you), curNb = capturePose(nb);
    const s = p.build(ctx, params[p.id]);
    applyPose(you, curYou); applyPose(nb, curNb);
    return s;
  };
  const snapNow = (): Snap => ({
    you: capturePose(you), nb: nbAlpha > 0.01 ? capturePose(nb) : null, phone: phoneM.clone(), props: { ...props }, nbAlpha,
    cam: rig.getExplain(),
  });
  let resumeEye: Viewer | null = null;    // 场景切换结束后要回到谁的人眼视角
  const startFade = (to: number, ms = 300) => { fadeFrom = figFade; fadeTo = to; fadeT0 = performance.now(); fadeDur = ms; };

  const applySteady = (s: SceneState, resetCam: boolean) => {
    state = s;
    applyPose(you, s.you);
    if (s.nb) applyPose(nb, s.nb);
    phoneM = s.phone.clone();
    props = { ...s.props };
    nbAlpha = s.nb ? 1 : 0;
    if (resetCam) rig.setExplain(s.explain.pos, s.explain.target, s.explain.fov);
  };

  const describe = () => {
    $('scene').textContent = preset.name;
    $('note').textContent = preset.id === 'subway'
      ? `${preset.hint}。主画面按${viewer === 'nb' ? '旁人' : '你'}的眼睛计算，小窗是${viewer === 'nb' ? '你' : '旁人'}看到的。`
      : preset.hint;
    segOn('scenes', preset.id);
    const sub = preset.id === 'subway';
    const views = sub ? [['explain', '讲解视角'], ['eye:nb', '旁人视角'], ['eye:you', '你的视角']] : [['explain', '讲解视角'], ['eye:you', '人眼视角']];
    const html = views.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('');
    if ($('views').dataset.html !== html) { $('views').innerHTML = html; $('views').dataset.html = html; }
    syncViewBtn();
    renderAdjust();
  };

  const goto = (p: Preset, animate = true) => {
    const target = buildState(p);
    if (!animate || !state) { preset = p; applySteady(target, true); describe(); startFade(FADE_TO, 1); return; }
    trans = { a: snapNow(), b: target, t0: performance.now(), dur: TRANSITION_MS };
    // 人眼视角里换场景：先退到讲解视角，过渡结束后再进回去（地铁场景默认进旁人视角）
    resumeEye = p.autoEye ?? (rig.mode === 'eye' ? 'you' : null);
    if (rig.mode === 'eye') { rig.setMode('explain', 600); syncViewBtn(); }
    preset = p;
    startFade(1, 200);            // 切换开始时人物淡回不透明
    describe();
  };

  /** 每帧推进过渡：人物姿势、手机、道具、旁人、讲解镜头一起插值。 */
  const stepTransition = (now: number) => {
    if (!trans) return;
    const raw = trans.p ?? Math.min(1, (now - trans.t0) / trans.dur);
    const e = ease(raw);
    const { a, b } = trans;
    blendPose(you, a.you, b.you, e);
    if (b.nb) blendPose(nb, a.nb ?? b.nb, b.nb, a.nb ? e : 1);
    else if (a.nb) applyPose(nb, a.nb);
    const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sc = new THREE.Vector3();
    a.phone.decompose(pa, qa, sc); b.phone.decompose(pb, qb, sc);
    phoneM.compose(pa.lerp(pb, e), qa.slerp(qb, e), new THREE.Vector3(1, 1, 1));
    for (const k of Object.keys(props) as (keyof Props)[]) props[k] = a.props[k] + (b.props[k] - a.props[k]) * e;
    nbAlpha = a.nbAlpha + ((b.nb ? 1 : 0) - a.nbAlpha) * e;
    rig.setExplain(a.cam.pos.clone().lerp(b.explain.pos, e), a.cam.target.clone().lerp(b.explain.target, e), b.explain.fov);
    if (raw >= 1 && trans.p === undefined) {
      trans = null;
      applySteady(b, true);
      startFade(FADE_TO, 300);    // 切换结束后约 0.3 s 内淡到半透明，焦点回到屏幕
      if (resumeEye) { viewer = resumeEye; resumeEye = null; setView('eye'); describe(); }
    }
  };

  // ---------- 调整面板（观看距离 / 离轴角） ----------
  function renderAdjust() {
    const box = $('adjust');
    const rows = preset.params.map((d) => `
      <label class="s3d-row"><span>${d.label}</span><b data-out="${d.key}">${params[preset.id][d.key]}${d.unit}</b></label>
      <input type="range" data-p="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${params[preset.id][d.key]}">`).join('');
    box.innerHTML = `<div class="s3d-adjust-h">调整 · ${preset.name}</div>${rows}<div class="s3d-derived" data-k="derived"></div>
      <button class="s3d-link" data-k="resetParams">恢复默认</button>`;
    updateDerived();
  }
  function updateDerived() {
    const el = ui.querySelector('[data-k="derived"]') as HTMLElement | null;
    if (!el || !state) return;
    const d = state.derived;
    el.textContent = preset.id === 'desk' && d.dist ? `观看距离 ${d.dist.toFixed(0)} cm · 眼睛高出屏幕 ${d.height.toFixed(0)} cm` : '';
  }
  $('adjust').addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.p) return;
    params[preset.id][t.dataset.p] = +t.value;
    const def = preset.params.find((d) => d.key === t.dataset.p)!;
    (ui.querySelector(`[data-out="${t.dataset.p}"]`) as HTMLElement).textContent = t.value + def.unit;
    trans = null;
    applySteady(buildState(preset), false);     // 拖动时手机和眼睛直接跟着动
    updateDerived();
  });
  $('adjust').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.k !== 'resetParams') return;
    params[preset.id] = { ...preset.defaults };
    renderAdjust();
    applySteady(buildState(preset), false);
  });
  $('adjustBtn').addEventListener('click', () => {
    const open = !!$('adjust').hidden;
    $('adjust').hidden = !open;
    $('adjustBtn').classList.toggle('on', open);
    $('adjustBtn').setAttribute('aria-expanded', String(open));
  });

  // ---------- 按钮 ----------
  $('scenes').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    const p = b && PRESETS.find((q) => q.id === b.dataset.v);
    if (p && p !== preset) goto(p);
  });
  /** 视角按钮：explain，或 eye:you / eye:nb（地铁场景里选谁的眼睛） */
  function syncViewBtn() {
    const v = rig.mode === 'explain' ? 'explain' : `eye:${preset.id === 'subway' ? viewer : 'you'}`;
    segOn('views', v);
    host.classList.toggle('eyeview', rig.mode === 'eye');
  }
  const setView = (v: ViewMode) => { rig.setMode(v); syncViewBtn(); };
  // 人眼视角里换观看者：镜头从一个人的眼睛平滑移到另一个人的眼睛
  let eyeSwitch: { from: THREE.Vector3; t0: number } | null = null;
  let lastCamEye = new THREE.Vector3();
  const setViewer = (v: Viewer) => {
    if (v !== viewer && rig.progress > 0) eyeSwitch = { from: lastCamEye.clone(), t0: performance.now() };
    viewer = v; describe();
  };
  const pickView = (v: string) => {
    if (v === 'explain') { resumeEye = null; setView('explain'); }
    else { setViewer(v.split(':')[1] as Viewer); setView('eye'); }
  };
  $('views').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) pickView(b.dataset.v!); });

  // 演示用快捷键：H 隐藏界面，1–4 切换场景，V 切换视角，P 防窥
  let active = true;
  window.addEventListener('keydown', (e) => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'h') host.classList.toggle('clean');
    else if (/^[1-4]$/.test(k)) goto(PRESETS[+k - 1]);
    else if (k === 'v') {
      const opts2 = preset.id === 'subway' ? ['explain', 'eye:nb', 'eye:you'] : ['explain', 'eye:you'];
      const cur = rig.mode === 'explain' ? 'explain' : `eye:${preset.id === 'subway' ? viewer : 'you'}`;
      pickView(opts2[(opts2.indexOf(cur) + 1) % opts2.length]);
    } else if (k === 'p' && privEl) { privEl.checked = !privEl.checked; privacy = privEl.checked; useProfile(); }
    else return;
    e.preventDefault();
  });

  goto(preset, false);
  setView(opts.view || 'explain');
  if (opts.view === 'eye') rig.seek(1);
  syncViewBtn();

  // ---------- 渲染 ----------
  const insetCam = new THREE.PerspectiveCamera(42, 0.8, 0.01, 30);
  const resize = () => {
    const { W, H } = size();
    renderer.setSize(W, H, false);
    rig.setAspect(W / H);
    ann.setResolution(W, H);
    scene.background = gradientTexture(style.bg[0], style.bg[1], W, H);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const inv = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  let frames = 0;
  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => { readyResolve = r; });
  const headOf = (c: Character, eye: THREE.Vector3) => eye.clone().add(new THREE.Vector3(0, 0.02, -0.08).applyQuaternion(c.bones.Head.getWorldQuaternion(tmpQ)));

  const frame = (now: number) => {
    const { W, H } = size();
    stepTransition(now);
    if (fadeT0) figFade = fadeFrom + (fadeTo - fadeFrom) * Math.min(1, (now - fadeT0) / fadeDur);
    const reachFade = state.reach || trans ? 1 : 0.35;     // 手臂够不到时整个人淡成半透明
    phone.group.matrix.copy(phoneM);
    phone.group.updateMatrixWorld(true);
    setProps(props);
    nb.root.visible = nbAlpha > 0.01;

    const eyeYou = eyeWorld(you);
    const eyeNb = nb.root.visible ? eyeWorld(nb) : null;
    const sub = preset.id === 'subway' && !!eyeNb && !trans;
    const mainViewer: Viewer = sub ? viewer : 'you';
    let mainEye = mainViewer === 'nb' && eyeNb ? eyeNb : eyeYou;
    let switching = 0;
    if (eyeSwitch) {
      const k = Math.min(1, (now - eyeSwitch.t0) / 1100);
      switching = 1 - k;
      const e = ease(k);
      mainEye = eyeSwitch.from.clone().lerp(mainEye, e).add(new THREE.Vector3(0, 0.06 * Math.sin(Math.PI * e), 0));
      if (k >= 1) eyeSwitch = null;
    }
    lastCamEye.copy(mainEye);
    const otherEye = sub ? (mainViewer === 'nb' ? eyeYou : eyeNb!) : null;
    const scr = new THREE.Vector3().setFromMatrixPosition(phoneM);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(phoneM);
    const fitFov = (eye: THREE.Vector3, fill: number) => {
      const dist = eye.distanceTo(scr);
      const ang = 2 * Math.atan((dims.H / 2) / dist) * 180 / Math.PI;
      return THREE.MathUtils.clamp(ang / fill, 16, 60);
    };
    rig.setEyeFov(fitFov(mainEye, W / H < 1 ? 0.62 : 0.7));
    const camFade = rig.update(now, mainEye, scr, up);

    inv.copy(phoneM).invert();
    const u = phone.screen.material.uniforms;
    u.uEye.value.copy(mainEye).applyMatrix4(inv);
    u.uCam.value.copy(rig.camera.position).applyMatrix4(inv);
    rig.camera.updateMatrixWorld();
    lookYou.setFade(figFade * reachFade);
    lookNb.setFade(figFade * nbAlpha);
    lookNb.setDepth(nbAlpha > 0.98);
    lookYou.setHead(headOf(you, eyeYou), rig.camera, mainViewer === 'you' || switching ? camFade : 0);
    lookNb.setHead(eyeNb ? headOf(nb, eyeNb) : eyeYou, rig.camera, mainViewer === 'nb' || switching ? camFade : 0);

    const probes = ann.update(mainEye, phoneM, phone.half, model, otherEye ? { eye: otherEye, name: mainViewer === 'nb' ? '你' : '旁人' } : null);
    ann.setVisible(rig.progress < 0.05);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.render(scene, rig.camera);
    ann.layout(rig.camera, mainEye, phoneM, phone.half, W, H);

    // 地铁场景：角落小窗，用另一个人的眼睛对同一部手机再渲染一次
    const inset = $('inset');
    if (sub && otherEye) {
      const narrow = W < 700;
      const big = rig.mode === 'eye';
      const iw = Math.round(Math.min(big ? 360 : 300, W * (narrow ? 0.3 : big ? 0.24 : 0.2))), ih = Math.round(iw * 1.25);
      const ix = W - iw - (narrow ? 10 : 24), iy = narrow ? 62 : 72;
      Object.assign(inset.style, { display: 'block', left: ix + 'px', top: iy + 'px', width: iw + 'px', height: ih + 'px' });
      insetCam.position.copy(otherEye);
      insetCam.up.copy(up);
      insetCam.lookAt(scr);
      insetCam.aspect = iw / ih;
      insetCam.fov = fitFov(otherEye, 0.8);
      insetCam.updateProjectionMatrix();
      insetCam.updateMatrixWorld();
      u.uEye.value.copy(otherEye).applyMatrix4(inv);
      const otherIsYou = mainViewer === 'nb';
      lookYou.setHead(headOf(you, eyeYou), insetCam, otherIsYou ? 1 : 0);
      lookNb.setHead(headOf(nb, eyeNb!), insetCam, otherIsYou ? 0 : 1);
      ann.setVisible(false);
      renderer.setScissorTest(true);
      renderer.setScissor(ix, H - iy - ih, iw, ih);
      renderer.setViewport(ix, H - iy - ih, iw, ih);
      renderer.render(scene, insetCam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      ann.setVisible(rig.progress < 0.05);
      const a = anglesOf(otherEye.clone().applyMatrix4(inv));
      const ev = model.evalAt(a.theta, a.psi);
      const html = `<b>${otherIsYou ? '你' : '旁人'}看到的</b><span>亮度 <b>${Math.round(ev.yRatio * 100)}%</b> · ${a.theta.toFixed(0)}°</span>`;
      if ($('insetCap').dataset.html !== html) { $('insetCap').innerHTML = html; $('insetCap').dataset.html = html; }
    } else inset.style.display = 'none';

    // 读数（主观看者，屏幕中心）
    const c = probes[1];
    $('theta').textContent = `${c.theta.toFixed(0)}°`;
    $('where').textContent = sub ? `${mainViewer === 'nb' ? '旁人' : '你'}看屏幕中心的离轴角` : '屏幕中心离轴角';
    $('scene').textContent = rig.mode === 'eye' ? (sub ? `${mainViewer === 'nb' ? '旁人' : '你'}看到的屏幕` : `${preset.name} · 眼睛看到的屏幕`) : preset.name;
    $('lum').textContent = `${Math.round(c.ev.yRatio * 100)}%`;
    $('jncd').textContent = c.ev.jncd.toFixed(1);
    $('de').textContent = c.ev.de00.toFixed(1);
    $('warn').textContent = (c.ev.clamped ? '超出实测范围（> 70°），按 70° 计。' : '') + (!state.reach && !trans ? '手臂够不到这个位置，人物已淡化。' : '');
    if (++frames === 2) readyResolve();
  };
  renderer.setAnimationLoop(frame);

  return {
    ready, renderer, scene, rig,
    get state() { return state; },
    get eye() { return eyeWorld(you); },
    get phoneMatrix() { return phoneM.clone(); },
    setScene(id: string, animate = true) { const p = PRESETS.find((q) => q.id === id); if (p) goto(p, animate); },
    setView, setViewer, setPattern,
    setPrivacy(on: boolean) { privacy = on && hasPrivacy; if (privEl) privEl.checked = privacy; useProfile(); },
    setParam(key: string, v: number) { params[preset.id][key] = v; applySteady(buildState(preset), false); renderAdjust(); },
    /** 调试：从场景 from 过渡到 to，停在进度 p（0–1），用来按进度截过渡帧 */
    seek(from: string, to: string, p: number) {
      const fp = PRESETS.find((q) => q.id === from)!, tp = PRESETS.find((q) => q.id === to)!;
      preset = fp; trans = null; applySteady(buildState(fp), true);
      trans = { a: snapNow(), b: buildState(tp), t0: 0, dur: 1, p };
      preset = tp; figFade = 1; fadeT0 = 0; describe();
    },
    /** 调试：讲解 → 人眼过渡停在进度 p */
    seekView(p: number) { rig.seek(p); },
    /** 检查：从你的眼睛看过去，有多少人物顶点挡在屏幕显示区前面（应为 0） */
    occlusion() {
      const i2 = phoneM.clone().invert();
      const eyeL = eyeWorld(you).applyMatrix4(i2);
      const v = new THREE.Vector3();
      let n = 0;
      const m = you.meshes[0];
      for (let i = 0; i < m.geometry.attributes.position.count; i++) {
        m.getVertexPosition(i, v);
        v.applyMatrix4(m.matrixWorld).applyMatrix4(i2);
        if (v.z <= 0.0002 || v.z >= eyeL.z) continue;
        const k = eyeL.z / (eyeL.z - v.z);
        if (Math.abs(eyeL.x + (v.x - eyeL.x) * k) < phone.half.x && Math.abs(eyeL.y + (v.y - eyeL.y) * k) < phone.half.y) n++;
      }
      return n;
    },
    pause() { renderer.setAnimationLoop(null); active = false; },
    resume() { renderer.setAnimationLoop(frame); active = true; },
    dispose() { renderer.setAnimationLoop(null); ro.disconnect(); renderer.dispose(); phone.dispose(); host.innerHTML = ''; },
  };
}
export type Scene3D = Awaited<ReturnType<typeof mount>>;
