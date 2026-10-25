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

  const modelLoads = {};
  const modelBuffers = {};
  const modelTexStats = {};   // 模型贴图的平均值（底色 / 金属度粗糙度）：贴图不可用时折算进材质常量
  const modelTexImages = {};  // 模型贴图本身（ImageBitmap），由 app.js 上传为纹理数组逐像素采样
  const glbJson = (buffer) => JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, new DataView(buffer).getUint32(12, true))));
  /**
   * 解码模型用到的贴图（底色、金属度 / 粗糙度、法线），交给渲染端逐像素采样；
   * 同时给底色贴图（sRGB → 线性）和金属度 / 粗糙度贴图（G = 粗糙度，B = 金属度）各取平均值，
   * 只在某张贴图解码失败时折算进材质常量。images 以贴图编号为键，同一张图只解码一次。
   */
  async function texStats(buffer) {
    const json = glbJson(buffer), bin = 28 + new DataView(buffer).getUint32(12, true), out = {};
    const used = new Set();
    for (const m of json.materials || []) {
      const p = m.pbrMetallicRoughness || {};
      for (const t of [p.baseColorTexture, p.metallicRoughnessTexture, m.normalTexture]) if (t) used.add(t.index);
    }
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const bySource = {};
    await Promise.all([...used].map(async (ti) => {
      const src = json.textures[ti].source;
      bySource[src] ||= (async () => {
        const img = json.images[src], view = json.bufferViews[img.bufferView];
        const bytes = new Uint8Array(buffer, bin + (view.byteOffset || 0), view.byteLength);
        // 贴图按 glTF 约定原样使用（不预乘、不做色彩空间转换），坐标与 TEXCOORD 直接对应；个别浏览器不认这些选项时退回默认解码
        const blob = new Blob([bytes], { type: img.mimeType });
        return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(() => createImageBitmap(blob)).catch(() => null);
      })();
      const bmp = await bySource[src];
      if (bmp) out[ti] = bmp;   // 解码失败的贴图跳过，对应材质退回常量
    }));
    const images = {};
    for (const [ti, bmp] of Object.entries(out)) {
      images[ti] = bmp;
      g.clearRect(0, 0, 32, 32); g.drawImage(bmp, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data, n = d.length / 4;
      const sum = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        for (let k = 0; k < 3; k++) { sum[k] += lin(d[i + k] / 255) * a; sum[4 + k] += d[i + k] / 255; }
        sum[3] += a;
      }
      const wa = Math.max(sum[3], 1e-6);
      out[ti] = { linMean: [sum[0] / wa, sum[1] / wa, sum[2] / wa], alpha: sum[3] / n, raw: [sum[4] / n, sum[5] / n, sum[6] / n] };
    }
    return { stats: out, images };
  }
  /**
   * 贴图在纹理数组里的层号：按用途（底色 / 金属度粗糙度 / 法线）各建一个数组，同一张源图只占一层。
   * 返回 { bc, mr, n }，每项是 { map: 贴图编号 → 层号, layers: [贴图编号…] }。只收录已解码的贴图。
   */
  function texLayout(json, images) {
    const roles = { bc: [], mr: [], n: [] };
    for (const m of json.materials || []) {
      const p = m.pbrMetallicRoughness || {};
      for (const [k, t] of [['bc', p.baseColorTexture], ['mr', p.metallicRoughnessTexture], ['n', m.normalTexture]])
        if (t && images[t.index]) roles[k].push(t.index);
    }
    const out = {};
    for (const [k, list] of Object.entries(roles)) {
      const map = new Map(), layers = [], bySrc = new Map();
      for (const ti of [...new Set(list)].sort((a, b) => a - b)) {
        const src = json.textures[ti].source;
        if (!bySrc.has(src)) { bySrc.set(src, layers.length); layers.push(ti); }
        map.set(ti, bySrc.get(src));
      }
      out[k] = { map, layers };
    }
    return out;
  }
  // 顶点上的贴图槽：层号 × 2 + 所用纹理坐标组（0 / 1），没有贴图为 −1
  const texSlot = (role, ref) => (ref && role.map.has(ref.index) ? role.map.get(ref.index) * 2 + ((ref.texCoord || 0) ? 1 : 0) : -1);
  function loadModel(id) {
    if (modelLoads[id]) return modelLoads[id];
    const decode = () => {
      const bin = atob(root.PHONE_ASSETS[id]);
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      return data.buffer;
    };
    // 贴图统计完成后才登记模型，保证第一次建网格时材质已经折算好
    const ready = (buffer) => texStats(buffer).catch(() => ({ stats: {}, images: {} })).then(({ stats, images }) => {
      modelTexStats[id] = stats;
      modelTexImages[id] = images;
      return (modelBuffers[id] = buffer);
    });
    return (modelLoads[id] = root.PHONE_ASSETS?.[id] ? ready(decode()) : new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `assets/${id}.js`;
      script.onload = () => resolve(ready(decode()));
      script.onerror = () => { delete modelLoads[id]; reject(new Error('机身模型加载失败')); };
      document.head.appendChild(script);
    }));
  }

  /**
   * glTF 材质 → 逐顶点 [金属度, 粗糙度, 不透明度, 清漆]。
   * 完全透明的 MASK 贴花（alpha 低于阈值、无贴图）永远不可见，直接跳过——它们和背板玻璃共面，
   * 不跳过就会和背板抢深度，出现摄像头下方那种块状花纹。BLEND 的镜头盖玻璃等在透明通道里画。
   */
  function materialOf(mat, stats, layout) {
    const p = mat.pbrMetallicRoughness || {};
    const fac = p.baseColorFactor || [1, 1, 1, 1];
    let tint = fac.slice(0, 3), alpha = fac[3] ?? 1, meanAlpha = alpha;
    let metal = p.metallicFactor ?? 1, rough = p.roughnessFactor ?? 1;
    // 贴图能逐像素采样时材质只取常量因子，否则把贴图平均值折算进来
    const bcI = p.baseColorTexture?.index, mrI = p.metallicRoughnessTexture?.index;
    const bcL = texSlot(layout.bc, p.baseColorTexture), mrL = texSlot(layout.mr, p.metallicRoughnessTexture);
    const nL = texSlot(layout.n, mat.normalTexture);
    const bc = bcI !== undefined && stats[bcI];
    if (bc) { meanAlpha *= bc.alpha; if (bcL < 0) { tint = tint.map((v, k) => v * bc.linMean[k]); alpha *= bc.alpha; } }
    const mr = mrI !== undefined && stats[mrI];
    if (mr && mrL < 0) { rough *= mr.raw[1]; metal *= mr.raw[2]; }
    const mode = mat.alphaMode || 'OPAQUE';
    if (mode === 'MASK' && meanAlpha < (mat.alphaCutoff ?? 0.5)) return null;
    const opacity = mode === 'BLEND' ? Math.min(alpha, 1) : 1;
    const cc = mat.extensions?.KHR_materials_clearcoat;
    // 导出器只写了清漆粗糙度、没写强度的（镜片、苹果标等）按满清漆处理：这些部件实物是镜面光泽
    const coat = cc ? (cc.clearcoatFactor ?? 1) : 0;
    // BLEND 层（含几乎不透明的背板覆层）一律放到透明通道，以“深度相等也通过”的方式叠在共面的底层上，
    // 否则两层共面时会互相抢深度
    return { tint, finish: [metal, rough, mode === 'BLEND' ? Math.min(opacity, 0.97) : 1, coat],
      texl: [bcL, mrL, nL] };
  }

  /**
   * Duo 机身内部、显示区正下方的竖直隔板（如折痕两侧 x ≈ ±5.7 mm、z −4 ~ −0.5 mm 的黑色结构件）：
   * 被屏幕完全挡住，但正面观看时几乎是“侧着”被光栅化，深度插值误差会让它偶尔穿过屏幕，显示成细竖线。
   * 只去掉显示区内部（离折痕 2 mm 以外、离四周边框还有距离）的竖直面；机身边缘和折痕处的端面都保留。
   * 纯黑的内部结构件（整块藏在显示面板和后壳之间的盒体）一直延伸到上下边框内侧，范围放宽到 |y| ≤ 58.6 mm，
   * 否则斜着从上下方向看时，折痕两侧靠近上下边的地方仍会透出两段细竖线。
   */
  function hiddenWall(pos, ia, ib, ic, yLimit = 57) {
    const P = (i) => [pos[i * 3] * 1000, pos[i * 3 + 1] * 1000, pos[i * 3 + 2] * 1000];
    const a = P(ia), b = P(ib), c = P(ic);
    for (const q of [a, b, c]) {
      const ax = Math.abs(q[0]);
      if (ax < 2 || ax > 74 || Math.abs(q[1]) > yLimit || q[2] > 0 || q[2] < -4.8) return false;
    }
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return Math.abs(n[2] / l) < 0.2;   // 竖直面
  }

  function modelMesh(buffer, split = false, stats = {}, images = {}) {
    const data = new DataView(buffer), length = data.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
    const binary = 28 + length;
    const layout = texLayout(json, images);
    const body = new Mesh();
    body.tint = []; body.finish = []; body.uv1 = []; body.texl = [];
    const sides = {};
    if (split) {
      body.leaf = [];
      const visit = (index, side = 0) => { const n=json.nodes[index]; if(n.name==='left-leaf')side=-1;if(n.name==='right-leaf')side=1;if(n.mesh!==undefined)sides[n.mesh]=side;for(const c of n.children||[])visit(c,side); };
      for(const index of json.scenes[json.scene||0].nodes)visit(index);
    }
    const read = (id) => {
      const a = json.accessors[id], view = json.bufferViews[a.bufferView];
      const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const T = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
      return new T(buffer, binary + (view.byteOffset || 0) + (a.byteOffset || 0), a.count * size);
    };
    for (const [meshIndex, mesh] of json.meshes.entries()) for (const primitive of mesh.primitives) {
      const look = materialOf(json.materials[primitive.material] || {}, stats, layout);
      if (!look) continue;
      const wallY = look.tint.every((v) => v < 0.01) && look.finish[2] === 1 && look.texl.every((v) => v < 0) ? 58.6 : 57;
      const pos = read(primitive.attributes.POSITION), nor = read(primitive.attributes.NORMAL);
      const at = primitive.attributes, uv0 = at.TEXCOORD_0 !== undefined ? read(at.TEXCOORD_0) : null;
      const uvM = at.TEXCOORD_1 !== undefined ? read(at.TEXCOORD_1) : uv0;
      const indices = read(primitive.indices), base = body.pos.length / 3;
      for (let i = 0; i < pos.length; i += 3) {
        const k = (i / 3) * 2;
        body.vert([pos[i] * 1000, pos[i + 1] * 1000, pos[i + 2] * 1000], [nor[i], nor[i + 1], nor[i + 2]], 0, uv0 ? [uv0[k], uv0[k + 1]] : [0, 0]);
        body.uv1.push(uvM ? uvM[k] : 0, uvM ? uvM[k + 1] : 0);
        body.texl.push(...look.texl);
        body.tint.push(...look.tint);
        body.finish.push(...look.finish);
        if (split) body.leaf.push(sides[meshIndex]);
      }
      for (let t = 0; t < indices.length; t += 3) {
        const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2];
        if (split && hiddenWall(pos, ia, ib, ic, wallY)) continue;
        body.idx.push(base + ia, base + ib, base + ic);
      }
    }
    return body;
  }

  let duoBase = null;
  /**
   * 转轴侧中框：原模型每半机身靠转轴一侧只有背面圆角和一小段竖直侧壁（局部 x = 0、z −4.53 ~ −3.97 mm），
   * 往屏幕方向是开口（展开时两半在这里对接）。合上时两段侧壁落在同一平面上，中间用一块与侧壁齐平、
   * 材质与中框相同的盖板连起来，侧面看就是一整条中框；开合过程中盖板两端跟着两侧侧壁的上沿走，
   * 完全展开时缩成一条线藏在两半机身之间。盖板比侧壁往里缩 0.02 mm，上下两端藏在上下边框的端面后面；
   * 截面中间微微外凸（合上时约 0.3 mm），抛光金属上能映出一道柔和的高光，读起来和其他几边的中框一样是金属。
   */
  const HINGE_WALL_TOP = -3.966, FRAME_LOOK = { tint: [0.89, 0.85062, 0.7832], finish: [1, 0.05, 1, 0] };   // 与中框材质相同
  function addHingeCover(body, D, angle, f) {
    const top = (side) => { const L = D.leafPose(side, angle), q = D.rotate([0, 0, HINGE_WALL_TOP], L.rotation); return [q[0] + L.position[0], q[2] + L.position[2]]; };
    const a = top(-1), b = top(1), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) return;
    const n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];   // 朝外（远离折痕）的法线
    const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const inset = 0.02, crown = 0.3 * Math.min(1, len / 8.45), y0 = -58.15, y1 = 58.4, N = 12, base = body.pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const t = i / N * 2 - 1, h = crown * (1 - t * t) - inset, dh = -2 * crown * t * 2 / len;   // dh：外凸高度对弦长的导数
      const p = [a[0] + u[0] * len * (t + 1) / 2 + n[0] * h, a[1] + u[1] * len * (t + 1) / 2 + n[1] * h];
      const m = [n[0] - u[0] * dh, n[1] - u[1] * dh], ml = Math.hypot(m[0], m[1]);
      for (const y of [y0, y1]) {
        body.vert(D.orient([p[0], y, p[1]], f), D.orient([m[0] / ml, 0, m[1] / ml], f, true), 0);
        body.tint.push(...FRAME_LOOK.tint); body.finish.push(...FRAME_LOOK.finish); body.uv1.push(0, 0); body.texl.push(-1, -1, -1);
      }
    }
    for (let i = 0; i < N; i++) { const k = base + i * 2; body.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  function buildDuo(angle, surface = 'inner', mix) {
    const D=root.DuoGeometry, body=new Mesh(), f=D.frame(angle,surface,mix);
    body.tint=[];body.finish=[];body.uv1=[];body.texl=[];
    if(modelBuffers.iphoneduo) {
      duoBase ||= modelMesh(modelBuffers.iphoneduo,true,modelTexStats.iphoneduo,modelTexImages.iphoneduo);
      const transforms={};
      for(const side of [-1,0,1]){
        const p=D.leafPose(side,angle),a=p.rotation+f.rotation;
        transforms[side]={c:Math.cos(a),s:Math.sin(a),t:D.orient(p.position,f)};
      }
      for(let i=0;i<duoBase.pos.length;i+=3) {
        const {c,s,t}=transforms[duoBase.leaf[i/3]],p=duoBase.pos,n=duoBase.nor;
        body.vert([c*p[i]+s*p[i+2]+t[0],p[i+1]+t[1],-s*p[i]+c*p[i+2]+t[2]],
          [c*n[i]+s*n[i+2],n[i+1],-s*n[i]+c*n[i+2]],0);
      }
      body.idx=duoBase.idx.slice();body.tint=duoBase.tint.slice();body.finish=duoBase.finish.slice();
      body.uv=duoBase.uv.slice();body.uv1=duoBase.uv1.slice();body.texl=duoBase.texl.slice();
      addHingeCover(body,D,angle,f);
    }
    const back=D.buildScreen('inner',angle,surface,true,mix).mesh,base=body.pos.length/3;
    for(let i=0;i<back.pos.length;i+=3){body.vert(back.pos.slice(i,i+3),back.nor.slice(i,i+3),0);body.tint.push(.004,.004,.004);body.finish.push(0,1,1,0);body.uv1.push(0,0);body.texl.push(-1,-1,-1);}
    for(let i=0;i<back.idx.length;i+=3){const a=base+back.idx[i],b=base+back.idx[i+1],c=base+back.idx[i+2];body.idx.push(a,b,c,c,b,a);}
    const bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
    for(let i=0;i<body.pos.length;i++){const k=i%3;bounds[0][k]=Math.min(bounds[0][k],body.pos[i]);bounds[1][k]=Math.max(bounds[1][k],body.pos[i]);}
    const corners=[];for(const x of [bounds[0][0],bounds[1][0]])for(const y of [bounds[0][1],bounds[1][1]])for(const z of [bounds[0][2],bounds[1][2]])corners.push([x,y,z]);
    const sample=(key,u=.5,v=.5)=>{const p=D.surfaceFrame(key,u,v,angle);return {point:D.orient(p.point,f),normal:D.orient(p.normal,f,true),tangentU:D.orient(p.tangentU,f,true),tangentV:D.orient(p.tangentV,f,true)};};
    const screens=['inner','outer'].map(key=>({...D.buildScreen(key,angle,surface,false,mix),profile:root.DUO_DATA?.[key]||null,frame:sample(key),sample:(u,v)=>sample(key,u,v)}));
    return {body,screens,spec:{W:164.6,H:117.8,T:5.2},corners,frame:f,surfaceFrame:sample};
  }

  function build(overrides, model) {
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
    if (model) for (let i = 2; i < screen.pos.length; i += 3) screen.pos[i] = 0.02;
    return { body: model ? (modelBuffers[model] ? modelMesh(modelBuffers[model], false, modelTexStats[model], modelTexImages[model]) : new Mesh()) : body, screen, spec: s };
  }

  /** 供渲染端建立纹理数组：{ bc, mr, n } 各是按层号排好的贴图列表，与顶点上的贴图槽对应。 */
  function modelTextures(id) {
    if (!modelBuffers[id]) return null;
    const images = modelTexImages[id] || {}, layout = texLayout(glbJson(modelBuffers[id]), images);
    const out = {};
    for (const [k, role] of Object.entries(layout)) out[k] = role.layers.map((ti) => images[ti]);
    return out;
  }
  root.Phone3D = { build, buildDuo, SPEC, MAT, loadModel, modelTextures, hasModel: (id) => !!modelBuffers[id] };
})(window);
