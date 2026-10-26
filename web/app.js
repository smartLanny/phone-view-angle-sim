(function () {
  'use strict';

  const DATA = window.ANG_DATA;
  const SPECS = window.DEVICE_SPECS;
  const $ = (id) => document.getElementById(id);
  const DEG = Math.PI / 180;
  const SERIES = ['#3987e5', '#d95926'];   // 对比时左 / 右两台的标识色（dataviz 参考调色板，深色底）

  // 外观按机型名前缀匹配，同一机型不同屏幕供应商（如 “iPhone 18 Pro Max GH3”）共用外观
  const KNOWN = Object.keys(SPECS);
  const specKey = (device) => KNOWN.filter((k) => device === k || device.startsWith(k + ' '))
    .sort((a, b) => b.length - a.length)[0];
  const specOf = (device) => SPECS[specKey(device) || KNOWN[0]];
  const rank = (device) => { const i = KNOWN.indexOf(specKey(device)); return i < 0 ? KNOWN.length : i; };

  // Duo 数据后续会更新：界面（含三维场景）暂不显示“低精度 / 临时替代”等来源说明，数据文件本身不改
  for (const k of ['inner', 'outer']) {
    const d = window.DUO_DATA?.[k];
    if (!d) continue;
    delete d.sourceNote;
    if (d.measurement) delete d.measurement.temporary;
  }
  const DUO_PROFILES = ['inner', 'outer'].map((surface) => Object.assign(
    { sets: null }, window.DUO_DATA[surface] || {},
    { id: `duo-${surface}`, device: 'iPhone Duo', surface, privacy: false },
  ));
  const DUO_NOTE = DUO_PROFILES.filter((p) => !p.sets).map((p) => (p.surface === 'outer' ? '外屏' : '内屏') + '数据待测').join('；');
  const PROFILES = [...DATA.profiles, ...DUO_PROFILES];
  const DEVICES = [...new Set(PROFILES.map((p) => p.device))].sort((a, b) => rank(a) - rank(b));
  const byId = (id) => PROFILES.find((p) => p.id === id);
  const variant = (device, privacy) => PROFILES.find((p) => p.device === device && p.privacy === privacy);
  const hasPrivacy = (device) => !!variant(device, true) && !!variant(device, false);
  const pick = (device) => variant(device, false) || variant(device, true);
  const shortName = (device) => device.match(/^iPhone (?:\d+|Duo)/)?.[0] || device.split(' ')[0];
  const surfaceName = (surface) => surface === 'outer' ? '外屏' : '内屏';
  /** 图例用短名：“小米 · 防窥关闭”“iPhone GH3 · 未贴膜”。 */
  function shortLabel(p) {
    const k = specKey(p.device) || p.device, suffix = p.device.slice(k.length).trim();
    const name = [shortName(p.device), suffix, p.surface ? surfaceName(p.surface) : ''].filter(Boolean).join(' ');
    return hasPrivacy(p.device) ? `${name} · ${privacyText(p.device)[p.privacy ? 'on' : 'off']}` : name;
  }

  const S = {
    dist: 300, tilt: [0, 0], theta: 0, psi: 0, rot: 0, mode: 0, pattern: 'ui', colors: {},
    compare: false, device: DEVICES.includes('iPhone Duo') ? 'iPhone Duo' : DEVICES[0], privacy: false,   // 默认打开 iPhone Duo
    fold: 180, duoSurface: 'inner',
    stereo: false, cross: false, ipd: 63, gap: 8, size: 1,
    slots: DEVICES.length > 1
      ? [pick(DEVICES[0]).id, pick(DEVICES[1]).id]
      : [PROFILES[0].id, (PROFILES[1] || PROFILES[0]).id],
    padMetric: 'lum', pal: 'jet', tab: 'view', clean: false, sweep: null,
  };

  let surfaceMix=0;

  // 缺失方位用上下镜像补全（见 model.js 'vmirror'）
  const models = {};
  const getModel = (id) => !byId(id).sets ? null : models[id] ||
    (models[id] = AngleModel.createModel({ angles: DATA.angles, sets: byId(id).sets }, { fill: 'vmirror' }));
  const MAX_TILT = getModel(PROFILES[0].id).thetaMax;
  let image = null;

  /** 查找表（θ 1° × ψ 1°），渲染与方向盘热力图共用。 */
  const luts = {};
  const getLUT = (id) => luts[id] || (luts[id] = getModel(id).buildLUT());

  /** 方向盘 / 曲线用的白场网格：亮度比与 JNCD，双线性插值。 */
  const grids = {};
  function getGrid(id) {
    if (grids[id]) return grids[id];
    const m = getModel(id);
    if (!m) return null;
    const lut = getLUT(id), w = lut.width;
    const refW = m.ref.W, refUV = m.uvPrime(refW);
    const lum = new Float32Array(w * 360), jn = new Float32Array(w * 360);
    for (let psi = 0; psi < 360; psi++) {
      for (let th = 0; th < w; th++) {
        const o = (((3 * 360) + psi) * w + th) * 4;
        const W = [lut.data[o], lut.data[o + 1], lut.data[o + 2]];
        const uv = m.uvPrime(W);
        lum[psi * w + th] = W[1] / refW[1];
        jn[psi * w + th] = Math.hypot(uv[0] - refUV[0], uv[1] - refUV[1]) / AngleModel.JNCD;
      }
    }
    const sample = (arr) => (theta, psi) => {
      const x = Math.min(Math.max(theta, 0), w - 1), x0 = Math.min(Math.floor(x), w - 2), fx = x - x0;
      const y = AngleModel.norm360(psi), y0 = Math.floor(y) % 360, y1 = (y0 + 1) % 360, fy = y - Math.floor(y);
      const a = arr[y0 * w + x0], b = arr[y0 * w + x0 + 1], c = arr[y1 * w + x0], d = arr[y1 * w + x0 + 1];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
    return (grids[id] = { lum: sample(lum), jncd: sample(jn) });
  }

  // 全部数据里的最大色偏 / 亮度（粗扫），用来固定方向盘和曲线的量程，切换机型时刻度不跳
  const RANGE = (() => {
    let j = 0, l = 1;
    for (const p of PROFILES) {
      const m = getModel(p.id);
      if (!m) continue;
      for (let th = 5; th <= m.thetaMax; th += 5) {
        for (let psi = 0; psi < 360; psi += 15) {
          const e = m.evalAt(th, psi);
          j = Math.max(j, e.jncd); l = Math.max(l, e.yRatio);
        }
      }
    }
    return { jncd: j, lum: l };
  })();
  const JMAX = (() => { const s = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40]; return s.find((v) => v >= RANGE.jncd) || Math.ceil(RANGE.jncd); })();

  const PRIVACY_TEXT = {
    mode: { switch: '防窥模式', on: '防窥开启', off: '防窥关闭', hint: '系统防窥开 / 关各一组实测', short: '防窥' },
    film: { switch: '贴防窥膜', on: '贴防窥膜', off: '未贴膜', hint: '贴膜前 / 后各一组实测', short: '贴膜' },
  };
  const privacyText = (device) => PRIVACY_TEXT[(variant(device, true) || {}).privacyKind] || PRIVACY_TEXT.mode;
  function profileLabel(p, withDevice = DEVICES.length > 1) {
    if (p.surface) return `${withDevice ? p.device + ' · ' : ''}${surfaceName(p.surface)}${p.sets ? '' : '（待测）'}`;
    if (!hasPrivacy(p.device)) return p.device;
    const t = privacyText(p.device), mode = p.privacy ? t.on : t.off;
    return withDevice ? `${p.device} · ${mode}` : mode;
  }
  function activeIds() {
    if (S.compare) return S.slots;
    if (S.device === 'iPhone Duo') return [`duo-${S.duoSurface}`];
    const p = variant(S.device, S.privacy) || variant(S.device, !S.privacy);
    return [p.id];
  }
  const activeDevices = () => [...new Set(activeIds().map((id) => byId(id).device))];
  const hasDuo = () => activeDevices().includes('iPhone Duo');
  const devForProfile = (id) => dev(byId(id).device, byId(id).surface);
  function colorOf(device) {
    const cs = specOf(device).colors;
    return cs.find((c) => c.id === S.colors[device]) || cs[0];
  }

  // ---------- 几何 ----------
  /** 每个机型的机身网格、屏幕尺寸与包围盒，按需构建并缓存。 */
  const devCache = {};
  const pendingModels = new Set();
  const failedModels = new Set();
  function dropDev(key) {
    const d = devCache[key];
    d.body.dispose();
    d.screens.forEach((s) => s.screen.dispose());
    delete devCache[key];
  }
  /** 对比时 Duo 各按自己的屏幕摆姿态：外屏合上（0°）看，内屏展开（180°）看；单台时跟随折叠滑块。 */
  const foldFor = (surface) => (S.compare ? (surface === 'outer' ? 0 : 180) : S.fold);
  function dev(name, surface = S.duoSurface) {
    const duo = name === 'iPhone Duo', key = duo ? `${name}|${surface}` : name;
    const mix=duo&&!S.compare?surfaceMix:undefined;
    const fold = duo ? foldFor(surface) : S.fold;
    const variant = colorOf(name).variant || '';   // 原模型的颜色变体（如 Duo 的夜空色）
    if (devCache[key] && devCache[key].variant === variant && (!duo || (devCache[key].fold === fold && devCache[key].frameMix === mix))) return devCache[key];
    if (devCache[key]) dropDev(key);
    const spec = specOf(name);
    if (spec.model && !Phone3D.hasModel(spec.model) && !pendingModels.has(spec.model) && !failedModels.has(spec.model)) {
      pendingModels.add(spec.model);
      Phone3D.loadModel(spec.model).then(() => {
        for (const key of Object.keys(devCache)) if (devCache[key].spec.model === spec.model) dropDev(key);
        requestRender();
      }).catch((err) => {
        failedModels.add(spec.model);
        toast(err.message);
      }).finally(() => pendingModels.delete(spec.model));
    }
    const phone = duo ? Phone3D.buildDuo(fold, surface, mix, variant) : Phone3D.build(spec.body, spec.model, variant);
    const P = phone.spec, sc = duo ? spec.screens[surface] : spec.screen;
    const ratio = sc.resH / sc.resW;
    const w = (sc.diag * 25.4) / Math.sqrt(1 + ratio * ratio);
    const corners = phone.corners || [];
    if (!phone.corners) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, -P.T]) corners.push([sx * P.W / 2, sy * P.H / 2, z]);
    // Duo 的取景缩放按固定外形算：看内屏时始终按完全展开的尺寸，看外屏时按合上的尺寸，两者之间随朝向过渡。
    // 这样改变展开角度时画面缩放不变，屏幕不会因为外形变窄而被“拉近”。
    let fitCorners = null;
    if (duo) {
      const a = duoFit('inner'), b = duoFit('outer'), m = mix === undefined ? (surface === 'outer' ? 1 : 0) : mix;
      if (a && b) fitCorners = a.map((c, i) => c.map((v, k) => v * (1 - m) + b[i][k] * m));
    }
    const screens = duo ? phone.screens : [{ mesh: phone.screen, screenHalf: sc.half || [w / 2, (w * ratio) / 2], corner: sc.corner, cutout: spec.cutout, holes: sc.holes }];
    return (devCache[key] = {
      name, spec, corners, fitCorners, fold, surface, frameMix:mix, variant,
      screenHalf: sc.half || [w / 2, (w * ratio) / 2],
      body: meshVAO(bodyProg, phone.body, true),
      surfaceFrame: phone.surfaceFrame,
      screens: screens.map((s) => Object.assign({}, s, { screen: meshVAO(screenProg, s.mesh, false) })),
    });
  }
  const duoFitBox = {};
  function duoFit(surface) {
    if (!Phone3D.hasModel('iphoneduo')) return null;
    return duoFitBox[surface] || (duoFitBox[surface] = surface === 'outer' ? Phone3D.buildDuo(0, 'outer', 1).corners : Phone3D.buildDuo(180, 'inner', 0).corners);
  }
  function retryFailedModels() {
    for (const name of activeDevices()) {
      const model = specOf(name).model;
      if (!failedModels.delete(model)) continue;
      for (const key of Object.keys(devCache)) if (devCache[key].spec.model === model) dropDev(key);
    }
  }
  const dispMM = (d) => {
    const [w, h] = d.screenHalf;
    return S.rot === 90 ? [2 * h, 2 * w] : [2 * w, 2 * h];
  };

  /** 手机局部坐标（竖放，右/上/屏幕外）→ 世界坐标的旋转矩阵，行主序。锚点为屏幕中心。 */
  function modelMatrix(tilt = S.tilt) {
    const [tx, ty] = tilt;
    const mag = Math.hypot(tx, ty);
    let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (mag > 1e-6) {
      const kx = -ty / mag, ky = tx / mag, a = mag * DEG;
      const c = Math.cos(a), s = Math.sin(a), C = 1 - c;
      R = [c + kx * kx * C, kx * ky * C, ky * s, ky * kx * C, c + ky * ky * C, -kx * s, -ky * s, kx * s, c];
    }
    const z = -S.rot * DEG, cz = Math.cos(z), sz = Math.sin(z);
    const Z = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
    const M = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      M[r * 3 + c] = R[r * 3] * Z[c] + R[r * 3 + 1] * Z[3 + c] + R[r * 3 + 2] * Z[6 + c];
    }
    return M;
  }
  const apply = (M, v) => [0, 1, 2].map((r) => M[r * 3] * v[0] + M[r * 3 + 1] * v[1] + M[r * 3 + 2] * v[2]);
  const applyT = (M, v) => [0, 1, 2].map((c) => M[c] * v[0] + M[3 + c] * v[1] + M[6 + c] * v[2]);

  /** 局部方向向量 → 离轴角 θ 与方位角 ψ（手机坐标，0°=右，90°=上）。 */
  function anglesOf(d) {
    return {
      theta: Math.atan2(Math.hypot(d[0], d[1]), d[2]) / DEG,
      psi: AngleModel.norm360(Math.atan2(d[1], d[0]) / DEG),
    };
  }
  function anglesAt(eye, point, frame) {
    const d = eye.map((n, i) => n - point[i]);
    if (!frame) return anglesOf(d);
    const dot = (axis) => d.reduce((sum, n, i) => sum + n * axis[i], 0);
    return anglesOf([dot(frame.tangentU), dot(frame.tangentV), dot(frame.normal)]);
  }

  // 投影: 眼睛位于 (0,0,D)（双眼立体时为 (∓瞳距/2,0,D)）看向屏幕中心；缩放使手机始终完整可见。

  // 投影: 眼睛位于 (0,0,D)（双眼立体时为 (∓瞳距/2,0,D)）看向屏幕中心；缩放使手机始终完整可见。
  let views = [];
  /** 左右眼的世界坐标（mm）。 */
  const eyePos = (side) => [side * S.ipd / 2, 0, S.dist];

  /** 舞台可用区域：再在底部给悬浮的快捷切换条留出位置，快捷条水平居中于舞台。 */
  function stageRect() {
    const R = baseStageRect(), qb = $('quickbar');
    if (!qb.hidden) {
      const h = qb.offsetHeight || 44;
      qb.style.left = (R.x0 + R.x1) / 2 + 'px';
      qb.style.top = R.bottom - h + 'px';
      qb.style.maxWidth = Math.max(R.x1 - R.x0 - 16, 200) + 'px';
      R.bottom -= h + 10;
    }
    return R;
  }
  /** 舞台可用区域（去掉左右栏 / 底部抽屉 / 左上角读数）。 */
  function baseStageRect() {
    const W = canvas.clientWidth, H = canvas.clientHeight, L = document.body.dataset.layout;
    const rc = (id) => $(id).getBoundingClientRect();
    if (S.clean) return { x0: 0, x1: W, top: rc('hud').bottom + 8, bottom: H - 12 };
    // 单台时数据卡停靠在舞台右上角（各布局都是）；手机占满其下的区域
    const capBottom = capDocked() && $('cap0').style.display === 'block' ? rc('cap0').bottom : 0;
    if (L === 'wide') return { x0: rc('rail').right + 12, x1: rc('panel').left - 12, top: Math.max(20, capBottom + 8), bottom: H - 16 };
    const top = Math.max(rc('hud').bottom, capBottom) + (L === 'side' ? 8 : 6);
    if (L === 'side') return { x0: 0, x1: rc('panel').left - 8, top, bottom: H - 16 };
    return { x0: 0, x1: W, top, bottom: rc('panel').top - 6 };
  }
  /** 屏幕紧凑（手机竖屏，或手机横屏这类矮窗口）：手机按正对时放满。 */
  const compactStage = () => document.body.dataset.layout === 'sheet' || window.innerHeight < 520;
  /**
   * 单台时数据卡（亮度 / 色偏 / ΔE）不放在手机下方，而是停靠到舞台右上角、和左上角的角度读数同一行：
   * 横屏时顶部这一行本来就被读数占着，数据卡挪上去后手机可以多占一整张卡片的高度。对比 / 立体时仍跟在各自手机下方。
   */
  const capDocked = () => !S.compare && !S.stereo && !S.clean;

  /**
   * 每台手机一个区域（对比时左右并排），共用同一缩放以便公平对比。
   * 双眼立体时为同一台手机的左右眼两个区域，按高度撑满、中间间隙为 S.gap；交叉视时左右对调。
   */
  function computeViews(devs) {
    const n = devs.length;
    const boxCorners = devs.flatMap((d) => d.fitCorners || d.corners);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const R = stageRect();
    const sheet = document.body.dataset.layout === 'sheet';
    // 数据卡高度按上一帧实测（随布局 / 字号变化），首帧用估计值
    const capEl = $('cap0');
    const capH = capDocked() ? 0 : (capEl.offsetHeight || (S.stereo ? 86 : sheet ? 64 : 76)) + 14;
    const top = R.top;
    const avail = Math.max(R.bottom - capH - top, 140);
    const areaX0 = R.x0, areaW = Math.max(R.x1 - R.x0, 200);
    const sides = S.stereo ? (S.cross ? [1, -1] : [-1, 1]) : devs.map(() => 0);
    const gap = S.stereo ? S.gap : 0;
    const colMax = S.stereo ? (areaW - gap) / 2 : areaW / n;
    const halfW = colMax / 2 - (S.stereo ? 10 : sheet && n > 1 ? 6 : 16), halfH = avail / 2;
    const D = S.dist;
    const span = (mat) => {
      let mx = 0, my = 0;
      for (const c of boxCorners) {
        const w = apply(mat, c), depth = D - w[2];
        for (const s of sides) {
          const ex = s * S.ipd / 2;
          mx = Math.max(mx, Math.abs((w[0] - ex) / depth + ex / D));
        }
        my = Math.max(my, Math.abs(w[1] / depth));
      }
      return [mx, my];
    };
    const extent = (mat) => {
      const [mx, my] = span(mat);
      return Math.min(halfW / mx, halfH / my) * (S.stereo ? 0.97 : 0.92);
    };
    const z = -S.rot * DEG;
    const flat = [Math.cos(z), -Math.sin(z), 0, Math.sin(z), Math.cos(z), 0, 0, 0, 1];
    // 缩放只取决于距离与布局，不随当前姿态变化（拖动时手机和背景框不缩放）：
    // 取各偏转姿态包络；近距离大角度时包络会过小，此时允许少量超出、由裁剪处理。
    let fEnv = extent(flat);
    let [mxE, myE] = span(flat);
    for (let mag = 10; mag <= MAX_TILT; mag += 5) {
      for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8;
        const m = modelMatrix([mag * Math.cos(a), mag * Math.sin(a)]);
        const [mx, my] = span(m);
        mxE = Math.max(mxE, mx); myE = Math.max(myE, my);
        fEnv = Math.min(fEnv, extent(m));
      }
    }
    // 手机竖屏空间宝贵：以正对时放满为准，大角度时允许手机略微伸到上下栏下面
    let f = Math.max(fEnv, extent(flat) * (compactStage() ? 0.97 : 0.9));
    // 双眼立体：两幅图按全部偏转姿态的投影包络定宽，并排且中间只留 S.gap，
    // 任何角度都不裁切手机，拖动时框也不缩放
    let colW = colMax;
    if (S.stereo) {
      f = Math.min(halfW / mxE, halfH / myE) * S.size;
      colW = Math.min(colMax, 2 * mxE * f + 16);
    }
    const centers = S.stereo
      ? [areaX0 + areaW / 2 - (colW + gap) / 2, areaX0 + areaW / 2 + (colW + gap) / 2]
      : devs.map((_, i) => areaX0 + (i + 0.5) * colW);
    const envH = myE * f;
    const cy = top + halfH;
    const bottomY = Math.min(top + 2 * halfH, cy + envH + 8);
    const frameTop = S.stereo ? Math.max(top - 10, cy - envH - 10) : top;
    views = devs.map((d, i) => ({
      dev: d, W, H, f, D, w: colW, x0: centers[i] - colW / 2, x1: centers[i] + colW / 2,
      cx: centers[i], cy, top: frameTop, bottomY,
      eye: eyePos(sides[i]), side: sides[i],
    }));
    // 舞台聚光跟着手机走；提示文字居中于舞台
    document.documentElement.style.setProperty('--sx', ((areaX0 + areaW / 2) / W * 100).toFixed(1) + '%');
    $('hint').style.left = areaX0 + areaW / 2 + 'px';
    // 宽屏时右上角停着数据卡，操作提示挪到它下面，免得窄一些的窗口里两者重叠
    const capR = document.body.dataset.layout === 'wide' && capDocked() && $('cap0').style.display === 'block' ? $('cap0').getBoundingClientRect() : null;
    $('hint').style.top = capR ? capR.bottom + 6 + 'px' : '';
    return views;
  }
  // ---------- WebGL ----------
  const canvas = $('gl');
  const gl = canvas.getContext('webgl2', { antialias: true, depth: true });
  if (!gl) {
    document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;top:45%;width:100%;text-align:center;color:#ff6b6b">浏览器不支持 WebGL2，请使用新版 Chrome / Edge / Safari / Firefox。</p>');
    return;
  }

  // 相机位于 uEye，光轴平行于 −z；画面平移使屏幕中心（距离 uEyeD 处）落在视区中心，即零视差面。
  const COMMON_VS = `
  uniform mat3 uModel;
  uniform float uEyeD;
  uniform vec3 uEye;
  uniform vec2 uScale, uCenter, uDepth;
  vec4 project(vec3 w) {
    float depth = uEyeD - w.z;
    return vec4((w.xy - uEye.xy) * uScale + (uCenter + uEye.xy * uScale / uEyeD) * depth, uDepth.x * depth - uDepth.y, depth);
  }`;

  const COLOR_GLSL = `
  vec3 srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec3 lin2srgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }`;

  const ENV_GLSL = `
  // ---- 摄影棚环境：机身着色用；屏幕只在内屏磨砂膜、屏下摄像头的表面反射里用到，显示内容本身不受影响 ----
  // 上亮下暗的影棚底色 + 几盏有尺寸的柔光灯：左上前方大柔光箱（主光）、右侧竖灯条、左后轮廓光、顶灯、正前方补光。
  // 粗糙度越高，灯在反射里越宽越柔、亮度相应摊薄，金属中框得到连续的明暗渐变，磨砂背板呈缎面质感。
  // 影棚整体偏亮（天花板、地平线都有一定亮度），抛光金属大部分角度都能映出亮面，读起来是银色而不是黑色。
  vec3 studio(vec3 d) {
    vec3 floorC = vec3(0.016, 0.017, 0.019), horizon = vec3(0.105, 0.108, 0.116), ceilC = vec3(0.36, 0.365, 0.38);
    return d.y < 0.0 ? mix(horizon, floorC, smoothstep(0.0, -0.55, d.y)) : mix(horizon, ceilC, smoothstep(0.0, 0.85, d.y));
  }
  const int NL = 5;
  vec3 LD[NL] = vec3[NL](normalize(vec3(-0.45, 0.72, 0.53)), normalize(vec3(0.97, 0.08, 0.22)), normalize(vec3(-0.90, 0.22, -0.38)),
                         normalize(vec3(0.10, 1.0, -0.05)), normalize(vec3(0.0, 0.12, 1.0)));
  float LR[NL] = float[NL](0.50, 0.15, 0.18, 0.34, 0.60);   // 灯的角半径（弧度）
  float LI[NL] = float[NL](3.0, 2.8, 1.9, 1.2, 0.55);
  vec3 envSpec(vec3 r, float rough) {
    vec3 c = studio(r);
    float blur = 0.015 + rough * rough * 1.1;
    for (int i = 0; i < NL; i++) {
      vec3 L = LD[i];
      float cl = dot(r, L);
      if (cl < 0.0) continue;                        // 背向这盏灯
      float ang = sqrt(max(2.0 * (1.0 - cl), 0.0)); // 小角度近似 acos，省去反三角函数
      // 竖灯条：在水平方向收窄
      if (i == 1) { vec3 q = r - L * cl; ang = length(vec2(dot(q, normalize(cross(L, vec3(0.0, 1.0, 0.0)))) * 2.6, q.y)); }
      float rad = LR[i];
      float lobe = 1.0 - smoothstep(rad - blur * 0.35, rad + blur, ang);
      c += vec3(LI[i]) * lobe * (rad * rad) / ((rad + blur * 0.6) * (rad + blur * 0.6));
    }
    return c;
  }
  vec3 irradiance(vec3 n) {
    vec3 c = mix(vec3(0.035, 0.036, 0.040), vec3(0.27, 0.275, 0.29), n.y * 0.5 + 0.5);
    for (int i = 0; i < NL; i++) c += LI[i] * LR[i] * LR[i] * 0.55 * max(dot(n, LD[i]), 0.0);
    return c;
  }
  // 分离求和近似（Karis）
  vec3 envBRDF(vec3 F0, float r, float nv) {
    vec4 rr = r * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
    float a004 = min(rr.x * rr.x, exp2(-9.28 * nv)) * rr.x + rr.y;
    vec2 AB = vec2(-1.04, 1.04) * a004 + rr.zw;
    return F0 * AB.x + AB.y;
  }
  `;

  const BODY_VS = `#version 300 es
  in vec3 aPos;
  in vec3 aNor;
  in float aMat;
  in vec2 aUv;
  in vec2 aUv1;
  in vec4 aTexL;
  in vec3 aTint;
  in vec4 aFinish;
  out vec3 vN;
  out vec3 vW;
  out vec2 vUv;
  out vec2 vUv1;
  out vec3 vTint;
  out vec4 vFinish;
  flat out int vMat;
  flat out vec4 vTexL;
  ${COMMON_VS}
  void main() {
    vW = uModel * aPos;
    vN = uModel * aNor;
    vMat = int(aMat + 0.5);
    vUv = aUv;
    vUv1 = aUv1;
    vTexL = aTexL;
    vTint = aTint;
    vFinish = aFinish;
    gl_Position = project(vW);
  }`;

  const BODY_FS = `#version 300 es
  precision highp float;
  in vec3 vN;
  in vec3 vW;
  in vec2 vUv;
  in vec2 vUv1;
  in vec3 vTint;
  in vec4 vFinish;   // 金属度、粗糙度、不透明度、清漆
  flat in int vMat;
  flat in vec4 vTexL;  // 模型贴图槽（底色、金属度粗糙度、法线、环境光遮蔽）：层号 × 4 + 纹理坐标组 + 2 × 双姿态 AO，−1 为无贴图
  uniform mediump sampler2DArray uTexBC, uTexMR, uTexN, uTexAO;
  uniform float uClosed;   // Duo 合上程度（0 展开 … 1 合上），在展开 / 合上两张 AO 之间混合
  out vec4 outColor;
  uniform vec3 uEye;
  uniform vec3 uFrame, uBack;
  uniform float uRough;
  uniform sampler2D uBackTex;
  uniform bool uUseBackTex;
  uniform bool uNative;
  uniform int uPass;   // 0 不透明，1 透明（镜头盖玻璃等，预乘 alpha 叠加）
  ${COLOR_GLSL}

  ${ENV_GLSL}
  // 通用材质：底色、金属度、粗糙度、清漆（透明保护层的 4% 反射）
  vec3 shade(vec3 N, vec3 V, vec3 base, float metal, float rough, float coat) {
    float nv = clamp(dot(N, V), 1e-3, 1.0);
    vec3 R = reflect(-V, N);
    rough = clamp(rough, 0.03, 1.0);
    vec3 F0 = mix(vec3(0.04), base, metal), diff = base * (1.0 - metal);
    vec3 col = diff * irradiance(N) + envBRDF(F0, rough, nv) * envSpec(R, rough);
    if (coat > 0.0) {
      vec3 Fc = envBRDF(vec3(0.04), 0.06, nv) * coat;
      col = col * (1.0 - Fc) + Fc * envSpec(R, 0.06);
    }
    return col;
  }
  // 主光在左上方：机身上离主光越远越暗一点，大平面（背板）上出现柔和的明暗过渡，不再是一整片平涂
  float falloff() { return clamp(1.0 + dot(vW.xy, vec2(-0.0011, 0.0015)), 0.82, 1.18); }
  // 胶片式色调映射（ACES 近似），高光柔和滚降
  vec3 tone(vec3 x) {
    x *= 1.05;
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  // 贴图槽 → 纹理数组坐标（层号 + 所用的那组纹理坐标）
  vec3 slot(float s) { float l = floor(s * 0.25), r = s - l * 4.0; return vec3(mod(r, 2.0) > 0.5 ? vUv1 : vUv, l); }
  // 没有切线数据：用屏幕空间导数现场构造切线坐标系（余切框架），把切线空间法线转到世界空间
  vec3 perturb(vec3 N, vec3 dp1, vec3 dp2, vec2 du1, vec2 du2, vec3 tn) {
    vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
    vec3 T = dp2p * du1.x + dp1p * du2.x;
    vec3 B = dp2p * du1.y + dp1p * du2.y;
    float m = max(dot(T, T), dot(B, B));
    if (m < 1e-24) return N;
    float k = inversesqrt(m);
    // glTF 法线贴图的 +Y 指向贴图上方，也就是纹理坐标 v 减小的方向
    return normalize(T * (k * tn.x) - B * (k * tn.y) + N * tn.z);
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(uEye - vW);
    if (dot(N, V) < 0.0) N = -N;   // 双面材质
    float nv = clamp(dot(N, V), 0.0, 1.0);
    if (uNative) {
      float op = vFinish.z;
      if ((uPass == 0) != (op >= 0.99)) discard;
      vec3 base = vTint;
      float metal = clamp(vFinish.x, 0.0, 1.0), rough = vFinish.y, coat = vFinish.w;
      // 模型自带贴图逐像素采样：底色（含透明度）、G = 粗糙度 / B = 金属度、法线
      vec3 dp1 = dFdx(vW), dp2 = dFdy(vW);
      if (vTexL.x >= 0.0) { vec4 t = texture(uTexBC, slot(vTexL.x)); base *= t.rgb; op *= t.a; }
      if (vTexL.y >= 0.0) { vec4 t = texture(uTexMR, slot(vTexL.y)); rough *= t.g; metal = clamp(metal * t.b, 0.0, 1.0); }
      // 环境光遮蔽：缝隙、按键边、镜头圈、扬声器网等处压暗环境光（本渲染器的光照全部来自环境，漫反射与反射一起乘）
      float ao = 1.0;
      if (vTexL.w >= 0.0) {
        vec4 t = texture(uTexAO, slot(vTexL.w));
        ao = vTexL.w - floor(vTexL.w * 0.25) * 4.0 > 1.5 ? mix(t.r, t.g, uClosed) : t.r;
      }
      if (vTexL.z >= 0.0) {
        vec3 c = slot(vTexL.z);
        vec3 tn = texture(uTexN, c).xyz * 2.0 - 1.0;
        N = perturb(N, dp1, dp2, dFdx(c.xy), dFdy(c.xy), tn);
        if (dot(N, V) < 0.02) N = normalize(N + V * (0.02 - dot(N, V)));
        nv = clamp(dot(N, V), 0.0, 1.0);
      }
      if (uPass == 0) {
        outColor = vec4(lin2srgb(tone(shade(N, V, base, metal, rough, coat) * (ao * falloff()))), 1.0);
        return;
      }
      // 透明玻璃：本体按不透明度着色，表面反射直接叠加（预乘 alpha）
      vec3 R = reflect(-V, N);
      float r = clamp(min(rough, 0.25), 0.02, 1.0);
      vec3 spec = envBRDF(vec3(0.04), r, max(nv, 1e-3)) * envSpec(R, r) * ao;
      vec3 body = base * (1.0 - metal) * irradiance(N) * op * ao;
      vec3 c = tone(body + spec);
      float a = clamp(op + dot(spec, vec3(0.3)), 0.0, 1.0);
      outColor = vec4(lin2srgb(c), a);
      return;
    }
    if (uPass != 0) discard;
    vec3 col;
    if (uUseBackTex && (vMat == 1 || vMat == 2)) {
      // 背板照片：作为磨砂玻璃下的底色，再加一层玻璃的柔和反射
      vec4 photo = texture(uBackTex, vUv);
      vec3 base = srgb2lin(photo.rgb);
      vec3 lit = base * (0.55 + 0.6 * irradiance(N)) ;
      col = mix(uBack * 0.4, lit, photo.a) + envBRDF(vec3(0.04), 0.4, max(nv, 1e-3)) * envSpec(reflect(-V, N), 0.4) * 0.6;
    } else if (vMat == 0 || vMat == 3) {
      // 中框 / 按键：喷砂（或抛光）金属，带一层薄氧化膜
      col = shade(N, V, uFrame, 1.0, uRough * 0.85, 0.3);
    } else if (vMat == 1) {
      // 背板磨砂玻璃：缎面，宽而柔的高光
      col = shade(N, V, uBack, 0.0, max(uRough, 0.45), 0.0);
    } else {
      // 相机模组玻璃 / 镜头：深色镜面玻璃，反射清晰
      col = shade(N, V, vec3(0.006), 0.0, 0.04, 1.0);
    }
    outColor = vec4(lin2srgb(tone(col * falloff())), 1.0);
  }`;

  const SCREEN_VS = `#version 300 es
  in vec3 aPos;
  in vec2 aLocal;
  in vec3 aNor;
  in vec3 aTangent;
  out vec2 vLocal;
  out vec3 vWorld;
  out vec3 vNormal;
  out vec3 vTangent;
  ${COMMON_VS}
  void main() {
    vLocal = aLocal;
    vWorld = uModel * aPos;
    vNormal = aNor;
    vTangent = aTangent;
    gl_Position = project(vWorld);
  }`;

  const SCREEN_FS = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;
  in vec2 vLocal;
  in vec3 vWorld;
  in vec3 vNormal;
  in vec3 vTangent;
  out vec4 outColor;

  uniform sampler2D uImg;
  uniform sampler2D uLut;
  uniform int uLutW;
  uniform mat3 uModel;
  uniform vec3 uEye;
  uniform vec2 uScreenHalf, uDispMM, uImgScale;
  uniform vec3 uCut;
  uniform vec3 uHole0, uHole1, uHole2;
  uniform float uCorner, uRot;
  uniform int uMode;
  uniform sampler2D uPal;   // 256×1 色表（热力图配色，与方向盘一致）
  uniform int uBands;       // >0 时分级显示
  uniform bool uPalFlip;
  uniform float uMatte;     // 防眩光磨砂膜（Duo 内屏）：1 = 有；0 = 普通镜面玻璃屏，不画表面反射
  uniform vec3 uUdc;        // 屏下摄像头：中心（屏幕局部坐标，毫米）和半径；半径 0 为没有
  uniform bool uModelHoles; // 开孔里有模型自带的镜头几何：屏幕在孔内透空，直接露出模型
  ${COLOR_GLSL}
  ${ENV_GLSL}


  vec3 lut(int blk, float th, float ps) {
    float x = clamp(th, 0.0, float(uLutW - 1));
    int x0 = min(int(floor(x)), uLutW - 2);
    float fx = x - float(x0);
    float y = mod(ps, 360.0);
    int y0 = min(int(floor(y)), 359);
    int y1 = (y0 + 1) % 360;
    float fy = y - float(y0);
    int off = blk * 360;
    vec3 a = texelFetch(uLut, ivec2(x0, off + y0), 0).rgb;
    vec3 b = texelFetch(uLut, ivec2(x0 + 1, off + y0), 0).rgb;
    vec3 c = texelFetch(uLut, ivec2(x0, off + y1), 0).rgb;
    vec3 d = texelFetch(uLut, ivec2(x0 + 1, off + y1), 0).rgb;
    return mix(mix(a, b, fx), mix(c, d, fx), fy);
  }

  float isoLine(float v, float stepv) {
    float f = v / stepv;
    float w = max(fwidth(f), 1e-6);
    return 1.0 - smoothstep(0.0, w * 1.3, abs(fract(f + 0.5) - 0.5));
  }

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  // 前摄开孔里的小镜头（只影响开孔内的像素，屏幕显示不变）：深色镀膜镜片 + 金属压圈 + 盖板玻璃反射的高光，
  // 高光随观看方向在镜片上移动，看起来是一小块镜面而不是平涂的黑点。返回 sRGB。
  vec3 lens(vec2 p, vec3 hole, vec3 vd) {
    float r = length(p - hole.xy) / hole.z;
    vec3 c = vec3(0.0012, 0.0014, 0.0022);
    c += vec3(0.0035, 0.0045, 0.012) * (1.0 - smoothstep(0.0, 0.62, r));                 // 镜片镀膜的蓝紫底色
    c += vec3(0.010) * (1.0 - smoothstep(0.0, 0.035, abs(r - 0.42)));                    // 内圈镜片边
    c += vec3(0.020, 0.019, 0.018) * smoothstep(0.66, 0.70, r) * (1.0 - smoothstep(0.80, 0.86, r));   // 压圈
    vec2 off = -vd.xy / max(vd.z, 0.25) * 0.22 + vec2(-0.22, 0.26);
    float hl = exp(-pow(length((p - hole.xy) / hole.z - off) / 0.16, 2.0));
    float hl2 = exp(-pow(length((p - hole.xy) / hole.z - off * vec2(-0.6, -0.5)) / 0.08, 2.0));
    float rim = pow(1.0 - clamp(vd.z, 0.0, 1.0), 3.0) * smoothstep(0.55, 0.95, r);
    c += vec3(0.55, 0.57, 0.62) * hl + vec3(0.12, 0.10, 0.16) * hl2 + vec3(0.05) * rim;
    return lin2srgb(c);
  }

  float aperture(vec2 p, vec3 hole, float px) {
    if (hole.z <= 0.0) return 0.0;
    return 1.0 - smoothstep(hole.z - px, hole.z + px, length(p - hole.xy));
  }

  void main() {
    vec2 pp = vLocal;
    float px = length(fwidth(pp));
    float screen = 1.0 - smoothstep(-px, 0.0, sdRoundBox(pp, uScreenHalf, uCorner));

    vec3 d = transpose(uModel) * (uEye - vWorld);
    vec3 n = normalize(vNormal), t = normalize(vTangent);
    vec3 b = normalize(cross(n, t));
    d = vec3(dot(d, t), dot(d, b), dot(d, n));
    if (d.z <= 0.0) discard;
    float th = degrees(atan(length(d.xy), d.z));
    float ps = degrees(atan(d.y, d.x));
    if (ps < 0.0) ps += 360.0;

    float a = radians(-uRot);
    vec2 disp = mat2(cos(a), sin(a), -sin(a), cos(a)) * pp;
    vec2 iuv = (disp / uDispMM) * uImgScale + 0.5;
    bool inImg = all(greaterThanEqual(iuv, vec2(0.0))) && all(lessThanEqual(iuv, vec2(1.0)));
    vec3 lin = inImg ? srgb2lin(texture(uImg, iuv).rgb) : vec3(0.0);

    vec3 scr;
    if (uMode == 2) {
      float t = clamp(th / 70.0, 0.0, 1.0);
      if (uBands > 0) t = (min(floor(t * float(uBands)), float(uBands - 1)) + 0.5) / float(uBands);
      if (uPalFlip) t = 1.0 - t;
      scr = texture(uPal, vec2(t, 0.5)).rgb;
      vec3 iso = dot(scr, vec3(0.2126, 0.7152, 0.0722)) > 0.4 ? vec3(0.0) : vec3(1.0);
      scr = mix(scr, iso, 0.6 * isoLine(th, 10.0));
    } else if (uMode == 1) {
      scr = lin2srgb(lin);
    } else {
      vec3 sim = vec3(dot(lut(0, th, ps), lin), dot(lut(1, th, ps), lin), dot(lut(2, th, ps), lin));
      scr = lin2srgb(sim);
    }
    vec2 q = pp - vec2(0.0, uScreenHalf.y - uCut.x);
    q.x = max(abs(q.x) - uCut.y, 0.0);
    vec3 vd = normalize(d);
    if (uCut.z > 0.0) {
      float inCut = 1.0 - smoothstep(uCut.z, uCut.z + px, length(q));
      // 圆形开孔（挖孔前摄）画成小镜头；胶囊形（灵动岛）保持纯黑
      vec3 cutCol = uCut.y < 0.01 ? lens(pp, vec3(0.0, uScreenHalf.y - uCut.x, uCut.z), vd) : vec3(0.0);
      scr = mix(scr, cutCol, inCut);
    }
    float h0 = aperture(pp, uHole0, px), h1 = aperture(pp, uHole1, px), h2 = aperture(pp, uHole2, px);
    if (uModelHoles && max(h0, max(h1, h2)) > 0.5) discard;
    if (h0 > 0.0) scr = mix(scr, lens(pp, uHole0, vd), h0);
    if (h1 > 0.0) scr = mix(scr, lens(pp, uHole1, vd), h1);
    if (h2 > 0.0) scr = mix(scr, lens(pp, uHole2, vd), h2);
    vec3 col = mix(vec3(0.004), scr, screen);

    // 表面反射只加在 Duo 内屏上（显示内容按实测着色，这里只在其上叠加盖板表面反射的环境光）：
    // 防眩光磨砂膜把影棚灯光打散成一片柔和的雾光；右半屏靠上的屏下摄像头圆片没有磨砂，是一小块镜面，
    // 灯光倒影清晰但整体反射更弱，所以多数角度下是一个略深的小圆点，转到对着灯时才亮起一下。
    if (uMatte > 0.0) {
      vec3 Nw = normalize(uModel * vNormal), V = normalize(uEye - vWorld);
      float nv = clamp(dot(Nw, V), 1e-3, 1.0);
      vec3 R = reflect(-V, Nw);
      float udc = uUdc.z > 0.0 ? 1.0 - smoothstep(uUdc.z - px, uUdc.z + px, length(pp - uUdc.xy)) : 0.0;
      // 参数与苹果官网 AR 模型内屏材质一致：清漆层在磨砂区强度 0.8、粗糙度 0.4；屏下摄像头圆片强度 0.4、粗糙度 0.05
      vec3 haze = envBRDF(vec3(0.04), 0.4, nv) * envSpec(R, 0.4) * 0.8;
      vec3 mirror = envBRDF(vec3(0.04), 0.05, nv) * envSpec(R, 0.05) * 0.4;
      col = lin2srgb(srgb2lin(col) + mix(haze, mirror, udc));
    }
    outColor = vec4(col, 1.0);
  }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }
  const bodyProg = program(BODY_VS, BODY_FS);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const screenProg = program(SCREEN_VS, SCREEN_FS);

  function meshVAO(prog, mesh, withNormals) {
    const vao = gl.createVertexArray();
    const buffers = [];
    gl.bindVertexArray(vao);
    const attr = (name, data, size) => {
      const loc = gl.getAttribLocation(prog.p, name);
      if (loc < 0) return;
      const buf = gl.createBuffer();
      buffers.push(buf);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', mesh.pos, 3);
    if (withNormals) {
      attr('aNor', mesh.nor, 3); attr('aMat', mesh.mat, 1); attr('aUv', mesh.uv, 2);
      if (mesh.tint) { attr('aTint', mesh.tint, 3); attr('aFinish', mesh.finish, 4); }
      if (mesh.texl) { attr('aUv1', mesh.uv1, 2); attr('aTexL', mesh.texl, 4); }
      else {
        // 程序生成的机身没有模型贴图
        const l = gl.getAttribLocation(prog.p, 'aTexL');
        if (l >= 0) { gl.disableVertexAttribArray(l); gl.vertexAttrib4f(l, -1, -1, -1, -1); }
      }
    } else {
      attr('aNor', mesh.nor, 3);
      attr('aLocal', mesh.local || mesh.pos.filter((_, i) => i % 3 !== 2), 2);
      attr('aTangent', mesh.tangent || mesh.pos.map((_, i) => i % 3 === 0 ? 1 : 0), 3);
    }
    const ib = gl.createBuffer();
    buffers.push(ib);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.idx.length, split: mesh.hingeFrom ?? mesh.idx.length, dispose() { buffers.forEach((b) => gl.deleteBuffer(b)); gl.deleteVertexArray(vao); } };
  }
  gl.useProgram(screenProg.p);
  gl.uniform1i(screenProg.u.uImg, 0);
  gl.uniform1i(screenProg.u.uLut, 1);

  gl.useProgram(bodyProg.p);
  gl.uniform1i(bodyProg.u.uBackTex, 3);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.uniform1i(bodyProg.u.uTexBC, 4);
  gl.uniform1i(bodyProg.u.uTexMR, 5);
  gl.uniform1i(bodyProg.u.uTexN, 6);
  gl.uniform1i(bodyProg.u.uTexAO, 7);
  gl.useProgram(screenProg.p);

  // 模型贴图：每种用途一个 512² 纹理数组（含多级渐远），各机型一套，第一次绘制时上传
  const TEX_SIZE = 512;
  const texCanvas = document.createElement('canvas');
  texCanvas.width = texCanvas.height = TEX_SIZE;
  const texCtx = texCanvas.getContext('2d');
  function texArray(images, srgb) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    const n = Math.max(images.length, 1), size = images.length ? TEX_SIZE : 1;
    const levels = Math.floor(Math.log2(size)) + 1;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, size, size, n);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (!images.length) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    images.forEach((img, layer) => {
      // 统一缩放到同一尺寸再放进数组；绘制到画布前先清空，保留贴图自带的透明度
      texCtx.clearRect(0, 0, size, size);
      texCtx.drawImage(img, 0, 0, size, size);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
    });
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return tex;
  }
  const modelTex = {};
  function bindModelTextures(model) {
    const key = model && Phone3D.hasModel(model) ? model : '';
    if (!modelTex[key]) {
      const imgs = key ? Phone3D.modelTextures(key) : null;
      modelTex[key] = [texArray(imgs?.bc || [], true), texArray(imgs?.mr || [], false), texArray(imgs?.n || [], false), texArray(imgs?.ao || [], false)];
    }
    modelTex[key].forEach((tex, i) => { gl.activeTexture(gl.TEXTURE4 + i); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex); });
    gl.activeTexture(gl.TEXTURE0);
  }

  const lutTex = {};
  function bindLUT(id) {
    gl.activeTexture(gl.TEXTURE1);
    if (lutTex[id]) { gl.bindTexture(gl.TEXTURE_2D, lutTex[id].tex); return lutTex[id].width; }
    // 原图占位仍需一张完整纹理供 WebGL 的 sampler 校验；它不参与光学计算。
    const lut = getModel(id) ? getLUT(id) : { data: new Float32Array(8), width: 2, height: 1 };
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, lut.width, lut.height, 0, gl.RGBA, gl.FLOAT, lut.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    lutTex[id] = { tex, width: lut.width };
    return lut.width;
  }

  const backTextures = new Map();
  function bindBackTexture(path) {
    let entry = backTextures.get(path);
    if (!entry) {
      const tex = gl.createTexture();
      entry = { tex, ready: false };
      backTextures.set(path, entry);
      const img = new Image();
      img.onload = () => {
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        entry.ready = true;
        requestRender();
      };
      img.src = path;
    }
    if (entry.ready) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    }
    return entry.ready;
  }

  // 热力图色表放在纹理单元 2
  gl.uniform1i(screenProg.u.uPal, 2);
  const palTex = gl.createTexture();
  function setPaletteTex(name) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, palTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Viz.paletteBytes(name, false));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
  }

  const imgTex = gl.createTexture();
  const duoPatterns={};
  function uploadImage(tex,src) {
    const maxSide = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
    const k = Math.min(1, maxSide / Math.max(src.width, src.height));
    if (k < 1) {
      const cv = document.createElement('canvas');
      cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
      cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
      src = cv;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return src;
  }
  function setImage(src) {
    image=uploadImage(imgTex,src);
    requestRender();
  }

  /** 按“铺满”方式把图片映射到屏幕：返回 uv 缩放。 */
  function imgScale(d,src=image) {
    const [dw, dh] = dispMM(d);
    const ia = src ? src.width / src.height : dw / dh, da = dw / dh;
    return ia > da ? [da / ia, 1] : [1, ia / da];
  }


  // ---------- 渲染 ----------
  function resize() {
    applyLayout();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    requestRender();
  }

  let pending = false;
  function requestRender() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }

  function setCommon(prog, M, v) {
    const radius = Math.max(100, ...v.dev.corners.map((c) => Math.hypot(...c)));
    const near = Math.max(v.D - radius, 1), far = v.D + radius;
    const k2 = 2 / (1 / near - 1 / far), k1 = 1 + k2 / far;
    gl.uniformMatrix3fv(prog.u.uModel, false, [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);
    gl.uniform1f(prog.u.uEyeD, v.D);
    gl.uniform3fv(prog.u.uEye, v.eye);
    gl.uniform2f(prog.u.uScale, (2 * v.f) / v.W, (2 * v.f) / v.H);
    gl.uniform2f(prog.u.uCenter, (2 * v.cx) / v.W - 1, 1 - (2 * v.cy) / v.H);
    gl.uniform2f(prog.u.uDepth, k1, k2);
  }

  function render() {
    applyPalette();
    const M = modelMatrix();
    const ids = S.stereo ? [activeIds()[0], activeIds()[0]] : activeIds();
    computeViews(ids.map(devForProfile));
    placeFrames();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 双眼立体时每只眼的画面裁剪在自己的背景框内，避免偏转后伸出的部分落到另一只眼的画面里
    const px = canvas.width / canvas.clientWidth;
    const clip = (v) => {
      if (!S.stereo) return;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.round((v.x0 + 3) * px), 0, Math.round((v.w - 6) * px), canvas.height);
    };

    gl.useProgram(bodyProg.p);
    for (const v of views) {
      clip(v);
      const c = colorOf(v.dev.name);
      gl.uniform3fv(bodyProg.u.uFrame, c.frame);
      gl.uniform3fv(bodyProg.u.uBack, c.back);
      gl.uniform1f(bodyProg.u.uRough, v.dev.spec.rough ?? 0.55);
      gl.uniform1i(bodyProg.u.uNative, !!v.dev.spec.model);
      const hasBackTexture = v.dev.spec.backTexture && bindBackTexture(v.dev.spec.backTexture);
      gl.uniform1i(bodyProg.u.uUseBackTex, hasBackTexture ? 1 : 0);
      bindModelTextures(v.dev.spec.model);
      gl.uniform1f(bodyProg.u.uClosed, v.dev.spec.foldable ? 1 - v.dev.fold / 180 : 0);
      gl.bindVertexArray(v.dev.body.vao);
      setCommon(bodyProg, M, v);
      gl.uniform1i(bodyProg.u.uPass, 0);
      const B = v.dev.body;
      gl.drawElements(gl.TRIANGLES, B.split, gl.UNSIGNED_INT, 0);
      if (B.count > B.split) {
        // Duo 转轴：带正向深度偏移单独画。它在展开时整个藏在屏幕后面，侧面几乎侧对视线，
        // 不往后推的话深度插值误差会让它偶尔穿过屏幕，正面看显示成两条细竖线；斜率相关的偏移正好只推这种侧对的面
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(2, 8);
        gl.drawElements(gl.TRIANGLES, B.count - B.split, gl.UNSIGNED_INT, B.split * 4);
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
    }

    // 透明通道：模型里的镜头盖玻璃、闪光灯罩、背板磨砂覆层等，在不透明部分之后、屏幕之前叠加（不写深度）。
    // 放在屏幕之前画：覆层被多边形偏移拉近后，侧对视线的侧壁偶尔会落到屏幕前面，随后画的屏幕会把它盖掉；
    // 真正挡住屏幕的机身是不透明部分，已经写入深度，屏幕照样被挡住。
    const glassy = views.filter((v) => v.dev.spec.model);
    if (glassy.length) {
      gl.useProgram(bodyProg.p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL);
      // 覆层与下面的玻璃壳在网格细分上有微小起伏，略微拉近，避免局部被遮住出现块状花纹
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-2, -24);
      gl.uniform1i(bodyProg.u.uPass, 1);
      for (const v of glassy) {
        clip(v);
        gl.uniform1i(bodyProg.u.uNative, 1);
        gl.uniform1i(bodyProg.u.uUseBackTex, 0);
        bindModelTextures(v.dev.spec.model);
        gl.uniform1f(bodyProg.u.uClosed, v.dev.spec.foldable ? 1 - v.dev.fold / 180 : 0);
        gl.bindVertexArray(v.dev.body.vao);
        setCommon(bodyProg, M, v);
        gl.drawElements(gl.TRIANGLES, v.dev.body.split, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
      gl.disable(gl.BLEND);
    }
    gl.useProgram(screenProg.p);
    gl.uniform1f(screenProg.u.uRot, S.rot);
    const P = Viz.palette(S.pal);
    gl.uniform1i(screenProg.u.uBands, P.banded ? 7 : 0);
    gl.uniform1i(screenProg.u.uPalFlip, P.flipAngle ? 1 : 0);
    views.forEach((v, i) => {
      clip(v);
      const d = v.dev;
      for (const screen of d.screens) {
        const cut = screen.cutout || { y: 0, half: 0, r: 0 };
        const id = screen.key ? `duo-${screen.key}` : ids[i];
        gl.uniform1i(screenProg.u.uMode, S.mode === 0 && !getModel(id) ? 1 : S.mode);
        gl.uniform2fv(screenProg.u.uScreenHalf, screen.screenHalf);
        gl.uniform1f(screenProg.u.uCorner, screen.corner);
        const udc = screen.udc;
        gl.uniform1f(screenProg.u.uMatte, screen.matte ? 1 : 0);
        gl.uniform1i(screenProg.u.uModelHoles, screen.modelHoles && Phone3D.hasModel(d.spec.model) ? 1 : 0);
        gl.uniform3f(screenProg.u.uUdc, udc ? udc[0] : 0, udc ? screen.screenHalf[1] - udc[1] : 0, udc ? udc[2] : 0);
        gl.uniform3f(screenProg.u.uCut, cut.y, cut.half, cut.r);
        const holes = screen.holes || [];
        for (let h = 0; h < 3; h++) {
          const hole = holes[h];
          gl.uniform3f(screenProg.u[`uHole${h}`], hole ? hole[0] : 0, hole ? screen.screenHalf[1] - hole[1] : 0, hole ? hole[2] : 0);
        }
        gl.uniform2fv(screenProg.u.uDispMM, dispMM(screen));
        const pattern=S.pattern&&screen.key?duoPatterns[screen.key]:null;
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,pattern?.tex||imgTex);
        gl.uniform2fv(screenProg.u.uImgScale, imgScale(screen,pattern?.image||image));
        gl.uniform1i(screenProg.u.uLutW, bindLUT(id));
        gl.bindVertexArray(screen.screen.vao);
        setCommon(screenProg, M, v);
        gl.drawElements(gl.TRIANGLES, screen.screen.count, gl.UNSIGNED_INT, 0);
      }
    });
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);

    updateReadout(M, ids);
    if (hover) updateTip();
    writeHash();
  }

  // ---------- 信息显示 ----------
  /** 屏幕局部坐标 p 处左右眼（局部坐标 L、R）所见白场的差异；参考白取两眼白场平均，不依赖 0° 基准。 */
  function binoAt(m, L, R, p, frame) {
    const a = anglesAt(L, p, frame);
    const b = anglesAt(R, p, frame);
    const el = m.evalAt(a.theta, a.psi), er = m.evalAt(b.theta, b.psi);
    const Wm = el.W.map((v, k) => (v + er.W[k]) / 2);
    const u1 = m.uvPrime(el.W), u2 = m.uvPrime(er.W);
    return {
      a, b, el, er,
      dl: Math.abs(el.W[1] - er.W[1]) / Math.max(el.W[1], er.W[1]) * 100,
      j: Math.hypot(u1[0] - u2[0], u1[1] - u2[1]) / AngleModel.JNCD,
      de: AngleModel.deltaE2000(AngleModel.xyzToLab(el.W, Wm), AngleModel.xyzToLab(er.W, Wm)),
    };
  }
  /** 全屏 5×9 个点的平均双眼差异。 */
  function binoStats(M, id) {
    const m = getModel(id), d = devForProfile(id), [hx, hy] = d.screenHalf;
    const L = applyT(M, eyePos(-1)), R = applyT(M, eyePos(1));
    const acc = { dl: 0, j: 0, de: 0 };
    for (let iy = 0; iy < 9; iy++) for (let ix = 0; ix < 5; ix++) {
      const u = (ix + 0.5) / 5, v = (iy + 0.5) / 9;
      const frame = d.surfaceFrame?.(byId(id).surface, u, v);
      const r = binoAt(m, L, R, frame ? frame.point : [(u * 2 - 1) * hx, (v * 2 - 1) * hy, 0], frame);
      acc.dl += r.dl / 45; acc.j += r.j / 45; acc.de += r.de / 45;
    }
    return acc;
  }

  function placeCaption(el, v, html) {
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    el.classList.toggle('stereo', S.stereo);
    const dock = capDocked();
    el.classList.toggle('dock', dock);
    // 手机竖屏双机对比：数据卡收窄到各自那一栏，避免互相重叠、超出屏幕
    const narrow = !dock && !S.stereo && document.body.dataset.layout === 'sheet';
    el.classList.toggle('narrow', narrow);
    el.style.width = S.stereo ? v.w - 20 + 'px' : narrow ? v.w - 8 + 'px' : '';
    el.style.display = 'block';
    el.style.left = dock ? '' : v.cx + 'px';
    el.style.top = dock ? '' : v.bottomY + 8 + 'px';
    // 横屏（侧栏 / 宽屏）停靠时贴着舞台右沿；宽度不超过舞台里角度读数右边剩下的空间
    const L = document.body.dataset.layout, side = dock && (L === 'side' || L === 'wide');
    const stageRight = side ? $('panel').getBoundingClientRect().left - (L === 'wide' ? 12 : 16) : 0;
    const stageLeft = L === 'wide' ? $('rail').getBoundingClientRect().right + 12 : $('hud').getBoundingClientRect().right + 16;
    el.style.right = side ? canvas.clientWidth - stageRight + 'px' : '';
    el.style.maxWidth = side ? Math.max(stageRight - stageLeft, 180) + 'px' : '';
    // 停靠时数据卡高度决定手机区域上沿，高度变化后再排一次
    if (dock && el.offsetHeight !== el._dockH) { el._dockH = el.offsetHeight; requestRender(); }
    if (!dock) el._dockH = 0;
  }
  /** 双眼立体时左右两块完全相同的背景框，兼作融合时的零视差参照。 */
  function placeFrames() {
    [0, 1].forEach((i) => {
      const el = $('sf' + i), v = views[i];
      if (!S.stereo || !v) { el.style.display = 'none'; return; }
      if (i === 1) $('sepInfo').textContent = `两图中心距 ${Math.round(v.cx - views[0].cx)} px。`;
      Object.assign(el.style, {
        display: 'block', left: v.x0 + 2 + 'px', width: v.w - 4 + 'px',
        top: v.top + 'px', height: v.bottomY - v.top + 100 + 'px',
      });
    });
  }

  const stat = (val, unit, label) => `<div><b>${val}${unit ? `<small>${unit}</small>` : ''}</b><span>${label}</span></div>`;
  function capName(p, i) {
    const key = S.compare ? `<span class="key" style="--k:${SERIES[i]}"></span>` : '';
    const st = hasPrivacy(p.device) ? `<small>${privacyText(p.device)[p.privacy ? 'on' : 'off']}</small>` : '';
    return `<div class="cap-name">${key}${p.device}${p.surface ? ' · ' + surfaceName(p.surface) : ''}${st}</div>`;
  }
  const pendingCaption = (p, i) => capName(p, i) +
    `<div class="cap-stats">${stat('—', '', '亮度')}${stat('—', '', '色偏')}${stat('—', '', 'ΔE2000')}</div>` +
    `<div class="note">${surfaceName(p.surface)}可视角数据待测${S.mode === 2 ? ' · 当前仅显示几何离轴角' : ' · 当前显示原图'}</div>`;

  /** 屏幕中心对应的 (θ, ψ手机坐标)；θ≈0 时沿用当前方向，保证曲线方向稳定。 */
  const psiLocal = () => AngleModel.norm360(S.psi + S.rot);

  function updateReadout(M, ids) {
    $('distV').textContent = Math.round(S.dist / 10) + ' cm';
    $('heroTheta').textContent = Math.round(S.theta) + '°';
    $('heroDir').textContent = S.theta < 0.5 ? '正对屏幕' : `从${Viz.dirName(S.psi)}看`;
    const duo = byId(ids[0]).surface;
    $('heroSub').textContent = `${duo ? (S.compare ? '机身偏转角' : '机身偏转角 · 折叠 ' + Math.round(S.fold) + '°') : '屏幕中心离轴角'} · 观看距离 ${Math.round(S.dist / 10)} cm`;
    $('dataTag').textContent = ids.some((id) => !getModel(id)) ? '数据待测' : '实测数据';
    $('legend').classList.toggle('show', S.mode === 2);
    updatePad(M);
    updateCharts();

    if (S.stereo) {
      if (!getModel(ids[0])) {
        [0, 1].forEach((i) => placeCaption($('cap' + i), views[i], pendingCaption(byId(ids[0]), 0)));
        return;
      }
      const b = binoStats(M, ids[0]);
      const html = capName(byId(ids[0]), 0) +
        `<div class="cap-stats">${stat(b.dl.toFixed(1), '%', '双眼亮度差')}${stat(b.j.toFixed(2), 'JNCD', '双眼色度差')}${stat(b.de.toFixed(1), '', '双眼 ΔE2000')}</div>` +
        `<div class="note">全屏平均${S.mode === 2 ? ' · 颜色为离轴角 0–70°' : ''}${byId(ids[0]).surface && DUO_NOTE ? ' · ' + DUO_NOTE : ''}</div>`;
      [0, 1].forEach((i) => placeCaption($('cap' + i), views[i], html));
      return;
    }

    const c = anglesOf(applyT(M, [0, 0, S.dist]));
    const psi = c.theta < 0.01 ? psiLocal() : c.psi;
    [0, 1].forEach((i) => {
      const el = $('cap' + i), v = views[i];
      if (!v) { el.style.display = 'none'; return; }
      if (!getModel(ids[i])) { placeCaption(el, v, pendingCaption(byId(ids[i]), i)); return; }
      const frame = v.dev.surfaceFrame?.(byId(ids[i]).surface);
      const a = frame ? anglesAt(applyT(M, v.eye), frame.point, frame) : { theta: c.theta, psi };
      const e = getModel(ids[i]).evalAt(a.theta, a.psi);
      placeCaption(el, v, capName(byId(ids[i]), i) +
        `<div class="cap-stats">${stat(Math.round(e.yRatio * 100), '%', '亮度')}${stat(e.jncd.toFixed(1), 'JNCD', '色偏')}${stat(e.de00.toFixed(1), '', 'ΔE2000')}</div>` +
        '');
    });
  }

  // ---------- 方向盘 ----------
  const padRead = document.createElement('div');
  padRead.className = 'pad-read';
  document.querySelector('#secPad .pad-side').prepend(padRead);
  const pad = Viz.createPad($('pad'), {
    maxTheta: MAX_TILT,
    onInput(theta, psi) { stopSweep(); setView(theta, psi); },
    onHover(h) { padHover = h; updatePadRead(); },
  });
  let padHover = null;
  // levels：等值线级数（亮度每 10% 一条，色偏每 2 JNCD 一条）
  const metricFmt = {
    lum: { t: (v) => v, levels: 10, ticks: ['0%', '50%', '100%'], fmt: (v) => `亮度 ${Math.round(v * 100)}%` },
    jncd: { t: (v) => v / JMAX, levels: JMAX / 2, ticks: ['0', String(JMAX / 2), JMAX + ' JNCD'], fmt: (v) => `色偏 ${v.toFixed(1)} JNCD` },
  };
  $('palette').innerHTML = Object.entries(Viz.PALETTES).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  let palApplied = '';
  function applyPalette() {
    if (palApplied === S.pal) return;
    palApplied = S.pal;
    $('palette').value = S.pal;
    const P = Viz.palette(S.pal);
    setPaletteTex(S.pal);
    $('angRamp').style.background = Viz.paletteCSS(S.pal, P.banded ? 7 : 0, P.flipAngle);
  }
  $('palette').addEventListener('change', (e) => { S.pal = e.target.value; requestRender(); });

  function updatePadRead() {
    const id = activeIds()[0], g = getGrid(id), mf = metricFmt[S.padMetric];
    const h = padHover || { theta: S.theta, psi: S.psi };
    const where = h.theta < 0.5 ? '正对' : `${Math.round(h.theta)}° ${Viz.dirName(h.psi)}`;
    const who = S.compare ? `<span class="key" style="--k:${SERIES[0]}"></span>` : '';
    if (!g) { padRead.innerHTML = `${who}${where} · <b>${surfaceName(byId(id).surface)}数据待测</b>`; return; }
    const v = g[S.padMetric](h.theta, h.psi + S.rot);
    padRead.innerHTML = `${who}<span class="dim">${padHover ? '指针处' : '当前'}</span> ${where} · <b>${mf.fmt(v)}</b>`;
  }

  function updatePad(M) {
    const id = activeIds()[0], m = getModel(id), g = getGrid(id), mf = metricFmt[S.padMetric];
    applyPalette();
    if (!m) {
      pad.setField(`${id}|pending`, null, { pal: 'mono', levels: 0 });
      pad.update({ theta: S.theta, psi: S.psi, rot: S.rot, spokes: [], hatch: [], eyes: null });
      $('padRamp').style.background = 'var(--raise)';
      $('padTicks').innerHTML = '<span>可视角数据待测</span>';
      updatePadRead();
      return;
    }
    pad.setField(`${id}|${S.padMetric}|${S.pal}`, (th, psi) => mf.t(g[S.padMetric](th, psi)), { pal: S.pal, levels: mf.levels });
    $('padRamp').style.background = Viz.paletteCSS(S.pal, mf.levels, false);
    const spokes = m.lines.filter((l) => !l.virtual).map((l) => l.psi);
    const hatch = [];
    m.lines.forEach((l, i) => {
      const n = m.lines[(i + 1) % m.lines.length];
      if (l.virtual || n.virtual) hatch.push([l.psi, l.psi + (AngleModel.norm360(n.psi - l.psi) || 360)]);
    });
    let eyes = null;
    if (S.stereo) {
      eyes = [-1, 1].map((s) => {
        const a = anglesOf(applyT(M, eyePos(s)));
        return [a.theta, a.psi - S.rot];
      });
    }
    pad.update({ theta: S.theta, psi: S.psi, rot: S.rot, spokes, hatch, eyes });
    $('padTicks').innerHTML = mf.ticks.map((t) => `<span>${t}</span>`).join('');
    updatePadRead();
  }

  // ---------- 曲线 ----------
  const charts = Viz.createCharts($('charts'), {
    maxTheta: MAX_TILT,
    onPick(theta) { stopSweep(); setView(theta, S.psi); },
  });
  const seriesCache = {};
  function seriesFor(id, psi) {
    const key = `${id}|${psi.toFixed(1)}`;
    if (seriesCache[key]) return seriesCache[key];
    const m = getModel(id), lum = [], jncd = [];
    for (let t = 0; t <= MAX_TILT; t++) { const e = m.evalAt(t, psi); lum.push(e.yRatio * 100); jncd.push(e.jncd); }
    const keys = Object.keys(seriesCache);
    if (keys.length > 64) keys.slice(0, 32).forEach((k) => delete seriesCache[k]);
    return (seriesCache[key] = { lum, jncd });
  }
  function updateCharts() {
    const ids = S.stereo ? [activeIds()[0]] : activeIds();
    const psi = psiLocal();
    const series = ids.flatMap((id, i) => getModel(id) ? [Object.assign({ label: shortLabel(byId(id)), color: SERIES[i] }, seriesFor(id, psi))] : []);
    $('curveDir').textContent = series.length ? `沿${S.theta < 0.5 ? '右侧' : Viz.dirName(S.psi)}方向 · 屏幕中心` : '等待实测';
    const leg = ids.length > 1
      ? ids.map((id, i) => `<span><i style="--k:${SERIES[i]}"></i>${shortLabel(byId(id))}${getModel(id) ? '' : ' · 待测'}</span>`).join('') : '';
    if ($('curveLegend')._html !== leg) { $('curveLegend').innerHTML = leg; $('curveLegend')._html = leg; }
    $('charts').hidden = !series.length;
    $('curveEmpty').hidden = !!series.length;
    if (series.length) charts.update({ series, cursor: S.theta, jMax: JMAX, lMax: Math.max(100, Math.ceil(RANGE.lum * 10) * 10), ph: window.innerHeight < 820 ? 42 : 58 });
  }

  // ---------- 屏幕悬停读数 ----------
  let hover = null;
  function updateTip() {
    const tips = [$('tip'), $('tip2')];
    const hide = () => tips.forEach((t) => { t.style.display = 'none'; });
    const vi = hover ? views.findIndex((v) => hover.x >= v.x0 && hover.x < v.x1) : -1;
    if (vi < 0) { hide(); return; }
    const view = views[vi];
    const id = activeIds()[S.stereo ? 0 : vi];
    if (byId(id).surface) { hide(); return; }
    const M = modelMatrix();
    const E = view.eye;
    const dir = [(hover.x - view.cx) / view.f - E[0] / view.D, -(hover.y - view.cy) / view.f, -1];
    const n = [M[2], M[5], M[8]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const t = -dot(n, E) / dot(n, dir);
    const p = [E[0] + t * dir[0], E[1] + t * dir[1], E[2] + t * dir[2]];
    const local = applyT(M, p);
    const [hx, hy] = view.dev.screenHalf;
    const inside = Math.abs(local[0]) <= hx && Math.abs(local[1]) <= hy;
    if (!inside || !(t > 0)) { hide(); return; }

    if (S.stereo) {
      const r = binoAt(getModel(id), applyT(M, eyePos(-1)), applyT(M, eyePos(1)), local);
      const html =
        `<span class="dim">左眼</span> 离轴 ${r.a.theta.toFixed(1)}° · 亮度 <b>${Math.round(r.el.yRatio * 100)}%</b><br>` +
        `<span class="dim">右眼</span> 离轴 ${r.b.theta.toFixed(1)}° · 亮度 <b>${Math.round(r.er.yRatio * 100)}%</b><br>` +
        `双眼亮度差 <b>${r.dl.toFixed(1)}%</b><br>` +
        `色度差 <b>${r.j.toFixed(2)}</b> JNCD · ΔE00 <b>${r.de.toFixed(1)}</b>`;
      views.forEach((v, i) => {
        const tp = tips[i];
        tp.innerHTML = html;
        tp.classList.add('stereo');
        Object.assign(tp.style, { display: 'block', left: v.x0 + 12 + 'px', width: v.w - 24 + 'px', top: hover.y + 16 + 'px' });
      });
      return;
    }

    const tip = tips[0];
    tips[1].style.display = 'none';
    tip.classList.remove('stereo');
    tip.style.width = '';
    const a = anglesOf(applyT(M, [E[0] - p[0], E[1] - p[1], E[2] - p[2]]));
    const e = getModel(id).evalAt(a.theta, a.psi);
    tip.innerHTML =
      (S.compare ? `<span class="dim">${profileLabel(byId(id))}</span><br>` : '') +
      `此处离轴角 <b>${a.theta.toFixed(1)}°</b>${e.clamped ? ' <span class="warn">超出实测范围，按 70° 计</span>' : ''}<br>` +
      `亮度 <b>${Math.round(e.yRatio * 100)}%</b><br>` +
      `色偏 <b>${e.jncd.toFixed(1)}</b> JNCD <span class="dim">Δu′v′ ${e.duv.toFixed(4)}</span><br>` +
      `ΔE2000 <b>${e.de00.toFixed(1)}</b> <span class="dim">含亮度</span>`;
    tip.style.display = 'block';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(hover.x + 16, innerWidth - tw - 8) + 'px';
    tip.style.top = Math.min(hover.y + 16, innerHeight - th - 8) + 'px';
  }

  // ---------- 视角状态 ----------
  /** 由眼睛方向（θ, ψ 观看者坐标：0 右、90 上）设置手机姿态。 */
  function setView(theta, psi) {
    theta = Math.min(Math.max(theta, 0), MAX_TILT);
    S.theta = theta;
    S.psi = AngleModel.norm360(psi);
    S.tilt = [-theta * Math.cos(S.psi * DEG), -theta * Math.sin(S.psi * DEG)];
    requestRender();
  }
  /** 拖动画面时直接改手机姿态，再反算眼睛方向。 */
  function setTilt(tx, ty) {
    const mag = Math.hypot(tx, ty);
    if (mag > MAX_TILT) { tx *= MAX_TILT / mag; ty *= MAX_TILT / mag; }
    S.tilt = [tx, ty];
    S.theta = Math.min(mag, MAX_TILT);
    if (mag > 0.05) S.psi = AngleModel.norm360(Math.atan2(-ty, -tx) / DEG);
    requestRender();
  }

  let anim = null;
  /** 平滑过渡到目标方向（在手机姿态空间里插值）。 */
  function animateTo(theta, psi, ms = 450) {
    cancelAnimationFrame(anim);
    const from = S.tilt.slice(), t0 = performance.now();
    const to = [-theta * Math.cos(psi * DEG), -theta * Math.sin(psi * DEG)];
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setTilt(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
      if (k < 1) anim = requestAnimationFrame(step);
      else setView(theta, psi);
    };
    anim = requestAnimationFrame(step);
  }
  const resetTilt = () => { stopSweep(); animateTo(0, S.psi, 350); };

  // 自动扫描：沿当前方向 0° → 70° → 0° 往复
  const SWEEP_MS = 9000;
  function startSweep() {
    cancelAnimationFrame(anim);
    const psi = S.psi;
    const ph0 = Math.acos(1 - 2 * Math.min(S.theta / MAX_TILT, 1)) / (2 * Math.PI);
    S.sweep = { t0: performance.now() - ph0 * SWEEP_MS, psi };
    $('sweep').classList.add('on');
    $('sweep').querySelector('.lbl').textContent = '停止';
    const step = (now) => {
      if (!S.sweep) return;
      const ph = ((now - S.sweep.t0) / SWEEP_MS) % 1;
      setView(MAX_TILT * (1 - Math.cos(ph * 2 * Math.PI)) / 2, S.sweep.psi);
      S.sweep.raf = requestAnimationFrame(step);
    };
    S.sweep.raf = requestAnimationFrame(step);
  }
  function stopSweep() {
    if (!S.sweep) return;
    cancelAnimationFrame(S.sweep.raf);
    S.sweep = null;
    $('sweep').classList.remove('on');
    $('sweep').querySelector('.lbl').textContent = '扫描';
  }
  const toggleSweep = () => (S.sweep ? stopSweep() : startSweep());

  function setDist(cm) {
    cm = Math.min(Math.max(cm, 10), 100);
    S.dist = cm * 10;
    $('dist').value = cm;
    requestRender();
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- 布局 ----------
  const SECS = [...document.querySelectorAll('#panelBody .sec')];
  let sheetSeen = false;
  function setSheetMin(on) {
    document.body.classList.toggle('sheet-min', on);
    $('grab').setAttribute('aria-expanded', String(!on));
    requestAnimationFrame(() => { pad.draw(); charts.render(); requestRender(); });
  }
  function applyLayout() {
    const W = window.innerWidth, H = window.innerHeight;
    // 宽屏双栏需要足够宽度，否则手机被两侧栏挤小（如 iPad 横屏 1180）；平板竖屏用底部抽屉，让手机占满宽度
    const L = W >= 1280 && H >= 600 ? 'wide' : W > 760 && W >= H * 0.95 ? 'side' : 'sheet';
    const body = document.body;
    body.dataset.layout = L;
    // 手机竖屏：设置默认收起，画面优先给手机；视角直接拖动手机调整
    if (L === 'sheet' && !sheetSeen) { sheetSeen = true; setSheetMin(true); }
    $('hint').textContent = L === 'sheet' ? '拖动手机改变观看角度 · 双击回正' : '拖动画面转动手机 · 拖动左侧方向盘直接选角度 · 滚轮调距离 · 空格自动扫描';
    placePicker();
    const hud = $('hud'), rail = $('rail'), pb = $('panelBody');
    if (L === 'wide' && !S.clean) {
      if (hud.parentElement !== rail) rail.prepend(hud);
      SECS.forEach((s) => (s.dataset.tab === 'view' && s.dataset.wide !== 'panel' ? rail : pb).appendChild(s));
    } else {
      if (hud.parentElement !== body) body.insertBefore(hud, rail);
      SECS.forEach((s) => pb.appendChild(s));
    }
    applyTab();
  }
  function applyTab() {
    SECS.forEach((s) => s.classList.toggle('tab-on', s.dataset.tab === S.tab));
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  }
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const sheet = document.body.dataset.layout === 'sheet';
    // 手机：点分页展开；再点当前分页收起
    if (sheet) setSheetMin(b.dataset.tab === S.tab && !document.body.classList.contains('sheet-min'));
    S.tab = b.dataset.tab;
    applyTab();
    $('panelBody').scrollTop = 0;
    requestAnimationFrame(() => { pad.draw(); charts.render(); requestRender(); });
  });
  // 把手：点按切换；上滑展开、下滑收起
  (() => {
    const grab = $('grab');
    let y0 = null;
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
    grab.addEventListener('pointerup', (e) => {
      if (y0 === null) return;
      const dy = e.clientY - y0; y0 = null;
      const min = document.body.classList.contains('sheet-min');
      setSheetMin(Math.abs(dy) < 12 ? !min : dy > 0);
    });
    grab.addEventListener('pointercancel', () => { y0 = null; });
  })();
  function setClean(on) {
    S.clean = on;
    document.body.classList.toggle('clean', on);
    syncQuick();
    applyLayout();
    if (on) toast('已隐藏界面 · 按 H 恢复');
    requestRender();
  }

  // ---------- 交互 ----------
  // 首次打开时的操作提示，第一次交互或 10 秒后淡出
  const hint = $('hint');
  const hideHint = () => hint.classList.add('gone');
  setTimeout(hideHint, 10000);
  ['pointerdown', 'wheel', 'keydown'].forEach((ev) => window.addEventListener(ev, hideHint, { once: true, passive: true }));

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim);
    stopSweep();
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    hover = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
    if (drag) {
      const k = 0.25;
      setTilt(S.tilt[0] + (e.clientX - drag.x) * k, S.tilt[1] - (e.clientY - drag.y) * k);
      drag = { x: e.clientX, y: e.clientY };
    } else {
      updateTip();
    }
  });
  const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { hover = null; updateTip(); });
  canvas.addEventListener('dblclick', resetTilt);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setDist((S.dist / 10) * Math.exp(e.deltaY * 0.001));
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (appMode === 'scene') return;   // 场景演示模式下快捷键交给三维场景
    if (!$('picker').hidden) { if (e.key === 'Escape') openPicker(false); return; }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, 2], ArrowDown: [0, -2] }[e.key];
    if (k) { e.preventDefault(); stopSweep(); setTilt(S.tilt[0] + k[0], S.tilt[1] + k[1]); return; }
    switch (e.key) {
      case ' ':
        // 让空格只控制扫描，不再触发当前聚焦的按钮
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        toggleSweep();
        break;
      case '0': case 'Escape': resetTilt(); break;
      case 'h': case 'H': setClean(!S.clean); break;
      case 'p': case 'P':
        if (!S.compare && hasPrivacy(S.device)) { S.privacy = !S.privacy; syncProfileUI(); requestRender(); toast(profileLabel(byId(activeIds()[0]))); }
        break;
      default:
    }
  });

  $('dist').addEventListener('input', (e) => setDist(+e.target.value));
  $('sweep').addEventListener('click', toggleSweep);

  function bindSeg(id, fn) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      fn(b.dataset.v);
      syncSeg(id, b.dataset.v);
    });
  }
  const syncSeg = (id, v) => $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === String(v)));
  bindSeg('mode', (v) => { S.mode = +v; requestRender(); });
  bindSeg('orient', (v) => { S.rot = +v; if (S.pattern) loadPattern(S.pattern); requestRender(); });
  bindSeg('padMetric', (v) => { S.padMetric = v; requestRender(); });

  function renderSwatches() {
    const names = activeDevices();
    $('colors').innerHTML = names.map((n) => {
      const cur = colorOf(n).id;
      const label = names.length > 1 ? `<span class="sw-label">${n}</span>` : '';
      const btns = specOf(n).colors.map((c) =>
        `<button data-v="${c.id}" title="${c.name}" aria-label="${c.name}" style="--c:${c.swatch}"${c.id === cur ? ' class="on"' : ''}></button>`).join('');
      return `<div class="swatches" data-d="${n}">${label}${btns}</div>`;
    }).join('');
  }
  $('colors').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.colors[b.parentElement.dataset.d] = b.dataset.v;
    renderSwatches();
    renderDevCards();
    requestRender();
  });

  function renderDevCards() {
    $('devCards').innerHTML = DEVICES.map((d) => {
      const k = specKey(d) || d, suffix = d.slice(k.length).trim();
      const t = privacyText(d);
      const sub = d === 'iPhone Duo' ? (DUO_PROFILES.some((p) => !p.sets) ? '内屏 / 外屏 · 数据待测' : '内屏 / 外屏 · 实测数据')
        : hasPrivacy(d) ? `${t.off} / ${t.on} 两组实测` : '一组实测';
      return `<button class="dev-card${d === S.device ? ' on' : ''}" data-d="${d}">` +
        `<span class="ph" style="--c1:${colorOf(d).swatch}"></span>` +
        `<span><b>${k}${suffix ? `<span class="badge" title="屏幕版本">${suffix}</span>` : ''}</b><small>${sub}</small></span></button>`;
    }).join('');
  }
  $('devCards').addEventListener('click', (e) => {
    const b = e.target.closest('.dev-card');
    if (!b) return;
    S.device = b.dataset.d;
    retryFailedModels();
    syncProfileUI();
    requestRender();
  });

  // 对比：左右两个下拉直接选机型 / 状态，另有一键互换（原先的组合预设列表已去掉）
  $('swapSlots').addEventListener('click', () => {
    S.slots = [S.slots[1], S.slots[0]];
    retryFailedModels();
    syncProfileUI();
    requestRender();
  });

  function syncProfileUI() {
    stopFoldAnimation(true);
    $('secDevice').hidden = S.compare;
    $('secSlots').hidden = !S.compare;
    $('stereoGroup').hidden = !S.stereo;
    $('secFold').hidden = !hasDuo();
    syncFoldUI();
    [0, 1].forEach((i) => { $('slot' + i).value = S.slots[i]; });
    syncSeg('compare', S.stereo ? 2 : S.compare ? 1 : 0);
    document.body.classList.toggle('stereo', S.stereo);
    document.title = `可视角度仿真 · ${activeDevices().join(' vs ')}`;
    renderDevCards();
    renderSwatches();
    syncQuick();
    if (S.pattern) loadPattern(S.pattern);
  }
  const options = PROFILES.slice().sort((a, b) => rank(a.device) - rank(b.device) || a.privacy - b.privacy)
    .map((p) => `<option value="${p.id}">${profileLabel(p, true)}</option>`).join('');
  [0, 1].forEach((i) => {
    const sel = $('slot' + i);
    sel.innerHTML = options;
    sel.addEventListener('change', () => { S.slots[i] = sel.value; retryFailedModels(); syncProfileUI(); requestRender(); });
  });
  function syncFoldUI() {
    $('fold').value = Math.round(S.fold);
    $('foldV').textContent = Math.round(S.fold) + '°';
    const missing = DUO_PROFILES.filter((p) => !p.sets).map((p) => surfaceName(p.surface)).join('、');
    $('duoStatus').textContent = (missing ? `${missing}可视角数据待测，当前显示原图。` : '内屏、外屏均为可视角实测数据。') + (S.compare ? '对比时外屏按合上、内屏按展开显示。' : '');
  }
  let foldAnimation=null;
  function stopFoldAnimation(finishMix=false) {
    if(foldAnimation)cancelAnimationFrame(foldAnimation.raf);
    foldAnimation=null;
    if(finishMix&&surfaceMix!==(S.duoSurface==='outer'?1:0))setFold(S.fold);
  }
  function setFold(angle,animated=false) {
    stopFoldAnimation();
    stopSweep();
    const target=Math.min(180,Math.max(0,+angle)),toMix=S.duoSurface==='outer'?1:0;
    const apply=(value,mix)=>{S.fold=value;surfaceMix=mix;syncFoldUI();requestRender();};
    if(!animated)apply(target,surfaceMix);
    if(target===S.fold&&toMix===surfaceMix){apply(target,toMix);return;}
    const tween=foldAnimation={from:S.fold,fromMix:surfaceMix,t0:performance.now(),dur:animated?800:250,raf:0};
    const step=(now)=>{
      if(foldAnimation!==tween)return;
      const k=Math.min(1,(now-tween.t0)/tween.dur),e=k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2;
      apply(tween.from+(target-tween.from)*e,tween.fromMix+(toMix-tween.fromMix)*e);
      if(k<1)tween.raf=requestAnimationFrame(step);else foldAnimation=null;
    };
    tween.raf=requestAnimationFrame(step);
  }
  /** Duo：合上看外屏 / 展开看内屏（平滑折叠，可中途反向）。 */
  function setDuoSurface(v) { S.duoSurface = v; syncProfileUI(); setFold(v === 'outer' ? 0 : 180, true); }
  /** 0 单台 / 1 双机对比 / 2 双眼立体。 */
  function setCompareMode(v) { S.compare = v === 1; S.stereo = v === 2; retryFailedModels(); syncProfileUI(); requestRender(); }
  // 展开角度滑条：0° 即合上、看外屏；拉开后看内屏（拖动时实时跟手，过 0° 时平滑切换朝向）
  $('fold').addEventListener('input', (e) => {
    const v = +e.target.value, want = v <= 2 ? 'outer' : 'inner';
    stopSweep();
    if (want !== S.duoSurface) { S.duoSurface = want; syncProfileUI(); }
    setFold(want === 'outer' ? 0 : v);   // 拉到底即完全合上
  });
  bindSeg('compare', (v) => setCompareMode(+v));

  // ---------- 画面上的快捷切换条 + 机型选择 ----------
  /** 快捷条上的短名：“小米 18 Pro Max”“iPhone GH3 防窥膜”“iPhone Duo 外屏”。 */
  function chipName(p) {
    const k = specKey(p.device) || p.device, suffix = p.device.slice(k.length).trim();
    const name = S.compare ? [shortName(p.device), suffix].filter(Boolean).join(' ') : p.device;
    const st = p.surface ? surfaceName(p.surface) : hasPrivacy(p.device) && p.privacy ? privacyText(p.device).short : '';
    return S.compare && st ? `${name} ${st}` : name;
  }
  function syncQuick() {
    const qb = $('quickbar'), ids = activeIds();
    qb.hidden = S.clean;
    $('devDots').innerHTML = ids.map((id, i) => `<i style="--c:${S.compare ? SERIES[i] : colorOf(byId(id).device).swatch}"></i>`).join('');
    $('devName').textContent = ids.map((id) => chipName(byId(id))).join(' vs ');
    // iOS 风格开关：Duo 为“展开”（关 = 合上看外屏），带防窥的机型为防窥 / 贴膜
    const duo = !S.compare && S.device === 'iPhone Duo', priv = !S.compare && !duo && hasPrivacy(S.device);
    const on = duo ? S.duoSurface === 'inner' : priv && !!(variant(S.device, S.privacy) || {}).privacy;
    const sw = $('qcSwitch');
    sw.hidden = !(duo || priv);
    sw.setAttribute('aria-checked', String(on));
    $('qcLbl').textContent = duo ? (on ? '展开 · 内屏' : '合上 · 外屏') : priv ? privacyText(S.device).switch : '';
    $('qcFold').hidden = !duo;
    qb.classList.toggle('duo', duo);
    qb.classList.toggle('solo', !duo && !priv);
    if (!$('picker').hidden) { renderPicker(); requestAnimationFrame(placePicker); }   // 机型名变长变短时弹出框跟着对齐
  }
  $('qcSwitch').addEventListener('click', () => {
    stopSweep();
    if (!S.compare && S.device === 'iPhone Duo') { setDuoSurface(S.duoSurface === 'inner' ? 'outer' : 'inner'); return; }
    if (!hasPrivacy(S.device)) return;
    S.privacy = !(variant(S.device, S.privacy) || {}).privacy;
    syncProfileUI();
    requestRender();
    toast(profileLabel(byId(activeIds()[0])));
  });

  // 机型选择：手机上是底部弹层，电脑上是快捷条上方的弹出框
  let pickSide = 1;
  function openPicker(on) {
    $('picker').hidden = !on;
    $('scrim').hidden = !on;
    $('devChip').setAttribute('aria-expanded', String(on));
    if (on) { renderPicker(); placePicker(); }
  }
  function placePicker() {
    const pk = $('picker');
    if (pk.hidden) return;
    if (document.body.dataset.layout === 'sheet') { pk.style.left = pk.style.bottom = ''; return; }
    const rc = $('devChip').getBoundingClientRect(), w = pk.offsetWidth;
    pk.style.left = Math.min(Math.max(rc.left + rc.width / 2 - w / 2, 12), innerWidth - w - 12) + 'px';
    pk.style.bottom = innerHeight - rc.top + 10 + 'px';
  }
  function devSub(d) {
    const t = privacyText(d);
    // 状态已在右侧分段里列出，这里只说明数据情况
    return d === 'iPhone Duo' ? (DUO_PROFILES.some((p) => !p.sets) ? '内屏 / 外屏 · 数据待测' : '内屏 / 外屏 · 实测数据')
      : hasPrivacy(d) ? `两组实测 · ${t.short}前后` : '一组实测';
  }
  function renderPicker() {
    const cmp = S.compare;
    $('pickSide').hidden = !cmp;
    syncSeg('pickSide', pickSide);
    $('pickCompare').checked = cmp;
    $('pickCompareHint').textContent = cmp ? '先选左侧 / 右侧，再点机型' : '再选一台放在右边';
    const cur = byId(cmp ? S.slots[pickSide] : activeIds()[0]);
    $('pickList').innerHTML = DEVICES.map((d) => {
      const k = specKey(d) || d, suffix = d.slice(k.length).trim(), on = cur.device === d;
      const opts = d === 'iPhone Duo' ? DUO_PROFILES.map((p) => [p.id, surfaceName(p.surface)])
        : hasPrivacy(d) ? [false, true].map((pv) => [variant(d, pv).id, privacyText(d)[pv ? 'on' : 'off']]) : [];
      const main = on ? cur : d === 'iPhone Duo' ? byId(`duo-${cmp ? 'inner' : S.duoSurface}`) : variant(d, cur.privacy) || pick(d);
      const seg = opts.length ? `<div class="seg mini pk-state">${opts.map(([id, label]) =>
        `<button data-id="${id}" class="${on && cur.id === id ? 'on' : ''}">${label}</button>`).join('')}</div>` : '';
      return `<div class="pk-row${on ? ' on' : ''}"><button class="pk-main" data-id="${main.id}">` +
        `<span class="ph" style="--c1:${colorOf(d).swatch}"></span>` +
        `<span class="pk-txt"><b>${k}${suffix ? `<span class="badge">${suffix}</span>` : ''}</b><small>${devSub(d)}</small></span></button>${seg}</div>`;
    }).join('');
  }
  function chooseProfile(id) {
    const p = byId(id);
    stopSweep();
    if (S.compare) { S.slots[pickSide] = id; retryFailedModels(); syncProfileUI(); requestRender(); return; }
    S.device = p.device;
    retryFailedModels();
    if (p.surface) { setDuoSurface(p.surface); return; }
    S.privacy = p.privacy;
    syncProfileUI();
    requestRender();
  }
  $('devChip').addEventListener('click', () => openPicker($('picker').hidden));
  $('scrim').addEventListener('click', () => openPicker(false));
  $('pickerClose').addEventListener('click', () => openPicker(false));
  $('pickList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    chooseProfile(b.dataset.id);
    if (S.compare) renderPicker(); else openPicker(false);
  });
  bindSeg('pickSide', (v) => { pickSide = +v; renderPicker(); });
  $('pickCompare').addEventListener('change', (e) => {
    if (e.target.checked) {
      const cur = activeIds()[0], dv = byId(cur).device;
      const other = S.slots.find((id) => byId(id).device !== dv) || pick(DEVICES.find((d) => d !== dv)).id;
      S.slots = [cur, other];
      pickSide = 1;
      setCompareMode(1);
    } else {
      const left = S.slots[0];
      setCompareMode(0);
      chooseProfile(left);   // 回到单台时沿用左侧那台
    }
    renderPicker();
  });

  bindSeg('stereoView', (v) => { S.cross = v === '1'; requestRender(); });
  $('size').addEventListener('input', (e) => { S.size = e.target.value / 100; $('sizeV').textContent = e.target.value + '%'; requestRender(); });
  $('gap').addEventListener('input', (e) => { S.gap = +e.target.value; $('gapV').textContent = S.gap + ' px'; requestRender(); });
  $('ipd').addEventListener('input', (e) => { S.ipd = +e.target.value; $('ipdV').textContent = S.ipd + ' mm'; requestRender(); });

  /** 测试画面按当前（对比时为左侧）机型的屏幕分辨率生成。 */
  let patternKey = '';
  function loadPattern(name, force) {
    const p = byId(activeIds()[0]), spec = specOf(p.device);
    const sc = p.surface ? spec.screens[p.surface] : spec.screen;
    const w = S.rot === 90 ? sc.resH : sc.resW, h = S.rot === 90 ? sc.resW : sc.resH;
    const ordinary=activeIds().map(byId).find((profile)=>!profile.surface);
    const normalScreen=ordinary?specOf(ordinary.device).screen:null;
    const nw=normalScreen?(S.rot===90?normalScreen.resH:normalScreen.resW):0,nh=normalScreen?(S.rot===90?normalScreen.resW:normalScreen.resH):0;
    const key = `${name}:${w}x${h}:${hasDuo()?'duo':''}:${nw}x${nh}`;
    S.pattern = name;
    document.querySelectorAll('#patterns [data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === name));
    document.querySelector('#patterns .upload').classList.remove('on');
    if (key === patternKey && !force) return;
    patternKey = key;
    Object.values(duoPatterns).forEach((p)=>gl.deleteTexture(p.tex));
    for(const surface of Object.keys(duoPatterns))delete duoPatterns[surface];
    if(hasDuo()){
      for(const [surface,screen] of Object.entries(SPECS['iPhone Duo'].screens)){
        const rw=S.rot===90?screen.resH:screen.resW,rh=S.rot===90?screen.resW:screen.resH;
        const tex=gl.createTexture(),src=Patterns.make(name,rw,rh,`duo-${surface}`);
        duoPatterns[surface]={tex,image:uploadImage(tex,src)};
      }
    }
    if(ordinary)setImage(Patterns.make(name,nw,nh));
    else{image=duoPatterns[p.surface].image;requestRender();}
  }
  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    // WebGL 上传 ImageBitmap 时忽略 UNPACK_FLIP_Y，先转成 canvas 以与其他画面方向一致
    const bmp = await createImageBitmap(file);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    S.pattern = null;
    patternKey = '';
    document.querySelectorAll('#patterns [data-p]').forEach((b) => b.classList.remove('on'));
    document.querySelector('#patterns .upload').classList.add('on');
    setImage(cv);
    toast(`已载入 ${file.name || '图片'}`);
  }
  $('patterns').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) loadPattern(b.dataset.p); });
  $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragfile'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragfile'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragfile');
    loadFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('paste', (e) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  // ---------- 地址栏保存状态（便于收藏 / 分享同一个画面） ----------
  let hashTimer = 0, hashReady = false;
  function writeHash() {
    if (!hashReady) return;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const q = new URLSearchParams();
      q.set('dev', DEVICES.indexOf(S.device));
      if (S.privacy) q.set('pv', 1);
      if (S.compare || S.stereo) q.set('cmp', S.stereo ? 2 : 1);
      if (S.compare) q.set('ab', S.slots.join(','));
      q.set('t', Math.round(S.theta * 10) / 10);
      q.set('p', Math.round(S.psi));
      q.set('d', Math.round(S.dist / 10));
      if (S.pattern && S.pattern !== 'ui') q.set('img', S.pattern);
      if (S.mode) q.set('m', S.mode);
      if (S.rot) q.set('rot', S.rot);
      if (hasDuo()) { q.set('fold', S.fold); q.set('ds', S.duoSurface); }
      if (S.padMetric !== 'lum') q.set('k', S.padMetric);
      if (S.pal !== 'jet') q.set('pal', S.pal);
      if (appMode === 'scene') q.set('mode', '3d');
      try { history.replaceState(null, '', '#' + q.toString()); } catch (err) { /* file:// 下个别浏览器不允许 */ }
    }, 300);
  }
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    const num = (k, d) => (q.has(k) && isFinite(+q.get(k)) ? +q.get(k) : d);
    const di = num('dev', Math.max(DEVICES.indexOf('iPhone Duo'), 0));
    if (DEVICES[di]) S.device = DEVICES[di];
    S.privacy = num('pv', 0) === 1;
    const cmp = num('cmp', 0);
    S.compare = cmp === 1; S.stereo = cmp === 2;
    const ab = (q.get('ab') || '').split(',');
    if (ab.length === 2 && ab.every(byId)) S.slots = ab;
    S.dist = Math.min(Math.max(num('d', 30), 10), 100) * 10;
    if (q.has('img') && /^(ui|dark|read|white|rgbw|checker|gray)$/.test(q.get('img'))) S.pattern = q.get('img');
    S.mode = [0, 1, 2].includes(num('m', 0)) ? num('m', 0) : 0;
    S.rot = num('rot', 0) === 90 ? 90 : 0;
    S.fold = Math.min(180, Math.max(0, num('fold', 180)));
    S.duoSurface = q.get('ds') === 'outer' ? 'outer' : 'inner';
    surfaceMix=S.duoSurface==='outer'?1:0;
    if (q.get('k') === 'jncd') S.padMetric = 'jncd';
    if (Viz.PALETTES[q.get('pal')]) S.pal = q.get('pal');
    appMode = /^(3d|scene)$/.test(q.get('mode') || '') ? 'scene' : 'sim';
    setView(num('t', 0), num('p', 0));
    syncSeg('mode', S.mode); syncSeg('orient', S.rot); syncSeg('padMetric', S.padMetric);
  }

  // ---------- 模式：屏幕仿真（默认，本页原有工具）/ 场景演示（三维，scene3d.js，做动画用，从“画面 → 更多”进入） ----------
  let appMode = 'sim', scene3d = null, scene3dLoading = null;
  const S3D_VER = 14;
  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('无法加载 ' + src));
    document.body.appendChild(s);
  });
  // 三维场景的脚本（约 1.7 MB）只在第一次进入场景演示时加载
  const loadScene3D = () => (window.Scene3D ? Promise.resolve()
    : loadScript('scene3d-person.js?v=' + S3D_VER).then(() => loadScript('scene3d.js?v=' + S3D_VER)));
  function setAppMode(m) {
    appMode = m;
    document.body.classList.toggle('mode-3d', m === 'scene');
    syncSeg('appMode', m);
    if (m === 'scene') {
      stopFoldAnimation();
      surfaceMix = S.duoSurface === 'outer' ? 1 : 0;
      stopSweep();
      if (scene3d) scene3d.resume();
      else if (!scene3dLoading) {
        $('scene3d').classList.add('loading');
        // 加载失败（或浏览器不支持 WebGL2）时退回屏幕仿真
        scene3dLoading = loadScene3D().then(() => window.Scene3D.mount($('scene3d'), { device: specOf(S.device).model, fold: S.fold, duoSurface: S.duoSurface }))
          .then((a) => { scene3d = a; window.scene3d = a; $('scene3d').classList.remove('loading'); })
          .catch((err) => { console.error(err); scene3dLoading = null; $('scene3d').classList.remove('loading'); toast('三维场景加载失败，已切回屏幕仿真'); setAppMode('sim'); });
      }
    } else {
      if (scene3d) scene3d.pause();
      requestRender();
    }
    writeHash();
  }
  bindSeg('appMode', (v) => setAppMode(v));
  $('open3d').addEventListener('click', () => setAppMode('scene'));

  // ---------- 启动 ----------
  window.addEventListener('resize', resize);
  readHash();
  setDist(S.dist / 10);
  syncProfileUI();
  Patterns.ready.then(() => { if (S.pattern) loadPattern(S.pattern, true); });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => { pad.draw(); charts.render(); });
    ro.observe($('pad')); ro.observe($('charts'));
  }
  resize();
  hashReady = true;
  setAppMode(appMode);

  // 调试 / 截图用
  window.viewAngle = { S, setView, animateTo, setClean, setDist, setFold, getModel, render: () => render() };
})();
