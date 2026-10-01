/*
 * 三维场景演示：挂到页面里的一个容器上（mount）。
 * 屏幕效果永远按观看者两眼中点计算，不按镜头位置；讲解视角里屏幕显示的也是眼睛看到的样子。
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { loadCharacter, cloneCharacter, capturePose, applyPose, blendPose, eyeWorld, eyePair, headAxes, type Character, type PoseSnap } from './rig';
import { simplifyBody, NEUTRAL_MALE } from './simplify';
import { applyLook, type Look } from './look';
import { STYLES, gradientTexture } from './styles';
import { buildPhone, type PhoneModel } from './phone/model';
import { DEVICES, type DeviceSpec } from './phone/devices';
import { islandCenterY, rearBump } from './phone/geometry';
import { buildApplePhone, APPLE_VARIANT } from './phone/apple';
import { createDataPanel, type PanelProfile } from './datapanel';
import { createModel, anglesOf, deltaE2000, xyzToLab, type AngData, type AngleModel, type Profile } from './optics/model';
import { lutTexture } from './optics/screen';
import { Annotations } from './annotate';
import { Stereo, type StereoLayout } from './stereo';
import { createPlayer, type Step } from './sequence';
import { createTimeline } from './timeline';
import { CameraRig, type ViewMode } from './camera';
import { PRESETS, TABLE_Y, SUBWAY_SEAT, BED_Y, type Preset, type SceneState, type Props, type Ctx } from './presets';
import { CSS } from './ui-css';

export interface MountOptions {
  data: AngData;
  person: string | object;                     // glTF 地址或内嵌的 glTF JSON
  makePattern: (name: string, w: number, h: number) => HTMLCanvasElement;
  scene?: string;
  view?: ViewMode;
  pattern?: string;
  privacy?: boolean;
  device?: string;      // 'xiaomi18pm' | 'iphone18pm'
  /** 取苹果官网 AR 模型（按颜色变体名）。只在本机提供，拿不到时用参数化模型 */
  appleIphone?: (variant: string) => Promise<ArrayBuffer | null>;
}

type Viewer = 'you' | 'nb';
const PATTERNS: [string, string][] = [['ui', '设置页'], ['read', '阅读'], ['white', '纯白'], ['checker', '色卡'], ['gray', '灰阶']];
const TRANSITION_MS = 1300;
const FADE_TO = 0.4;         // 切换结束后人物淡到的不透明度（人物本身已半透明，取 0.4 观感接近“0.3”）
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** 界面随窗口放大：1366×820 左右为 1，1080p 约 1.3，1440p 约 1.75，4K 约 2.6（大屏幕上标注不至于看不清）。窄屏不缩小。 */
const autoScale = (W: number, H: number) => THREE.MathUtils.clamp(Math.min(W / 1366, H / 820), 1, 3);
const SCALE_KEY = 's3d-ui-scale';
const HOLD_KEY = 's3d-hold';
/** 视角按钮（地铁场景里“人眼视角”叫“你的视角”，另有“旁人视角”） */
const VIEW_IDS = ['explain', 'eye:you', 'eye:nb', 'stereo'];
const viewName = (id: string, sub: boolean) => ({ explain: '讲解视角', 'eye:you': sub ? '你的视角' : '人眼视角', 'eye:nb': '旁人视角', stereo: '双眼视差' } as Record<string, string>)[id];
const loadJSON = <T,>(key: string, fb: T): T => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fb; } catch { return fb; } };
const saveJSON = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 隐私模式等 */ } };
/** 人眼视角的视场（竖直方向，度）：固定的自然视场，不再按手机大小缩放，手机在视野里的位置、大小随姿势和距离变化 */
/** 侧卧场景的枕头：高度、位置（头枕在上面） */
const PILLOW = { h: 0.22, x: 0.42, z: 0.05 };
const EYE_FOV = 46, EYE_FOV_PORTRAIT = 58;
/** 讲解标注（视线、距离、读数）在切换结束 / 拖动松手后保留多久再淡出（ms） */
const ANN_HOLD = 2600;
const loadUserScale = () => { try { const v = parseFloat(localStorage.getItem(SCALE_KEY) || ''); return v >= 0.6 && v <= 2.5 ? v : 1; } catch { return 1; } };

export async function mount(host: HTMLElement, opts: MountOptions) {
  const style = STYLES[0];
  host.classList.add('s3d');
  let userScale = loadUserScale();     // 用户在“调整”里设的界面大小（乘在自动缩放上，存在本机浏览器）
  let hold = +loadJSON<number>(HOLD_KEY, 2.5) || 2.5;   // 自动播放时每个画面停留的秒数
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
  // 道具（凳子、桌子、长椅）画两遍：人物之前一遍、人物之后一遍，都用普通的半透明混合、都不写深度。
  //   - 人物之前那遍：半透明人物后面能透出道具
  //   - 人物之后那遍（只在人物身后的部分通过深度测试）：盖住道具后面的腿脚，淡入时按比例渐渐盖住
  // 完全显示时效果和“不透明道具先画”一样，而且淡入、淡出、显示完整全程用的是同一套画法，结束时不会突然换样子。
  const propMat = () => { const m = style.prop() as THREE.MeshStandardMaterial; m.transparent = true; m.depthWrite = false; return m; };
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
  // 床（侧卧场景，头朝 +X）：床垫、床架、枕头
  const bedMat = propMat();
  const bed = new THREE.Group();
  bed.add(mk(new RoundedBoxGeometry(2.0, 0.2, 1.2, 4, 0.05), bedMat, -0.25, BED_Y - 0.1, 0.12));
  bed.add(mk(new THREE.BoxGeometry(2.06, 0.24, 1.26), bedMat, -0.25, BED_Y - 0.32, 0.12));
  bed.add(mk(new RoundedBoxGeometry(0.4, PILLOW.h, 0.62, 5, 0.05), bedMat, PILLOW.x, BED_Y + PILLOW.h / 2 - 0.02, PILLOW.z));
  scene.add(stool, table, bench, bed);
  // 阴影按透明度抖动着淡入淡出（VSM 阴影会模糊，看不出颗粒）：阴影渲染默认不认 alphaHash，给每个道具配一个带 alphaHash 的深度材质
  const propDepth = (obj: THREE.Object3D) => {
    const d = new THREE.MeshDepthMaterial({ alphaHash: true });
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).customDepthMaterial = d; });
    return d;
  };
  /** 第二遍：同一份几何体，画在人物之后，不投影 */
  const overPass = (obj: THREE.Object3D, mat: THREE.Material) => {
    const o2 = obj.clone(true);
    const m2 = mat.clone();
    o2.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = m2; m.renderOrder = 30; m.castShadow = false; } });
    scene.add(o2);
    return { obj: o2, mat: m2 as THREE.MeshStandardMaterial };
  };
  const propObjs: Record<keyof Props, { obj: THREE.Object3D; mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial; over: { obj: THREE.Object3D; mat: THREE.MeshStandardMaterial } }> = {
    stool: { obj: stool, mat: stoolMat, depth: propDepth(stool), over: overPass(stool, stoolMat) },
    table: { obj: table, mat: tableMat, depth: propDepth(table), over: overPass(table, tableMat) },
    bench: { obj: bench, mat: benchMat, depth: propDepth(bench), over: overPass(bench, benchMat) },
    bed: { obj: bed, mat: bedMat, depth: propDepth(bed), over: overPass(bed, bedMat) },
  };
  const setProps = (p: Props) => {
    for (const [k, { obj, mat, depth, over }] of Object.entries(propObjs)) {
      const a = p[k as keyof Props];
      const b = 1 - Math.sqrt(Math.max(0, 1 - a));   // 两遍叠起来的覆盖率正好是 a
      obj.visible = over.obj.visible = a > 0.005;
      mat.opacity = over.mat.opacity = b;
      depth.opacity = a;
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
  let device: DeviceSpec = DEVICES.find((d) => d.id === opts.device) || DEVICES[0];
  const colorOf: Record<string, string> = {};
  /** 建手机模型：iPhone 优先用苹果官网模型（本机有的话），否则参数化建模 */
  const makePhone = async (d: DeviceSpec): Promise<PhoneModel> => {
    const color = colorOf[d.id] || d.colors[0].id;
    if (d.id === 'iphone18pm' && opts.appleIphone && APPLE_VARIANT[color]) {
      try {
        const buf = await opts.appleIphone(APPLE_VARIANT[color]);
        if (buf) return await buildApplePhone(d, buf);
      } catch (err) { console.warn('苹果模型加载失败，改用参数化模型', err); }
    }
    return buildPhone(d, color);
  };
  let phone: PhoneModel = await makePhone(device);
  phone.group.matrixAutoUpdate = false;
  scene.add(phone.group);
  const dimsOf = (d: DeviceSpec) => ({
    W: d.body.W / 1000, H: d.body.H / 1000, T: d.body.T / 1000,
    bump: rearBump(d.body) / 1000, islandY: islandCenterY(d.body) / 1000,
  });
  const ctx: Ctx = { you, nb, dims: dimsOf(device) };

  // 实测数据按机型名前缀匹配（“iPhone 18 Pro Max GH3” 归到 iPhone 18 Pro Max）。以后加数据只要合并进 data.js
  const models = new Map<string, { model: AngleModel; lut: ReturnType<typeof lutTexture> }>();
  const profilesOf = (dev: DeviceSpec) => opts.data.profiles.filter((p) => p.device === dev.dataDevice || p.device.startsWith(dev.dataDevice + ' '));
  const hasPrivacy = () => profilesOf(device).some((p) => p.privacy) && profilesOf(device).some((p) => !p.privacy);
  const privacyKind = () => profilesOf(device).find((p) => p.privacy)?.privacyKind || 'mode';
  let privacy = !!opts.privacy;
  let model!: AngleModel;
  let profile!: Profile;
  const modelOf = (p: Profile) => {
    let m = models.get(p.id);
    if (!m) { const mm = createModel({ angles: opts.data.angles, sets: p.sets }); m = { model: mm, lut: lutTexture(mm) }; models.set(p.id, m); }
    return m;
  };
  const useProfile = () => {
    const ps = profilesOf(device);
    profile = ps.find((q) => q.privacy === (privacy && hasPrivacy())) || ps[0] || opts.data.profiles[0];
    const m = modelOf(profile);
    phone.screen.material.uniforms.uLut.value = m.lut.tex;
    phone.screen.material.uniforms.uLutW.value = m.lut.width;
    model = m.model;
  };
  useProfile();
  /** 全部数据的最大色偏（粗扫），固定色偏量程，切换机型 / 防窥时刻度不跳 */
  const JMAX = (() => {
    let j = 0;
    for (const p of opts.data.profiles) {
      const m = modelOf(p).model;
      for (let th = 5; th <= m.thetaMax; th += 5) for (let ps = 0; ps < 360; ps += 15) j = Math.max(j, m.evalAt(th, ps).jncd);
    }
    return [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40].find((v) => v >= j) || Math.ceil(j);
  })();

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
  const stereo = new Stereo(ui);
  stereo.onChange = () => { host.classList.toggle('stereo', stereo.active); syncViewBtn(); };
  stereo.onExit = () => stereo.stop(true);      // 合回一个整体，留在人眼视角
  const { W: W0, H: H0 } = size();
  const rig = new CameraRig(renderer.domElement, W0 / H0);
  ui.insertAdjacentHTML('beforeend', `
    <div class="s3d-hud">
      <div class="s3d-scene" data-k="scene"></div>
      <div class="s3d-hero"><span data-k="theta">0°</span><span class="s3d-hero-sub" data-k="where"></span></div>
      <div class="s3d-stats"><span><i>亮度</i><b data-k="lum">100%</b></span><span><i>色偏</i><b data-k="jncd">0.0</b><i>JNCD</i></span><span><i data-k="deK">ΔE2000</i><b data-k="de">0.0</b></span></div>
      <div class="s3d-note" data-k="note"></div>
      <div class="s3d-warn" data-k="warn"></div>
    </div>
    <div class="s3d-inset" data-k="insetNb" data-who="nb"><div class="s3d-inset-cap"></div></div>
    <div class="s3d-inset" data-k="insetYou" data-who="you"><div class="s3d-inset-cap"></div></div>
    <div class="s3d-adjust" data-k="adjust" hidden></div>
    <div class="s3d-toast" data-k="toast" role="status"></div>
    <div class="s3d-tl" data-k="tl" hidden></div>
    <div class="s3d-bar">
      <div class="s3d-seg" data-k="scenes">${PRESETS.map((p) => `<button data-v="${p.id}">${p.name}</button>`).join('')}</div>
      <span class="s3d-div"></span>
      <div class="s3d-row2">
      <div class="s3d-seg" data-k="views"></div>
      <span class="s3d-div"></span>
      <div class="s3d-seg" data-k="devices">${DEVICES.map((d) => `<button data-v="${d.id}" title="${d.name}">${d.name.split(' ')[0]}</button>`).join('')}</div>
      <label class="s3d-toggle" data-k="privacyRow"><input type="checkbox" data-k="privacy"><span class="s3d-sw"></span><span data-k="privacyLabel">防窥</span></label>
      <label class="s3d-select"><span>屏幕</span><select data-k="pattern">${PATTERNS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
      <button class="s3d-btn" data-k="adjustBtn" aria-expanded="false">调整</button>
      <button class="s3d-btn" data-k="dataBtn" aria-expanded="false">数据</button>
      <span class="s3d-div"></span>
      <button class="s3d-btn" data-k="tlBtn" aria-expanded="false" title="编排播放顺序：把场景、视角、机型按钮拖到时间线上">编排</button>
      <button class="s3d-btn s3d-play" data-k="playBtn" title="按编排的时间线连续播放（空格）">▶ 播放</button>
      <button class="s3d-btn" data-k="recBtn" title="把连续播放录成视频导出">● 导出</button>
      </div>
    </div>`);
  const $ = (k: string) => ui.querySelector(`[data-k="${k}"]`) as HTMLElement;
  ($('pattern') as HTMLSelectElement).value = patternName;
  $('pattern').addEventListener('change', (e) => setPattern((e.target as HTMLSelectElement).value));
  const privEl = ui.querySelector('[data-k="privacy"]') as HTMLInputElement;
  privEl.addEventListener('change', () => { privacy = privEl.checked; useProfile(); });
  const segOn = (k: string, v: string) => ui.querySelectorAll(`[data-k="${k}"] button`).forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.v === v));
  /** 机型相关的界面：防窥开关（小米是“防窥”模式，iPhone 是“防窥膜”）、机型按钮 */
  const syncDeviceUI = () => {
    $('privacyRow').style.display = hasPrivacy() ? '' : 'none';
    $('privacyLabel').textContent = privacyKind() === 'film' ? '防窥膜' : '防窥';
    privEl.checked = privacy && hasPrivacy();
    segOn('devices', device.id);
  };
  syncDeviceUI();
  const data = createDataPanel(ui, model.thetaMax);

  // ---------- 场景状态与过渡 ----------
  type Snap = { you: PoseSnap; nb: PoseSnap | null; phone: THREE.Matrix4; props: Props; nbAlpha: number; lie: number; cam: { pos: THREE.Vector3; target: THREE.Vector3 } };
  const params: Record<string, Record<string, number>> = Object.fromEntries(PRESETS.map((p) => [p.id, { ...p.defaults }]));
  let preset: Preset = PRESETS.find((p) => p.id === opts.scene) || PRESETS[1];
  let viewer: Viewer = 'nb';
  let state!: SceneState;
  let phoneM = new THREE.Matrix4();
  let props: Props = { stool: 0, table: 0, bench: 0, bed: 0 };
  /** 躺着的程度（0 坐着 → 1 侧卧，过渡中渐变）：人眼视角的“上”从世界竖直方向渐渐换成头顶方向 */
  let lieW = 0;
  let nbAlpha = 0;
  let figFade = 1, fadeFrom = 1, fadeTo = 1, fadeT0 = 0, fadeDur = 300;
  let trans: null | { a: Snap; b: SceneState; t0: number; dur: number; p?: number; grip?: [THREE.Matrix4, THREE.Matrix4] | null; gripFor?: SceneState } = null;
  /** 演示序列里的“转动手机”：参数平滑变到目标值 */
  let paramTween: null | { key: string; from: number; to: number; t0: number; dur: number } = null;

  /** 按预设和参数摆出目标状态，但不改变当前显示（摆完立刻还原当前姿势）。 */
  const buildState = (p: Preset) => {
    const curYou = capturePose(you), curNb = capturePose(nb);
    const s = p.build(ctx, params[p.id]);
    applyPose(you, curYou); applyPose(nb, curNb);
    return s;
  };
  const snapNow = (): Snap => ({
    you: capturePose(you), nb: nbAlpha > 0.01 ? capturePose(nb) : null, phone: phoneM.clone(), props: { ...props }, nbAlpha, lie: lieW,
    cam: rig.getExplain(),
  });
  const startFade = (to: number, ms = 300) => { fadeFrom = figFade; fadeTo = to; fadeT0 = performance.now(); fadeDur = ms; };

  const applySteady = (s: SceneState, resetCam: boolean) => {
    state = s;
    applyPose(you, s.you);
    if (s.nb) applyPose(nb, s.nb);
    phoneM = s.phone.clone();
    props = { ...s.props };
    nbAlpha = s.nb ? 1 : 0;
    lieW = s.lying ? 1 : 0;
    if (resetCam) rig.setExplain(s.explain.pos, s.explain.target, s.explain.fov);
  };

  const describe = () => {
    $('scene').textContent = preset.name;
    $('note').textContent = '';
    segOn('scenes', preset.id);
    const sub = preset.id === 'subway';
    const views = (sub ? ['explain', 'eye:nb', 'eye:you', 'stereo'] : ['explain', 'eye:you', 'stereo']).map((v) => [v, viewName(v, sub)]);
    const html = views.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('');
    if ($('views').dataset.html !== html) { $('views').innerHTML = html; $('views').dataset.html = html; }
    syncViewBtn();
    renderAdjust();
  };

  /** 换场景：视角沿用当前的（人眼视角时镜头一直跟着眼睛走，双眼视差保持当前显示方式），只有讲解机位换到新场景的取景 */
  const goto = (p: Preset, animate = true) => {
    paramTween = null;
    const target = buildState(p);
    if (!animate || !state) { trans = null; preset = p; applySteady(target, true); describe(); startFade(FADE_TO, 1); return; }
    trans = { a: snapNow(), b: target, t0: performance.now(), dur: TRANSITION_MS };
    preset = p;
    // 讲解视角：切换开始时人物慢慢淡回不透明，看清姿势变化；人眼视角 / 双眼视差：保持半透明，不闪
    if (rig.mode === 'explain' && !stereo.active) startFade(1, 650);
    describe();
  };

  /** 右手的坐标系（去掉骨骼缩放） */
  const handFrame = () => {
    const h = you.bones.hand_r, p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    h.updateWorldMatrix(true, false);
    h.matrixWorld.decompose(p, q, s);
    return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
  };
  /** 这个姿势里手机是否拿在右手里；是的话返回“手机相对右手”的变换 */
  const gripOf = (pose: PoseSnap, ph: THREE.Matrix4) => {
    applyPose(you, pose);
    const H = handFrame();
    return new THREE.Vector3().setFromMatrixPosition(H).distanceTo(new THREE.Vector3().setFromMatrixPosition(ph)) < 0.16 ? H.invert().multiply(ph) : null;
  };

  /** 每帧推进过渡：人物姿势、手机、道具、旁人、讲解镜头一起插值。 */
  const stepTransition = (now: number) => {
    if (!trans) return;
    const raw = trans.p ?? Math.min(1, (now - trans.t0) / trans.dur);
    const e = ease(raw);
    const { a, b } = trans;
    // 过渡两端手机都拿在右手里：手机跟着手走（按两端“手机相对手”的位置插值），手和手机中途不会分开
    if (trans.gripFor !== b) {
      const ga = gripOf(a.you, a.phone), gb = gripOf(b.you, b.phone);
      trans.grip = ga && gb ? [ga, gb] : null;
      trans.gripFor = b;
    }
    blendPose(you, a.you, b.you, e);
    if (b.nb) blendPose(nb, a.nb ?? b.nb, b.nb, a.nb ? e : 1);
    else if (a.nb) applyPose(nb, a.nb);
    const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sc = new THREE.Vector3();
    if (trans.grip) {
      trans.grip[0].decompose(pa, qa, sc); trans.grip[1].decompose(pb, qb, sc);
      phoneM.copy(handFrame()).multiply(new THREE.Matrix4().compose(pa.lerp(pb, e), qa.slerp(qb, e), new THREE.Vector3(1, 1, 1)));
    } else {
      a.phone.decompose(pa, qa, sc); b.phone.decompose(pb, qb, sc);
      phoneM.compose(pa.lerp(pb, e), qa.slerp(qb, e), new THREE.Vector3(1, 1, 1));
    }
    for (const k of Object.keys(props) as (keyof Props)[]) props[k] = a.props[k] + (b.props[k] - a.props[k]) * e;
    nbAlpha = a.nbAlpha + ((b.nb ? 1 : 0) - a.nbAlpha) * e;
    lieW = a.lie + ((b.lying ? 1 : 0) - a.lie) * e;
    rig.setExplain(a.cam.pos.clone().lerp(b.explain.pos, e), a.cam.target.clone().lerp(b.explain.target, e), b.explain.fov);
    if (raw >= 1 && trans.p === undefined) {
      trans = null;
      applySteady(b, true);
      startFade(FADE_TO, 1100);   // 切换结束后慢慢淡到半透明，焦点回到屏幕
      pokeAnn();
    }
  };

  // ---------- 调整面板（观看距离 / 离轴角） ----------
  function renderAdjust() {
    const box = $('adjust');
    const rows = preset.params.map((d) => `
      <label class="s3d-row"><span>${d.label}</span><b data-out="${d.key}">${params[preset.id][d.key]}${d.unit}</b></label>
      <input type="range" data-p="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${params[preset.id][d.key]}">`).join('');
    const cur = colorOf[device.id] || device.colors[0].id;
    const sw = device.colors.map((c) => `<button class="s3d-sw-btn${c.id === cur ? ' on' : ''}" data-color="${c.id}" title="${c.name}" style="--c:${c.swatch}"></button>`).join('');
    box.innerHTML = `<div class="s3d-adjust-h">调整 · ${preset.name}</div>${rows}<div class="s3d-derived" data-k="derived"></div>
      <div class="s3d-row"><span>机身颜色 · ${device.name}</span></div><div class="s3d-swatches">${sw}</div>
      <div class="s3d-derived">外观：${phone.source === 'apple' ? '苹果官网 AR 模型（iPhone 18 Pro 等比放大，仅本机）' : '按官方尺寸参数化建模'}</div>
      <label class="s3d-row"><span>播放时每个画面停留</span><b data-out="hold">${hold} 秒</b></label>
      <input type="range" data-ui="hold" min="1" max="8" step="0.5" value="${hold}">
      <label class="s3d-row"><span>界面与标注大小</span><b data-out="uiScale">${Math.round(userScale * 100)}%</b></label>
      <input type="range" data-ui="scale" min="60" max="250" step="10" value="${Math.round(userScale * 100)}">
      <button class="s3d-link" data-k="resetParams">恢复默认</button>`;
    updateDerived();
  }
  function syncParamUI(key: string) {
    const def = preset.params.find((d) => d.key === key);
    if (!def) return;
    const v = Math.round(params[preset.id][key]);
    const out = ui.querySelector(`[data-out="${key}"]`), inp = ui.querySelector(`input[data-p="${key}"]`) as HTMLInputElement | null;
    if (out) out.textContent = v + def.unit;
    if (inp) inp.value = String(v);
  }
  function updateDerived() {
    const el = ui.querySelector('[data-k="derived"]') as HTMLElement | null;
    if (!el || !state) return;
    const d = state.derived;
    el.textContent = preset.id === 'desk' && d.dist ? `观看距离 ${d.dist.toFixed(0)} cm · 眼睛高出屏幕 ${d.height.toFixed(0)} cm` : '';
  }
  $('adjust').addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.ui === 'scale') { setUserScale(+t.value / 100); return; }
    if (t.dataset.ui === 'hold') { hold = +t.value; saveJSON(HOLD_KEY, hold); (ui.querySelector('[data-out="hold"]') as HTMLElement).textContent = `${hold} 秒`; return; }
    if (!t.dataset.p) return;
    params[preset.id][t.dataset.p] = +t.value;
    const def = preset.params.find((d) => d.key === t.dataset.p)!;
    (ui.querySelector(`[data-out="${t.dataset.p}"]`) as HTMLElement).textContent = t.value + def.unit;
    trans = null;
    pokeAnn();
    applySteady(buildState(preset), false);     // 拖动时手机和眼睛直接跟着动
    updateDerived();
  });
  $('adjust').addEventListener('click', (e) => {
    const cb = (e.target as HTMLElement).closest('[data-color]') as HTMLElement | null;
    if (cb) {
      colorOf[device.id] = cb.dataset.color!;
      if (phone.source === 'apple') void swapPhone(device);       // 苹果模型每种颜色是一份文件
      else phone.setColor(device.colors.find((c) => c.id === cb.dataset.color)!);
      renderAdjust();
      return;
    }
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
    if (p && p !== preset && !playFromScene(p.id)) goto(p);
  });
  /** 视角按钮：explain，或 eye:you / eye:nb（地铁场景里选谁的眼睛） */
  function syncViewBtn() {
    const v = stereo.active && !stereo.leaving ? 'stereo' : rig.mode === 'explain' ? 'explain' : `eye:${preset.id === 'subway' ? viewer : 'you'}`;
    segOn('views', v);
    host.classList.toggle('eyeview', rig.mode === 'eye');
  }
  const setView = (v: ViewMode) => { rig.setMode(v); syncViewBtn(); };
  // 人眼视角里换了观看者（手动选，或进出地铁场景）：镜头从一个人的眼睛平滑移到另一个人的眼睛（每帧检测，见 frame）
  let eyeSwitch: { from: THREE.Vector3; fromFwd: THREE.Vector3; fromUp: THREE.Vector3; t0: number } | null = null;
  let lastCamEye = new THREE.Vector3(), lastCamFwd = new THREE.Vector3(0, 0, 1), lastCamUp = new THREE.Vector3(0, 1, 0);
  let lastViewer: Viewer | null = null;
  const setViewer = (v: Viewer) => { viewer = v; describe(); };
  const pickView = (v: string) => {
    if (v === 'stereo') {                 // 双眼视差：先到人眼视角（镜头到位后从整体画面开始分开）
      if (!stereo.active || stereo.leaving) { if (rig.mode !== 'eye') setView('eye'); stereo.start(); }
      return;
    }
    if (v === 'explain') { stereo.stop(false); setView('explain'); }
    else { stereo.stop(true); setViewer(v.split(':')[1] as Viewer); setView('eye'); }
  };
  $('views').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b && !playFromItem(b.dataset.v!)) pickView(b.dataset.v!); });

  // 演示用快捷键：H 隐藏界面，1–4 切换场景，V 切换视角，P 防窥
  let active = true;
  window.addEventListener('keydown', (e) => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'h') host.classList.toggle('clean');
    else if (/^[1-9]$/.test(k) && PRESETS[+k - 1]) goto(PRESETS[+k - 1]);
    else if (k === ' ') { if (player.playing) player.stop(); else void player.play(steps()); }
    else if (k === 'v') {
      const opts2 = preset.id === 'subway' ? ['explain', 'eye:nb', 'eye:you'] : ['explain', 'eye:you'];
      const cur = rig.mode === 'explain' ? 'explain' : `eye:${preset.id === 'subway' ? viewer : 'you'}`;
      pickView(opts2[(opts2.indexOf(cur) + 1) % opts2.length]);
    } else if (k === 'p' && hasPrivacy()) { privEl.checked = !privEl.checked; privacy = privEl.checked; useProfile(); }
    else if (k === 'd') setData(!data.visible);
    else if (k === 'b') { if (stereo.active && !stereo.leaving) stereo.stop(true); else pickView('stereo'); }
    else if (k === '=' || k === '+') setUserScale(userScale + 0.1);       // 现场放大 / 缩小界面与标注
    else if (k === '-' || k === '_') setUserScale(userScale - 0.1);
    else if (k === '0') setUserScale(1);
    else return;
    e.preventDefault();
  });

  // ---------- 机型切换 ----------
  let loading = 0;
  const swapPhone = async (d: DeviceSpec) => {
    const my = ++loading;
    if (d.id === 'iphone18pm' && opts.appleIphone) $('warn').textContent = '正在加载 iPhone 模型…';
    const next = await makePhone(d);
    if (my !== loading) { next.dispose(); return false; }   // 期间又切了别的，丢掉
    scene.remove(phone.group);
    phone.dispose();
    device = d;
    phone = next;
    phone.group.matrixAutoUpdate = false;
    phone.group.matrix.copy(phoneM);
    scene.add(phone.group);
    ctx.dims = dimsOf(device);
    useProfile();
    setPattern(patternName);             // 按新机型分辨率重新生成画面
    syncDeviceUI();
    renderAdjust();
    return true;
  };
  /** 换机型：只换手机（尺寸不同，手和手机按新尺寸直接摆好），不重播场景过渡，视角保持不变 */
  let swapping = false;
  const setDevice = async (id: string) => {
    const d = DEVICES.find((x) => x.id === id);
    if (!d || d === device) return;
    segOn('devices', d.id);
    swapping = true;
    try {
      if (await swapPhone(d)) {
        if (trans) trans.b = buildState(preset);             // 正在换场景：过渡终点按新机型重算
        else applySteady(buildState(preset), false);
        pokeAnn();
        updateDerived();
      }
    } finally { swapping = false; }
  };
  $('devices').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b && !playFromItem('dev:' + b.dataset.v)) setDevice(b.dataset.v!); });
  const setData = (on: boolean) => {
    data.setVisible(on);
    $('dataBtn').classList.toggle('on', on);
    $('dataBtn').setAttribute('aria-expanded', String(on));
    host.classList.toggle('with-data', on);
  };
  $('dataBtn').addEventListener('click', () => setData(!data.visible));

  // ---------- 拖动手机调整角度 ----------
  // 讲解视角：按在手机上拖动转手机（按在别处仍是转镜头）；人眼视角 / 双眼视差：在画面任何地方拖动都转手机。
  // 横向 / 纵向分别改哪个参数由预设决定（转开、俯仰、桌上转动、离轴角……），和“调整”面板的滑块是同一组参数。
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const overPhone = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, rig.camera);
    return ray.intersectObject(phone.group, true).length > 0;
  };
  const dragAnywhere = () => rig.mode === 'eye' && rig.progress >= 1;
  let drag: null | { x: number; y: number; start: Record<string, number>; id: number } = null;
  host.addEventListener('pointerdown', (e) => {
    if (e.target !== renderer.domElement || e.button !== 0 || !preset.drag || trans) return;
    if (!dragAnywhere() && (rig.progress > 0 || !overPhone(e))) return;
    e.stopPropagation();                 // 不交给 OrbitControls（不转镜头）
    e.preventDefault();
    paramTween = null;
    drag = { x: e.clientX, y: e.clientY, start: { ...params[preset.id] }, id: e.pointerId };
    renderer.domElement.setPointerCapture(e.pointerId);
    host.classList.add('dragging');
  }, true);
  let hoverT = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) {
      const dd = preset.drag!;
      for (const [axis, d] of [['x', e.clientX - drag.x], ['y', e.clientY - drag.y]] as const) {
        const m = dd[axis];
        if (!m) continue;
        const def = preset.params.find((p) => p.key === m.key)!;
        params[preset.id][m.key] = THREE.MathUtils.clamp(drag.start[m.key] + d * m.perPx, def.min, def.max);
        syncParamUI(m.key);
      }
      applySteady(buildState(preset), false);
      updateDerived();
      return;
    }
    // 讲解视角里指到手机上时换成“抓手”光标（节流）
    if (e.pointerType !== 'mouse' || e.buttons || performance.now() - hoverT < 60) return;
    hoverT = performance.now();
    host.classList.toggle('over-phone', rig.progress === 0 && !!preset.drag && overPhone(e));
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    pokeAnn();
    host.classList.remove('dragging');
  };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);

  // ---------- 拖动排序、自动播放、导出视频 ----------
  // 场景 / 视角按钮：点击直接切换，左右拖动调整顺序；“▶ 播放”按场景顺序、每个场景里按视角顺序各展示一遍
  // 编排时间线：从工具栏拖按钮上来插入，左右拖排序，拖出删除；播放按时间线走
  const sceneName = (id: string) => PRESETS.find((p) => p.id === id)?.name || id;
  const itemName = (id: string, sc: string) => id.startsWith('dev:') ? (DEVICES.find((d) => d.id === id.slice(4))?.name.split(' ')[0] || id)
    : id.startsWith('priv:') ? (id === 'priv:on' ? '防窥 开' : '防窥 关') : viewName(id, sc === 'subway');
  const tl = createTimeline($('tl'), {
    labels: { scene: sceneName, item: itemName },
    validScene: (id) => PRESETS.some((p) => p.id === id),
    validItem: (id) => VIEW_IDS.includes(id) || id === 'priv:on' || id === 'priv:off' || (id.startsWith('dev:') && DEVICES.some((d) => d.id === id.slice(4))),
    sources: [
      { el: $('scenes'), kind: 'scene' },
      { el: $('views'), kind: 'item' },
      { el: $('devices'), kind: 'item', map: (v) => 'dev:' + v },
      // 防窥开关：拖上去的是它现在的状态
      { el: $('privacyRow'), kind: 'item', pick: () => ({ value: privEl.checked ? 'priv:on' : 'priv:off', text: privEl.checked ? '防窥 开' : '防窥 关' }) },
    ],
    open: () => setTl(true),
    jump: (sg, idx) => {
      if (playFromStep(tl.segments.indexOf(sg), idx)) return;       // 播放中：从这一步接着播
      const p = PRESETS.find((q) => q.id === sg.scene);
      if (p && p !== preset) goto(p);
      const it = idx >= 0 ? sg.items[idx] : sg.items[0];
      if (it) applyItem(it);
    },
  });
  const applyItem = (it: string) => {
    if (it.startsWith('dev:')) void setDevice(it.slice(4));
    else if (it.startsWith('priv:')) { if (hasPrivacy()) { privacy = it === 'priv:on'; syncDeviceUI(); useProfile(); } }
    else pickView(it);
  };
  const steps = (): Step[] => tl.segments.flatMap((sg, i): Step[] => sg.items.length
    ? sg.items.map((it, j): Step => ({ scene: sg.scene, item: it, seg: i, idx: j }))
    : [{ scene: sg.scene, seg: i, idx: -1 }]);
  // 播放中点了时间线上的某一步，或工具栏上的场景 / 视角 / 机型：在时间线里找到对应的那一步，从那里接着播（只有点“停止”才停）
  const playFromStep = (seg: number, idx: number) => {
    if (!player.playing) return false;
    const list = steps();
    return player.jump(list, list.findIndex((st) => st.seg === seg && (idx < 0 || st.idx === idx)));
  };
  /** 场景按钮：跳到时间线里这个场景的下一段（从当前段往后找，找到头再从开头找） */
  const playFromScene = (id: string) => {
    const cur = player.current;
    if (!cur) return false;
    const segs = tl.segments, n = segs.length;
    for (let k = 1; k <= n; k++) { const s = (cur.seg + k) % n; if (segs[s].scene === id) return playFromStep(s, -1); }
    return false;
  };
  /** 视角 / 机型按钮：当前这一段里有这一步就跳过去 */
  const playFromItem = (it: string) => {
    const cur = player.current;
    const j = cur ? tl.segments[cur.seg]?.items.indexOf(it) ?? -1 : -1;
    return j >= 0 && playFromStep(cur!.seg, j);
  };
  function setTl(open: boolean) {
    $('tl').hidden = !open;
    $('tlBtn').classList.toggle('on', open);
    $('tlBtn').setAttribute('aria-expanded', String(open));
    if (open && !$('adjust').hidden) $('adjustBtn').click();        // 和“调整”面板在同一位置，只开一个
  }
  $('tlBtn').addEventListener('click', () => setTl(!!$('tl').hidden));
  $('adjustBtn').addEventListener('click', () => { if (!$('adjust').hidden) setTl(false); });
  let toastT = 0;
  const toast = (msg: string) => {
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = window.setTimeout(() => el.classList.remove('show'), 4000);
  };
  const player = createPlayer({
    apply: (st) => {
      const p = st.scene ? PRESETS.find((q) => q.id === st.scene) : null;
      // 每段开始（或跳到别的场景）时，这个场景的参数恢复默认（忽略手动调过 / 拖过的距离、角度）
      const reset = !!p && (p !== preset || st.idx <= 0) && Object.keys(p.defaults).some((k) => params[p.id][k] !== p.defaults[k]);
      if (reset) Object.assign(params[p!.id], p!.defaults);
      if (p && (p !== preset || reset)) goto(p);   // 场景不同才换：换场景和这一段的第一个视角同时开始，镜头连贯；跳到段中间的某一步也先换到那个场景
      if (st.item) applyItem(st.item);
    },
    onStep: (st) => tl.highlight(st ? { seg: st.seg, idx: st.idx } : null),
    settled: () => !trans && !rig.busy && !eyeSwitch && !stereo.busy && !paramTween && !swapping,
    hold: () => hold,
    setRecording: (on) => {
      host.classList.toggle('recording', on);
      document.body.classList.toggle('s3d-recording', on);
    },
    onState: (playing, recording) => {
      $('playBtn').textContent = playing ? '■ 停止' : '▶ 播放';
      $('playBtn').classList.toggle('on', playing);
      ($('recBtn') as HTMLButtonElement).disabled = playing || recording;
      host.classList.toggle('playing', playing);
    },
    toast,
  });
  $('playBtn').addEventListener('click', () => { if (player.playing) player.stop(); else void player.play(steps()); });
  $('recBtn').addEventListener('click', () => {
    toast('请在浏览器弹窗里选择“此标签页”开始录制；录制中按 Esc 停止');
    void player.exportVideo(steps());
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (player.playing || player.recording)) { player.stop(); e.preventDefault(); } });


  goto(preset, false);
  setView(opts.view || 'explain');
  if (opts.view === 'eye') rig.seek(1);
  syncViewBtn();

  // ---------- 渲染 ----------
  const insetCam = new THREE.PerspectiveCamera(42, 0.8, 0.01, 30);
  // 地铁场景的两个小窗：上面是旁人看到的、下面是你看到的（各自用自己的眼睛对同一部手机渲染）
  const insets = (['nb', 'you'] as Viewer[]).map((who) => {
    const el = $(who === 'nb' ? 'insetNb' : 'insetYou');
    const cv = document.createElement('canvas');
    cv.className = 's3d-inset-cv';
    el.prepend(cv);
    return { who, el, cv, g: cv.getContext('2d')!, cap: el.querySelector('.s3d-inset-cap') as HTMLElement, rect: [0, 0, 1, 1] as [number, number, number, number] };
  });
  let insetAlpha = 0;
  let uiK = 1;
  const applyScale = () => {
    const { W, H } = size();
    uiK = autoScale(W, H) * userScale;
    host.style.setProperty('--k', uiK.toFixed(3));
    document.documentElement.style.setProperty('--s3d-k', uiK.toFixed(3));   // 页面上的模式切换按钮跟着放大
    ann.setScale(uiK);
  };
  function setUserScale(v: number) {
    userScale = Math.round(THREE.MathUtils.clamp(v, 0.6, 2.5) * 10) / 10;
    try { localStorage.setItem(SCALE_KEY, String(userScale)); } catch { /* 隐私模式等存不了就算了 */ }
    applyScale();
    const out = ui.querySelector('[data-out="uiScale"]'), inp = ui.querySelector('[data-ui="scale"]') as HTMLInputElement | null;
    if (out) out.textContent = `${Math.round(userScale * 100)}%`;
    if (inp && +inp.value !== Math.round(userScale * 100)) inp.value = String(Math.round(userScale * 100));
  }
  const resize = () => {
    const { W, H } = size();
    renderer.setSize(W, H, false);
    rig.setAspect(W / H);
    ann.setResolution(W, H);
    applyScale();
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
  /**
   * 人眼视角的镜头方向：左右对准手机（不跟头的左右偏转和歪斜，画面保持水平、手机不斜），
   * 上下用头的俯仰——所以正视时手机在正前方，正常手持时在视野偏下（头低得比视线少），放在桌上时头直接看着手机。
   */
  const eyeAxes = (c: Character, eye: THREE.Vector3, target: THREE.Vector3) => {
    const hf = new THREE.Vector3(0, 0, 1).applyQuaternion(c.bones.Head.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const ds = target.clone().sub(eye).normalize();
    const flat = new THREE.Vector3(ds.x, 0, ds.z);
    let fwd = ds, up = new THREE.Vector3(0, 0, -1);
    if (flat.lengthSq() >= 1e-4) {
      flat.normalize();
      const elev = Math.asin(THREE.MathUtils.clamp(hf.y, -1, 1));
      fwd = flat.multiplyScalar(Math.cos(elev)).add(new THREE.Vector3(0, Math.sin(elev), 0)).normalize();
      up = new THREE.Vector3(0, 1, 0);
    }
    // 躺着：镜头直接对着手机，“上”跟着头顶（躺着的人看手机，手机是正的），坐着 ↔ 躺着之间渐变
    if (c === you && lieW > 0) {
      fwd = fwd.clone().lerp(ds, lieW).normalize();
      up = up.clone().lerp(headAxes(c).up, lieW).normalize();
    }
    return { fwd, up };
  };
  // 讲解标注：切换结束 / 拖动松手后保留一会儿再淡出
  let annUntil = performance.now() + ANN_HOLD + 600, annAlpha = 1, lastFrame = performance.now(), wasExplain = true, reachFade = 1;
  const pokeAnn = () => { annUntil = performance.now() + ANN_HOLD; };

  const frame = (now: number) => {
    const { W, H } = size();
    stepTransition(now);
    if (paramTween && !trans) {
      const k = ease(Math.min(1, (now - paramTween.t0) / paramTween.dur));
      params[preset.id][paramTween.key] = paramTween.from + (paramTween.to - paramTween.from) * k;
      applySteady(buildState(preset), false);
      syncParamUI(paramTween.key);
      updateDerived();
      if (k >= 1) paramTween = null;
    }
    // 人物透明度：缓入缓出地渐变（不是线性，开始和结束都不突兀）
    if (fadeT0) figFade = fadeFrom + (fadeTo - fadeFrom) * THREE.MathUtils.smoothstep(Math.min(1, (now - fadeT0) / fadeDur), 0, 1);
    reachFade += ((state.reach || trans ? 1 : 0.35) - reachFade) * Math.min(1, (now - lastFrame) / 350);   // 手臂够不到时整个人淡成半透明
    phone.group.matrix.copy(phoneM);
    phone.group.updateMatrixWorld(true);
    setProps(props);
    nb.root.visible = nbAlpha > 0.01;

    const eyeYou = eyeWorld(you);
    const eyeNb = nb.root.visible ? eyeWorld(nb) : null;
    const sub = preset.id === 'subway' && !!eyeNb && !trans;
    const mainViewer: Viewer = sub ? viewer : 'you';
    let mainEye = mainViewer === 'nb' && eyeNb ? eyeNb : eyeYou;
    const axes = eyeAxes(mainViewer === 'nb' && eyeNb ? nb : you, mainEye, new THREE.Vector3().setFromMatrixPosition(phoneM));
    let camFwd = axes.fwd, camUp = axes.up;
    if (lastViewer && mainViewer !== lastViewer) eyeSwitch = { from: lastCamEye.clone(), fromFwd: lastCamFwd.clone(), fromUp: lastCamUp.clone(), t0: now };
    lastViewer = mainViewer;
    let switching = 0;
    if (eyeSwitch) {
      const k = Math.min(1, (now - eyeSwitch.t0) / 1100);
      switching = 1 - k;
      const e = ease(k);
      mainEye = eyeSwitch.from.clone().lerp(mainEye, e).add(new THREE.Vector3(0, 0.06 * Math.sin(Math.PI * e) * Math.min(1, rig.progress * 4), 0));
      camFwd = eyeSwitch.fromFwd.clone().lerp(camFwd, e).normalize();
      camUp = eyeSwitch.fromUp.clone().lerp(camUp, e).normalize();
      if (k >= 1) eyeSwitch = null;
    }
    lastCamEye.copy(mainEye); lastCamFwd.copy(camFwd); lastCamUp.copy(camUp);
    const otherEye = sub ? (mainViewer === 'nb' ? eyeYou : eyeNb!) : null;
    const scr = new THREE.Vector3().setFromMatrixPosition(phoneM);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(phoneM);
    const fitFov = (eye: THREE.Vector3, fill: number) => {
      const dist = eye.distanceTo(scr);
      const ang = 2 * Math.atan((ctx.dims.H / 2) / dist) * 180 / Math.PI;
      return THREE.MathUtils.clamp(ang / fill, 16, 60);
    };
    rig.setEyeFov(W / H < 1 ? EYE_FOV_PORTRAIT : EYE_FOV);
    const camFade = rig.update(now, mainEye, mainEye.clone().add(camFwd), camUp);

    inv.copy(phoneM).invert();
    const u = phone.screen.material.uniforms;
    u.uEye.value.copy(mainEye).applyMatrix4(inv);
    rig.camera.updateMatrixWorld();
    lookYou.setFade(figFade * reachFade);
    lookNb.setFade(figFade * nbAlpha);
    lookNb.setDepth(nbAlpha);
    const stereoOn = stereo.active && rig.progress >= 1;
    let covered = false;
    if (stereoOn) {
      covered = stereo.render(now, {
        renderer, W, H, k: uiK, baseFov: rig.camera.fov, baseQuat: rig.camera.quaternion.clone(), eye: mainEye, screen: scr, up: camUp, phoneInv: inv, model, fitFov,
        renderEye: (ey, cam, chroma) => {
          u.uEye.value.copy(ey).applyMatrix4(inv);
          u.uChroma.value = chroma;
          lookYou.setHead(headOf(you, eyeYou), cam, mainViewer === 'you' ? 1 : 0);
          if (eyeNb) lookNb.setHead(headOf(nb, eyeNb), cam, mainViewer === 'nb' ? 1 : 0);
          renderer.render(scene, cam);
        },
      });
      u.uEye.value.copy(mainEye).applyMatrix4(inv);
      u.uChroma.value = 1;
    }
    // 右侧两个小窗：地铁场景是旁人看到的 / 你看到的，侧卧是右眼（上）/ 左眼（下）看到的。
    // 各渲染一次（先画到画布左下角再拷到小窗自己的画布，之后主画面会把那一块盖掉）
    const lie = !trans && !!state.lying;
    const eyesLR = lie ? eyePair(you, stereo.ipd) : null;
    const insetViews: { eye: THREE.Vector3; label: string; hide: Viewer }[] | null = stereoOn ? null
      : sub && eyeNb ? [{ eye: eyeNb, label: '旁人看到的', hide: 'nb' }, { eye: eyeYou, label: '你看到的', hide: 'you' }]
      : eyesLR ? [{ eye: eyesLR[1], label: '右眼（上）', hide: 'you' }, { eye: eyesLR[0], label: '左眼（下）', hide: 'you' }] : null;
    const insetOn = !!insetViews;
    if (insetViews) {
      const narrow = W < 700;
      const top = narrow ? 112 : 72 * uiK, capH = (narrow ? 36 : rig.mode === 'eye' ? 50 : 42) * (narrow ? 1 : uiK), gap = (narrow ? 8 : 12) * uiK, bottomRes = narrow ? 140 : 100 * uiK;   // 小窗下方两行说明：名称、读数
      let iw = Math.round(Math.min(280 * uiK, W * (narrow ? 0.3 : 0.2))), ih = Math.round(iw * 1.25);
      const maxIh = Math.floor((H - top - bottomRes - 2 * capH - gap) / 2);
      if (ih > maxIh) { ih = Math.max(60, maxIh); iw = Math.round(ih / 1.25); }
      const x = W - iw - (narrow ? 10 : 24 * uiK);
      const pr = renderer.getPixelRatio(), iwPx = Math.round(iw * pr), ihPx = Math.round(ih * pr);
      ann.setVisible(false);
      insets.forEach((it, i) => {
        const v = insetViews[i], eyeP = v.eye;
        it.rect = [x, top + i * (ih + capH + gap), iw, ih];
        insetCam.position.copy(eyeP);
        insetCam.up.copy(up);
        insetCam.lookAt(scr);
        insetCam.aspect = iw / ih;
        insetCam.fov = fitFov(eyeP, 0.8);
        insetCam.updateProjectionMatrix();
        insetCam.updateMatrixWorld();
        u.uEye.value.copy(eyeP).applyMatrix4(inv);
        lookYou.setHead(headOf(you, eyeYou), insetCam, v.hide === 'you' ? 1 : 0);
        if (eyeNb) lookNb.setHead(headOf(nb, eyeNb), insetCam, v.hide === 'nb' ? 1 : 0);
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, iw, ih);
        renderer.setViewport(0, 0, iw, ih);
        if (i > 0) renderer.shadowMap.autoUpdate = false;     // 阴影每帧只更新一次
        renderer.render(scene, insetCam);
        renderer.shadowMap.autoUpdate = true;
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, W, H);
        if (it.cv.width !== iwPx || it.cv.height !== ihPx) { it.cv.width = iwPx; it.cv.height = ihPx; }
        it.g.drawImage(renderer.domElement, 0, renderer.domElement.height - ihPx, iwPx, ihPx, 0, 0, iwPx, ihPx);
        const a = anglesOf(eyeP.clone().applyMatrix4(inv));
        const ev = model.evalAt(a.theta, a.psi);
        const html = `<b>${v.label}</b><span>亮度 <b>${Math.round(ev.yRatio * 100)}%</b> · 色偏 <b>${ev.jncd.toFixed(1)}</b> · ${a.theta.toFixed(0)}°</span>`;
        if (it.cap.dataset.html !== html) { it.cap.innerHTML = html; it.cap.dataset.html = html; }
      });
      u.uEye.value.copy(mainEye).applyMatrix4(inv);
    }
    lookYou.setHead(headOf(you, eyeYou), rig.camera, mainViewer === 'you' || switching ? camFade : 0);
    lookNb.setHead(eyeNb ? headOf(nb, eyeNb) : eyeYou, rig.camera, mainViewer === 'nb' || switching ? camFade : 0);

    // 侧卧：讲解视角里标左眼（下）的三条视线，右眼（上）再画一条到屏幕中心
    const annEye = eyesLR ? eyesLR[0] : mainEye;
    const probes = ann.update(annEye, phoneM, phone.half, model, eyesLR ? { eye: eyesLR[1], name: '右眼' } : otherEye ? { eye: otherEye, name: mainViewer === 'nb' ? '你' : '旁人' } : null);
    // 标注：过渡中、拖动中显示；结束后保留一会儿淡出。回到讲解视角时重新显示一会儿
    const dt = Math.min(100, now - lastFrame); lastFrame = now;
    const isExplain = rig.progress < 0.05;
    if (isExplain && !wasExplain) pokeAnn();
    wasExplain = isExplain;
    const annOn = !!trans || !!drag || !!paramTween || now < annUntil;
    annAlpha = THREE.MathUtils.clamp(annAlpha + (annOn ? 1 : -1) * dt / 450, 0, 1);
    ann.setOpacity(annAlpha);
    const annShow = isExplain && annAlpha > 0.005;
    ann.setVisible(annShow);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    if (!covered) renderer.render(scene, rig.camera);
    ann.layout(rig.camera, annEye, phoneM, phone.half, W, H);

    // 数据面板（打开时才算）
    if (data.visible) {
      const ps = hasPrivacy() ? [...profilesOf(device)].sort((a, b) => Number(a.privacy) - Number(b.privacy)) : [profile];
      const film = privacyKind() === 'film';
      const panelProfiles: PanelProfile[] = ps.map((p) => ({
        id: p.id, label: p.privacy ? (film ? '贴防窥膜' : '防窥开启') : (film ? '未贴膜' : '防窥关闭'),
        model: modelOf(p).model, lut: modelOf(p).lut, active: p.id === profile.id,
      }));
      const am = anglesOf(mainEye.clone().applyMatrix4(inv));
      const eyes = [{ ...am, who: sub ? (mainViewer === 'nb' ? '旁人' : '你') : '眼睛' }];
      if (otherEye && !stereoOn) eyes.push({ ...anglesOf(otherEye.clone().applyMatrix4(inv)), who: mainViewer === 'nb' ? '你' : '旁人' });
      if (stereoOn && stereo.reads) eyes.splice(0, 1, ...stereo.reads.map((r, i) => ({ ...anglesOf(r.eye.clone().applyMatrix4(inv)), who: i ? '右眼' : '左眼' })));
      else if (eyesLR) eyes.splice(0, 1, ...eyesLR.map((e, i) => ({ ...anglesOf(e.clone().applyMatrix4(inv)), who: i ? '右眼' : '左眼' })));
      data.update(panelProfiles, eyes, JMAX, device.name);
    }

    // 地铁场景的两个小窗：画面在主画面之前渲染（见上），这里只更新位置、淡入淡出
    insetAlpha = THREE.MathUtils.clamp(insetAlpha + ((insetOn ? 1 : 0) - insetAlpha) * Math.min(1, dt / 220), 0, 1);
    for (const it of insets) {
      if (insetAlpha > 0.01) Object.assign(it.el.style, { display: 'block', opacity: String(insetAlpha), left: it.rect[0] + 'px', top: it.rect[1] + 'px', width: it.rect[2] + 'px', height: it.rect[3] + 'px' });
      else it.el.style.display = 'none';
    }

    // 读数（主观看者，屏幕中心）
    const c = probes[1];
    $('theta').textContent = `${c.theta.toFixed(0)}°`;
    $('where').textContent = sub ? `${mainViewer === 'nb' ? '旁人' : '你'}看屏幕中心的离轴角` : '屏幕中心离轴角';
    $('deK').textContent = 'ΔE2000';
    $('scene').textContent = rig.mode === 'eye' ? (sub ? `${mainViewer === 'nb' ? '旁人' : '你'}看到的屏幕` : `${preset.name} · 眼睛看到的屏幕`) : preset.name;
    $('lum').textContent = `${Math.round(c.ev.yRatio * 100)}%`;
    $('jncd').textContent = c.ev.jncd.toFixed(1);
    $('de').textContent = c.ev.de00.toFixed(1);
    $('warn').textContent = c.ev.clamped ? '超出实测范围（> 70°），按 70° 计' : '';
    if (eyesLR) {     // 侧卧：两只眼睛分别的读数，ΔE2000 为两眼之间的色差
      const r = eyesLR.map((e) => { const a = anglesOf(e.clone().applyMatrix4(inv)); return { theta: a.theta, ev: model.evalAt(a.theta, a.psi) }; });
      $('theta').textContent = `${r[0].theta.toFixed(0)}° / ${r[1].theta.toFixed(0)}°`;
      $('where').textContent = '左眼（下）/ 右眼（上）离轴角';
      $('lum').textContent = `${Math.round(r[0].ev.yRatio * 100)}% / ${Math.round(r[1].ev.yRatio * 100)}%`;
      $('jncd').textContent = `${r[0].ev.jncd.toFixed(1)} / ${r[1].ev.jncd.toFixed(1)}`;
      $('deK').textContent = '两眼 ΔE2000';
      $('de').textContent = deltaE2000(xyzToLab(r[0].ev.W, model.ref.W), xyzToLab(r[1].ev.W, model.ref.W)).toFixed(1);
      $('warn').textContent = r.some((x) => x.ev.clamped) ? '超出实测范围（> 70°），按 70° 计' : '';
    }
    if (++frames === 2) readyResolve();
  };
  renderer.setAnimationLoop(frame);

  return {
    ready, renderer, scene, rig,
    get state() { return state; },
    get eye() { return eyeWorld(you); },
    /** 调试：人物（骨骼、姿势） */
    get you() { return you; },
    get phoneMatrix() { return phoneM.clone(); },
    setScene(id: string, animate = true) { const p = PRESETS.find((q) => q.id === id); if (p) goto(p, animate); },
    setView, setViewer, setPattern,
    setPrivacy(on: boolean) { privacy = on; syncDeviceUI(); useProfile(); },
    setDevice(id: string) { return setDevice(id); },
    get phoneSource() { return phone.source; },
    setData,
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
    /** 双眼视差：开始 / 退出、把自动播放停在 ms 处、切换并排 / 叠加 / 交替 */
    stereoStart() { pickView('stereo'); },
    stereoStop() { stereo.stop(); },
    stereoSeek(ms: number) { stereo.seek(ms); },
    stereoLayout(l: StereoLayout) { stereo.setLayout(l); },
    get stereoReads() { return stereo.reads; },
    get stereoBusy() { return stereo.busy; },
    /** 演示序列：播放 / 停止 / 替换步骤；settled 表示所有动画都已结束 */
    player,
    get steps() { return steps(); },
    timeline: tl,
    get settled() { return !trans && !rig.busy && !eyeSwitch && !stereo.busy && !paramTween && !swapping; },
    get params() { return { ...params[preset.id] }; },
    get viewMode() { return stereo.active && !stereo.leaving ? 'stereo' : rig.mode; },
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
