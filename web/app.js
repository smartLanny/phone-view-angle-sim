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

  const PROFILES = DATA.profiles;
  const DEVICES = [...new Set(PROFILES.map((p) => p.device))].sort((a, b) => rank(a) - rank(b));
  const byId = (id) => PROFILES.find((p) => p.id === id);
  const variant = (device, privacy) => PROFILES.find((p) => p.device === device && p.privacy === privacy);
  const hasPrivacy = (device) => !!variant(device, true) && !!variant(device, false);
  const pick = (device) => variant(device, false) || variant(device, true);
  const shortName = (device) => device.split(' ')[0];
  /** 图例用短名：“小米 · 防窥关闭”“iPhone GH3 · 未贴膜”。 */
  function shortLabel(p) {
    const k = specKey(p.device) || p.device, suffix = p.device.slice(k.length).trim();
    const name = [shortName(p.device), suffix].filter(Boolean).join(' ');
    return hasPrivacy(p.device) ? `${name} · ${privacyText(p.device)[p.privacy ? 'on' : 'off']}` : name;
  }

  const S = {
    dist: 300, tilt: [0, 0], theta: 0, psi: 0, rot: 0, mode: 0, pattern: 'ui', colors: {},
    compare: false, device: DEVICES[0], privacy: false,
    stereo: false, cross: false, ipd: 63, gap: 8, size: 1,
    slots: DEVICES.length > 1
      ? [pick(DEVICES[0]).id, pick(DEVICES[1]).id]
      : [PROFILES[0].id, (PROFILES[1] || PROFILES[0]).id],
    padMetric: 'lum', pal: 'jet', tab: 'view', clean: false, sweep: null,
  };

  // 缺失方位用上下镜像补全（见 model.js 'vmirror'）
  const models = {};
  const getModel = (id) => models[id] ||
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
    const m = getModel(id), lut = getLUT(id), w = lut.width;
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
    if (!hasPrivacy(p.device)) return p.device;
    const t = privacyText(p.device), mode = p.privacy ? t.on : t.off;
    return withDevice ? `${p.device} · ${mode}` : mode;
  }
  function activeIds() {
    if (S.compare) return S.slots;
    const p = variant(S.device, S.privacy) || variant(S.device, !S.privacy);
    return [p.id];
  }
  const activeDevices = () => [...new Set(activeIds().map((id) => byId(id).device))];
  function colorOf(device) {
    const cs = specOf(device).colors;
    return cs.find((c) => c.id === S.colors[device]) || cs[0];
  }

  // ---------- 几何 ----------
  /** 每个机型的机身网格、屏幕尺寸与包围盒，按需构建并缓存。 */
  const devCache = {};
  function dev(name) {
    if (devCache[name]) return devCache[name];
    const spec = specOf(name);
    const phone = Phone3D.build(spec.body);
    const P = phone.spec, sc = spec.screen;
    const ratio = sc.resH / sc.resW;
    const w = (sc.diag * 25.4) / Math.sqrt(1 + ratio * ratio);
    const corners = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, -P.T]) corners.push([sx * P.W / 2, sy * P.H / 2, z]);
    return (devCache[name] = {
      name, spec, corners,
      screenHalf: [w / 2, (w * ratio) / 2],
      body: meshVAO(bodyProg, phone.body, true),
      screen: meshVAO(screenProg, phone.screen, false),
    });
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

  // 投影: 眼睛位于 (0,0,D)（双眼立体时为 (∓瞳距/2,0,D)）看向屏幕中心；缩放使手机始终完整可见。

  // 投影: 眼睛位于 (0,0,D)（双眼立体时为 (∓瞳距/2,0,D)）看向屏幕中心；缩放使手机始终完整可见。
  let views = [];
  /** 左右眼的世界坐标（mm）。 */
  const eyePos = (side) => [side * S.ipd / 2, 0, S.dist];

  /** 舞台可用区域（去掉左右栏 / 底部抽屉 / 左上角读数）。 */
  function stageRect() {
    const W = canvas.clientWidth, H = canvas.clientHeight, L = document.body.dataset.layout;
    const rc = (id) => $(id).getBoundingClientRect();
    if (S.clean) return { x0: 0, x1: W, top: rc('hud').bottom + 8, bottom: H - 12 };
    if (L === 'wide') return { x0: rc('rail').right + 12, x1: rc('panel').left - 12, top: 20, bottom: H - 16 };
    if (L === 'side') return { x0: 0, x1: rc('panel').left - 8, top: rc('hud').bottom + 8, bottom: H - 16 };
    return { x0: 0, x1: W, top: rc('hud').bottom + 4, bottom: rc('panel').top - 6 };
  }

  /**
   * 每台手机一个区域（对比时左右并排），共用同一缩放以便公平对比。
   * 双眼立体时为同一台手机的左右眼两个区域，按高度撑满、中间间隙为 S.gap；交叉视时左右对调。
   */
  function computeViews(devs) {
    const n = devs.length;
    const boxCorners = devs.flatMap((d) => d.corners);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const R = stageRect();
    const sheet = document.body.dataset.layout === 'sheet';
    // 数据卡高度按上一帧实测（随布局 / 字号变化），首帧用估计值
    const capEl = $('cap0');
    const capH = (capEl.offsetHeight || (S.stereo ? 86 : sheet ? 64 : 76)) + 14;
    const top = R.top;
    const avail = Math.max(R.bottom - capH - top, 140);
    const areaX0 = R.x0, areaW = Math.max(R.x1 - R.x0, 200);
    const sides = S.stereo ? (S.cross ? [1, -1] : [-1, 1]) : devs.map(() => 0);
    const gap = S.stereo ? S.gap : 0;
    const colMax = S.stereo ? (areaW - gap) / 2 : areaW / n;
    const halfW = colMax / 2 - (S.stereo ? 10 : 16), halfH = avail / 2;
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
    let f = Math.max(fEnv, extent(flat) * 0.75);
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

  const BODY_VS = `#version 300 es
  in vec3 aPos;
  in vec3 aNor;
  in float aMat;
  out vec3 vN;
  out vec3 vW;
  flat out int vMat;
  ${COMMON_VS}
  void main() {
    vW = uModel * aPos;
    vN = uModel * aNor;
    vMat = int(aMat + 0.5);
    gl_Position = project(vW);
  }`;

  const BODY_FS = `#version 300 es
  precision highp float;
  in vec3 vN;
  in vec3 vW;
  flat in int vMat;
  out vec4 outColor;
  uniform vec3 uEye;
  uniform vec3 uFrame, uBack;
  uniform float uRough;
  ${COLOR_GLSL}

  // 摄影棚：上方大柔光箱 + 右侧灯条 + 左侧轮廓光，外加上亮下暗的环境渐变。
  vec3 sky(vec3 d) {
    return mix(vec3(0.03, 0.033, 0.04), vec3(0.30, 0.31, 0.34), smoothstep(-0.6, 0.9, d.y));
  }
  // 镜面玻璃用的清晰环境（相机镜片）
  vec3 envSharp(vec3 r) {
    vec3 c = sky(r);
    c += vec3(3.2) * smoothstep(0.90, 0.985, dot(r, normalize(vec3(-0.35, 0.8, 0.5))));
    c += vec3(1.6) * smoothstep(0.93, 0.99, dot(r, normalize(vec3(0.9, 0.1, 0.45))));
    c += vec3(0.9) * smoothstep(0.93, 0.99, dot(r, normalize(vec3(-0.95, -0.15, 0.3))));
    return c;
  }

  // GGX 微表面高光（灯光按有尺寸的柔光源处理，粗糙度下限避免针尖高光）
  vec3 ggx(vec3 N, vec3 V, vec3 L, float a, vec3 F0) {
    vec3 H = normalize(L + V);
    float nl = max(dot(N, L), 0.0), nv = max(dot(N, V), 1e-3);
    float nh = max(dot(N, H), 0.0), vh = max(dot(V, H), 0.0);
    float a2 = a * a, d = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159 * d * d);
    float k = a * 0.5;
    float G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);
    return D * G * F / (4.0 * nv) ;
  }

  // coat: 表面透明层（阳极氧化膜 / 玻璃）的 4% 白色反射
  vec3 lights(vec3 N, vec3 V, float a, vec3 F0, vec3 diff, float coat) {
    vec3 L[3] = vec3[3](normalize(vec3(-0.35, 0.8, 0.5)), normalize(vec3(0.9, 0.1, 0.45)), normalize(vec3(-0.95, -0.15, 0.3)));
    float I[3] = float[3](1.7, 0.9, 0.5);
    vec3 c = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float nl = max(dot(N, L[i]), 0.0);
      c += I[i] * (ggx(N, V, L[i], a, F0) + coat * ggx(N, V, L[i], a, vec3(0.04)) + diff * nl / 3.14159);
    }
    return c;
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(uEye - vW);
    vec3 R = reflect(-V, N);
    float nv = clamp(dot(N, V), 0.0, 1.0);
    vec3 col;
    if (vMat == 0 || vMat == 3 || vMat == 1) {
      // 喷砂阳极氧化铝: 金属高光带本色、粗糙度高；氧化层染色带一点漫反射。
      // 背板为同色磨砂玻璃: 非金属，漫反射为主，高光弱而宽。
      bool metal = vMat != 1;
      vec3 base = metal ? uFrame : uBack;
      float rough = metal ? uRough : max(uRough - 0.1, 0.3);
      float a = max(rough * rough, 0.06);
      vec3 F0 = metal ? base : vec3(0.04);
      vec3 diff = metal ? base * 0.12 : base * 0.75;
      float fg = pow(1.0 - nv, 5.0) * (1.0 - rough);
      vec3 Fe = F0 + (1.0 - F0) * fg * 0.5;
      vec3 skyR = sky(normalize(mix(R, N, rough * 0.7)));
      col = lights(N, V, a, F0, diff, metal ? 1.0 : 0.0)
          + Fe * skyR * 0.7
          + (metal ? vec3(0.04 + fg * 0.3) * skyR * 0.5 : vec3(0.0))
          + diff * sky(N) * 0.6;
    } else {
      float fr = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
      col = vec3(0.01) * (0.2 + 0.7 * max(dot(N, normalize(vec3(-0.35, 0.8, 0.5))), 0.0)) + envSharp(R) * fr;
    }
    col = col / (1.0 + 0.2 * col);
    outColor = vec4(lin2srgb(col), 1.0);
  }`;

  const SCREEN_VS = `#version 300 es
  in vec3 aPos;
  out vec2 vLocal;
  out vec3 vWorld;
  ${COMMON_VS}
  void main() {
    vLocal = aPos.xy;
    vWorld = uModel * aPos;
    gl_Position = project(vWorld);
  }`;

  const SCREEN_FS = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;
  in vec2 vLocal;
  in vec3 vWorld;
  out vec4 outColor;

  uniform sampler2D uImg;
  uniform sampler2D uLut;
  uniform int uLutW;
  uniform mat3 uModel;
  uniform vec3 uEye;
  uniform vec2 uScreenHalf, uDispMM, uImgScale;
  uniform vec3 uCut;
  uniform float uCorner, uRot;
  uniform int uMode;
  uniform sampler2D uPal;   // 256×1 色表（热力图配色，与方向盘一致）
  uniform int uBands;       // >0 时分级显示
  uniform bool uPalFlip;
  ${COLOR_GLSL}

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

  void main() {
    vec2 pp = vLocal;
    float px = length(fwidth(pp));
    float screen = 1.0 - smoothstep(-px, 0.0, sdRoundBox(pp, uScreenHalf, uCorner));

    vec3 d = transpose(uModel) * (uEye - vWorld);
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
    scr *= smoothstep(uCut.z, uCut.z + px, length(q));

    outColor = vec4(mix(vec3(0.004), scr, screen), 1.0);
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
  const screenProg = program(SCREEN_VS, SCREEN_FS);

  function meshVAO(prog, mesh, withNormals) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attr = (name, data, size) => {
      const loc = gl.getAttribLocation(prog.p, name);
      if (loc < 0) return;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', mesh.pos, 3);
    if (withNormals) { attr('aNor', mesh.nor, 3); attr('aMat', mesh.mat, 1); }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.idx.length };
  }
  gl.useProgram(screenProg.p);
  gl.uniform1i(screenProg.u.uImg, 0);
  gl.uniform1i(screenProg.u.uLut, 1);

  const lutTex = {};
  function bindLUT(id) {
    gl.activeTexture(gl.TEXTURE1);
    if (lutTex[id]) { gl.bindTexture(gl.TEXTURE_2D, lutTex[id].tex); return lutTex[id].width; }
    const lut = getLUT(id);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, lut.width, lut.height, 0, gl.RGBA, gl.FLOAT, lut.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    lutTex[id] = { tex, width: lut.width };
    return lut.width;
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
  function setImage(src) {
    const maxSide = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
    const k = Math.min(1, maxSide / Math.max(src.width, src.height));
    if (k < 1) {
      const cv = document.createElement('canvas');
      cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
      cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
      src = cv;
    }
    image = src;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    requestRender();
  }

  /** 按“铺满”方式把图片映射到屏幕：返回 uv 缩放。 */
  function imgScale(d) {
    const [dw, dh] = dispMM(d);
    const ia = image ? image.width / image.height : dw / dh, da = dw / dh;
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
    const near = Math.max(v.D - 100, 1), far = v.D + 100;
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
    computeViews(ids.map((id) => dev(byId(id).device)));
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
      gl.bindVertexArray(v.dev.body.vao);
      setCommon(bodyProg, M, v);
      gl.drawElements(gl.TRIANGLES, v.dev.body.count, gl.UNSIGNED_INT, 0);
    }

    gl.useProgram(screenProg.p);
    gl.uniform1f(screenProg.u.uRot, S.rot);
    gl.uniform1i(screenProg.u.uMode, S.mode);
    const P = Viz.palette(S.pal);
    gl.uniform1i(screenProg.u.uBands, P.banded ? 7 : 0);
    gl.uniform1i(screenProg.u.uPalFlip, P.flipAngle ? 1 : 0);
    views.forEach((v, i) => {
      clip(v);
      const d = v.dev, cut = d.spec.cutout;
      gl.uniform2fv(screenProg.u.uScreenHalf, d.screenHalf);
      gl.uniform1f(screenProg.u.uCorner, d.spec.screen.corner);
      gl.uniform3f(screenProg.u.uCut, cut.y, cut.half, cut.r);
      gl.uniform2fv(screenProg.u.uDispMM, dispMM(d));
      gl.uniform2fv(screenProg.u.uImgScale, imgScale(d));
      gl.uniform1i(screenProg.u.uLutW, bindLUT(ids[i]));
      gl.bindVertexArray(d.screen.vao);
      setCommon(screenProg, M, v);
      gl.drawElements(gl.TRIANGLES, d.screen.count, gl.UNSIGNED_INT, 0);
    });
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);

    updateReadout(M, ids);
    if (hover) updateTip();
    writeHash();
  }

  // ---------- 信息显示 ----------
  /** 屏幕局部坐标 p 处左右眼（局部坐标 L、R）所见白场的差异；参考白取两眼白场平均，不依赖 0° 基准。 */
  function binoAt(m, L, R, p) {
    const a = anglesOf([L[0] - p[0], L[1] - p[1], L[2] - p[2]]);
    const b = anglesOf([R[0] - p[0], R[1] - p[1], R[2] - p[2]]);
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
    const m = getModel(id), [hx, hy] = dev(byId(id).device).screenHalf;
    const L = applyT(M, eyePos(-1)), R = applyT(M, eyePos(1));
    const acc = { dl: 0, j: 0, de: 0 };
    for (let iy = 0; iy < 9; iy++) for (let ix = 0; ix < 5; ix++) {
      const r = binoAt(m, L, R, [((ix + 0.5) / 5 * 2 - 1) * hx, ((iy + 0.5) / 9 * 2 - 1) * hy, 0]);
      acc.dl += r.dl / 45; acc.j += r.j / 45; acc.de += r.de / 45;
    }
    return acc;
  }

  function placeCaption(el, v, html) {
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    el.classList.toggle('stereo', S.stereo);
    el.style.width = S.stereo ? v.w - 20 + 'px' : '';
    el.style.display = 'block';
    el.style.left = v.cx + 'px';
    el.style.top = v.bottomY + 8 + 'px';
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
    return `<div class="cap-name">${key}${p.device}${st}</div>`;
  }

  /** 屏幕中心对应的 (θ, ψ手机坐标)；θ≈0 时沿用当前方向，保证曲线方向稳定。 */
  const psiLocal = () => AngleModel.norm360(S.psi + S.rot);

  function updateReadout(M, ids) {
    $('distV').textContent = Math.round(S.dist / 10) + ' cm';
    $('heroTheta').textContent = Math.round(S.theta) + '°';
    $('heroDir').textContent = S.theta < 0.5 ? '正对屏幕' : `从${Viz.dirName(S.psi)}看`;
    $('heroSub').textContent = `屏幕中心离轴角 · 观看距离 ${Math.round(S.dist / 10)} cm`;
    $('legend').classList.toggle('show', S.mode === 2);
    updatePad(M);
    updateCharts();

    if (S.stereo) {
      const b = binoStats(M, ids[0]);
      const html = capName(byId(ids[0]), 0) +
        `<div class="cap-stats">${stat(b.dl.toFixed(1), '%', '双眼亮度差')}${stat(b.j.toFixed(2), 'JNCD', '双眼色度差')}${stat(b.de.toFixed(1), '', '双眼 ΔE2000')}</div>` +
        `<div class="note">全屏平均${S.mode === 2 ? ' · 颜色为离轴角 0–70°' : ''}</div>`;
      [0, 1].forEach((i) => placeCaption($('cap' + i), views[i], html));
      return;
    }

    const c = anglesOf(applyT(M, [0, 0, S.dist]));
    const psi = c.theta < 0.01 ? psiLocal() : c.psi;
    [0, 1].forEach((i) => {
      const el = $('cap' + i), v = views[i];
      if (!v) { el.style.display = 'none'; return; }
      const e = getModel(ids[i]).evalAt(c.theta, psi);
      placeCaption(el, v, capName(byId(ids[i]), i) +
        `<div class="cap-stats">${stat(Math.round(e.yRatio * 100), '%', '亮度')}${stat(e.jncd.toFixed(1), 'JNCD', '色偏')}${stat(e.de00.toFixed(1), '', 'ΔE2000')}</div>`);
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
    const v = g[S.padMetric](h.theta, h.psi + S.rot);
    padRead.innerHTML = `${who}<span class="dim">${padHover ? '指针处' : '当前'}</span> ${where} · <b>${mf.fmt(v)}</b>`;
  }

  function updatePad(M) {
    const id = activeIds()[0], m = getModel(id), g = getGrid(id), mf = metricFmt[S.padMetric];
    applyPalette();
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
    $('padNote').hidden = !hatch.length;
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
    const series = ids.map((id, i) => Object.assign({ label: shortLabel(byId(id)), color: SERIES[i] }, seriesFor(id, psi)));
    $('curveDir').textContent = `沿${S.theta < 0.5 ? '右侧' : Viz.dirName(S.psi)}方向 · 屏幕中心`;
    const leg = series.length > 1
      ? series.map((s) => `<span><i style="--k:${s.color}"></i>${s.label}</span>`).join('') : '';
    if ($('curveLegend')._html !== leg) { $('curveLegend').innerHTML = leg; $('curveLegend')._html = leg; }
    charts.update({ series, cursor: S.theta, jMax: JMAX, lMax: Math.max(100, Math.ceil(RANGE.lum * 10) * 10), ph: window.innerHeight < 820 ? 42 : 58 });
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
    syncThetaChips();
    requestRender();
  }
  /** 拖动画面时直接改手机姿态，再反算眼睛方向。 */
  function setTilt(tx, ty) {
    const mag = Math.hypot(tx, ty);
    if (mag > MAX_TILT) { tx *= MAX_TILT / mag; ty *= MAX_TILT / mag; }
    S.tilt = [tx, ty];
    S.theta = Math.min(mag, MAX_TILT);
    if (mag > 0.05) S.psi = AngleModel.norm360(Math.atan2(-ty, -tx) / DEG);
    syncThetaChips();
    requestRender();
  }
  function syncThetaChips() {
    document.querySelectorAll('#thetaChips button').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.t - S.theta) < 0.5));
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
  function applyLayout() {
    const W = window.innerWidth, H = window.innerHeight;
    const L = W >= 1180 && H >= 600 ? 'wide' : W > 760 ? 'side' : 'sheet';
    const body = document.body;
    body.dataset.layout = L;
    const hud = $('hud'), rail = $('rail'), pb = $('panelBody');
    if (L === 'wide' && !S.clean) {
      if (hud.parentElement !== rail) rail.prepend(hud);
      SECS.forEach((s) => (s.dataset.tab === 'view' && s.dataset.wide !== 'panel' ? rail : pb).appendChild(s));
      pb.insertBefore($('secDist'), $('secHelp'));
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
    if (!b) {   // 点抽屉把手：收起 / 展开
      if (document.body.dataset.layout === 'sheet') { document.body.classList.toggle('sheet-min'); requestRender(); }
      return;
    }
    const sheet = document.body.dataset.layout === 'sheet';
    if (sheet && b.dataset.tab === S.tab) document.body.classList.toggle('sheet-min');
    else document.body.classList.remove('sheet-min');
    S.tab = b.dataset.tab;
    applyTab();
    $('panelBody').scrollTop = 0;
    requestAnimationFrame(() => { pad.draw(); charts.render(); requestRender(); });
  });
  function setClean(on) {
    S.clean = on;
    document.body.classList.toggle('clean', on);
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
  $('thetaChips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    stopSweep();
    animateTo(+b.dataset.t, S.psi);
  });

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
      const sub = hasPrivacy(d) ? `${t.off} / ${t.on} 两组实测` : '一组实测';
      return `<button class="dev-card${d === S.device ? ' on' : ''}" data-d="${d}">` +
        `<span class="ph" style="--c1:${colorOf(d).swatch}"></span>` +
        `<span><b>${k}${suffix ? `<span class="badge" title="屏幕版本">${suffix}</span>` : ''}</b><small>${sub}</small></span></button>`;
    }).join('');
  }
  $('devCards').addEventListener('click', (e) => {
    const b = e.target.closest('.dev-card');
    if (!b) return;
    S.device = b.dataset.d;
    syncProfileUI();
    requestRender();
  });

  // 对比的快捷组合：两台机型之间、同一机型防窥前后
  const PRESETS = (() => {
    const out = [];
    for (let i = 0; i < DEVICES.length; i++) for (let j = i + 1; j < DEVICES.length; j++) {
      out.push({ label: `${shortName(DEVICES[i])} vs ${shortName(DEVICES[j])}`, slots: [pick(DEVICES[i]).id, pick(DEVICES[j]).id] });
    }
    for (const d of DEVICES) {
      if (!hasPrivacy(d)) continue;
      out.push({ label: `${shortName(d)} ${privacyText(d).short}前后`, slots: [variant(d, false).id, variant(d, true).id] });
    }
    for (let i = 0; i < DEVICES.length; i++) for (let j = i + 1; j < DEVICES.length; j++) {
      if (hasPrivacy(DEVICES[i]) && hasPrivacy(DEVICES[j])) {
        out.push({ label: `${shortName(DEVICES[i])} vs ${shortName(DEVICES[j])} · 防窥`, slots: [variant(DEVICES[i], true).id, variant(DEVICES[j], true).id] });
      }
    }
    return out;
  })();
  $('presets').innerHTML = PRESETS.map((p, i) => `<button data-i="${i}">${p.label}</button>`).join('');
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    S.slots = PRESETS[+b.dataset.i].slots.slice();
    syncProfileUI();
    requestRender();
  });

  function syncProfileUI() {
    const showPriv = !S.compare && hasPrivacy(S.device);
    $('privacyRow').hidden = !showPriv;
    $('privacyText').textContent = privacyText(S.device).switch;
    $('privacyHint').textContent = privacyText(S.device).hint;
    $('privacy').checked = !!(variant(S.device, S.privacy) || {}).privacy;
    $('secDevice').hidden = S.compare;
    $('secSlots').hidden = !S.compare;
    $('stereoGroup').hidden = !S.stereo;
    [0, 1].forEach((i) => { $('slot' + i).value = S.slots[i]; });
    document.querySelectorAll('#presets button').forEach((b) => {
      const p = PRESETS[+b.dataset.i];
      b.classList.toggle('on', p.slots[0] === S.slots[0] && p.slots[1] === S.slots[1]);
    });
    syncSeg('compare', S.stereo ? 2 : S.compare ? 1 : 0);
    document.body.classList.toggle('stereo', S.stereo);
    document.title = `可视角度仿真 · ${activeDevices().join(' vs ')}`;
    renderDevCards();
    renderSwatches();
    if (S.pattern) loadPattern(S.pattern);
  }
  const options = PROFILES.slice().sort((a, b) => rank(a.device) - rank(b.device) || a.privacy - b.privacy)
    .map((p) => `<option value="${p.id}">${profileLabel(p, true)}</option>`).join('');
  [0, 1].forEach((i) => {
    const sel = $('slot' + i);
    sel.innerHTML = options;
    sel.addEventListener('change', () => { S.slots[i] = sel.value; syncProfileUI(); requestRender(); });
  });
  $('privacy').addEventListener('change', (e) => { S.privacy = e.target.checked; syncProfileUI(); requestRender(); });
  bindSeg('compare', (v) => { S.compare = v === '1'; S.stereo = v === '2'; syncProfileUI(); requestRender(); });
  bindSeg('stereoView', (v) => { S.cross = v === '1'; requestRender(); });
  $('size').addEventListener('input', (e) => { S.size = e.target.value / 100; $('sizeV').textContent = e.target.value + '%'; requestRender(); });
  $('gap').addEventListener('input', (e) => { S.gap = +e.target.value; $('gapV').textContent = S.gap + ' px'; requestRender(); });
  $('ipd').addEventListener('input', (e) => { S.ipd = +e.target.value; $('ipdV').textContent = S.ipd + ' mm'; requestRender(); });

  /** 测试画面按当前（对比时为左侧）机型的屏幕分辨率生成。 */
  let patternKey = '';
  function loadPattern(name, force) {
    const sc = specOf(byId(activeIds()[0]).device).screen;
    const w = S.rot === 90 ? sc.resH : sc.resW, h = S.rot === 90 ? sc.resW : sc.resH;
    const key = `${name}:${w}x${h}`;
    S.pattern = name;
    document.querySelectorAll('#patterns [data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === name));
    document.querySelector('#patterns .upload').classList.remove('on');
    if (key === patternKey && !force) return;
    patternKey = key;
    setImage(Patterns.make(name, w, h));
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
      if (S.padMetric !== 'lum') q.set('k', S.padMetric);
      if (S.pal !== 'jet') q.set('pal', S.pal);
      try { history.replaceState(null, '', '#' + q.toString()); } catch (err) { /* file:// 下个别浏览器不允许 */ }
    }, 300);
  }
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    const num = (k, d) => (q.has(k) && isFinite(+q.get(k)) ? +q.get(k) : d);
    const di = num('dev', 0);
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
    if (q.get('k') === 'jncd') S.padMetric = 'jncd';
    if (Viz.PALETTES[q.get('pal')]) S.pal = q.get('pal');
    setView(num('t', 0), num('p', 0));
    syncSeg('mode', S.mode); syncSeg('orient', S.rot); syncSeg('padMetric', S.padMetric);
  }

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

  // 调试 / 截图用
  window.viewAngle = { S, setView, animateTo, setClean, setDist, getModel, render: () => render() };
})();
