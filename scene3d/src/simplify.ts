/*
 * 人体简化：把基础模型做成中性的“人台”——压平胸部、抹平躯干与四肢的肌肉细节。
 * 只改绑定姿态下的顶点位置，骨骼权重不变，所以摆姿势照常工作。
 * 坐标单位米，人物面朝 +Z（Quaternius UBC 女性模型的绑定姿态）。
 */
import * as THREE from 'three';

const smooth = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface SimplifyOpts {
  /** 按骨骼收细：顶点到骨段的距离乘以系数（<1 变细），用来把健美比例收成普通身材 */
  slim?: Record<string, number>;
  chest: number;        // 胸部前凸保留比例（0 = 压平）
  waistHip: boolean;    // 收窄髋部、放宽腰部、收平臀部（去掉明显的女性曲线）
  face: number;         // 面部平滑迭代次数（去掉嘴唇、眼窝等细节，做成人台脸）
  iterations: number;   // 躯干与四肢的平滑迭代次数
}
export const NEUTRAL_FEMALE: SimplifyOpts = { chest: 0.18, waistHip: true, face: 14, iterations: 8 };
export const NEUTRAL_MALE: SimplifyOpts = {
  slim: {
    upperarm: 0.78, lowerarm: 0.86, clavicle: 0.8, neck_01: 0.85,
    spine_03: 0.9, spine_02: 0.94, thigh: 0.9, calf: 0.92,
  },
  chest: 0.7, waistHip: false, face: 14, iterations: 12,
};

/** 骨段（起点骨骼 → 终点骨骼），左右各一份。 */
const SEGMENTS: Record<string, [string, string]> = {
  upperarm: ['upperarm', 'lowerarm'], lowerarm: ['lowerarm', 'hand'], clavicle: ['clavicle', 'upperarm'],
  thigh: ['thigh', 'calf'], calf: ['calf', 'foot'],
  neck_01: ['neck_01', 'Head'], spine_03: ['spine_03', 'neck_01'], spine_02: ['spine_02', 'spine_03'],
};

/** 按蒙皮权重把顶点向所属骨段收拢。 */
function slimByBones(mesh: THREE.SkinnedMesh, P: number[], firstOf: Int32Array, slim: Record<string, number>) {
  const sk = mesh.skeleton;
  const restPos = sk.boneInverses.map((bi) => new THREE.Vector3().setFromMatrixPosition(bi.clone().invert()));
  const idxByName = new Map(sk.bones.map((b, i) => [b.name, i]));
  // 每根骨骼对应的骨段与系数
  const segOf: ({ a: THREE.Vector3; b: THREE.Vector3; k: number } | null)[] = sk.bones.map(() => null);
  for (const [key, k] of Object.entries(slim)) {
    const [from, to] = SEGMENTS[key];
    for (const side of from.includes('spine') || from.includes('neck') ? [''] : ['_l', '_r']) {
      const ia = idxByName.get(from + side), ib = idxByName.get(to === 'Head' ? 'Head' : to + side);
      if (ia === undefined || ib === undefined) continue;
      segOf[ia] = { a: restPos[ia], b: restPos[ib], k };
    }
  }
  const si = mesh.geometry.attributes.skinIndex as THREE.BufferAttribute;
  const sw = mesh.geometry.attributes.skinWeight as THREE.BufferAttribute;
  const p = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), line = new THREE.Line3();
  for (let id = 0; id < firstOf.length; id++) {
    const v = firstOf[id];
    p.fromArray(P, id * 3);
    d.set(0, 0, 0);
    for (let j = 0; j < 4; j++) {
      const w = sw.getComponent(v, j), seg = segOf[si.getComponent(v, j)];
      if (!w || !seg) continue;
      line.set(seg.a, seg.b).closestPointToPoint(p, true, c);
      d.addScaledVector(c.sub(p), w * (1 - seg.k));   // 朝骨段方向移动 (1−k) 的距离
    }
    P[id * 3] += d.x; P[id * 3 + 1] += d.y; P[id * 3 + 2] += d.z;
  }
}

/** 分段线性插值。 */
const lerpTable = (t: [number, number][], x: number) => {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) {
    const [x0, y0] = t[i - 1], [x1, y1] = t[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return t[t.length - 1][1];
};

export function simplifyBody(mesh: THREE.SkinnedMesh, opts: SimplifyOpts = NEUTRAL_FEMALE) {
  const g = mesh.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;

  // UV 接缝处同一位置有多个顶点：按位置焊接成“唯一点”再处理，最后写回所有副本
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
  const idOf = new Int32Array(n);
  const map = new Map<string, number>();
  const P: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let id = map.get(k);
    if (id === undefined) { id = map.size; map.set(k, id); P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    idOf[i] = id;
  }
  const m = map.size;
  const firstOf = new Int32Array(m).fill(-1);
  for (let i = 0; i < n; i++) if (firstOf[idOf[i]] < 0) firstOf[idOf[i]] = i;
  if (opts.slim) slimByBones(mesh, P, firstOf, opts.slim);
  const nb: Set<number>[] = Array.from({ length: m }, () => new Set());
  const idx = g.index!;
  for (let t = 0; t < idx.count; t += 3) {
    const a = idOf[idx.getX(t)], b = idOf[idx.getX(t + 1)], c = idOf[idx.getX(t + 2)];
    nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b);
  }

  // 1. 胸部：z 方向压缩，按身高和左右范围平滑过渡
  for (let i = 0; i < m; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const w = smooth(1.18, 1.26, y) * (1 - smooth(1.39, 1.45, y)) * (1 - smooth(0.15, 0.2, Math.abs(x)));
    if (w > 0 && z > 0.085) P[i * 3 + 2] = 0.085 + (z - 0.085) * (1 - w * (1 - opts.chest));
  }

  // 2. 腰臀：按身高缩放躯干宽度（髋收窄、腰放宽），臀部向后的凸起收平；手臂（T 姿势在两侧）不动
  if (opts.waistHip) {
    const widthTable: [number, number][] = [[0.68, 1], [0.8, 0.88], [0.96, 0.87], [1.05, 1.0], [1.14, 1.15], [1.22, 1.08], [1.3, 1.0]];
    for (let i = 0; i < m; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const torso = 1 - smooth(0.2, 0.26, Math.abs(x));
      if (torso <= 0) continue;
      const s = 1 + (lerpTable(widthTable, y) - 1) * torso;
      P[i * 3] = x * s;
      const wb = smooth(0.8, 0.86, y) * (1 - smooth(1.02, 1.1, y)) * torso;
      if (wb > 0 && z < -0.095) P[i * 3 + 2] = -0.095 + (z + 0.095) * (1 - wb * 0.5);
    }
  }

  // 3. Taubin 平滑（λ/μ 交替，基本不缩体积）：躯干和四肢一套，面部一套；手、脚不动
  const mask = new Float32Array(m), faceMask = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = Math.abs(P[i * 3]), y = P[i * 3 + 1], z = P[i * 3 + 2];
    const head = smooth(1.45, 1.5, y);             // 脖子以上
    const hand = smooth(0.55, 0.62, x);            // T 姿势下的手
    const foot = 1 - smooth(0.08, 0.14, y);
    mask[i] = (1 - head) * (1 - hand) * (1 - foot);
    faceMask[i] = smooth(1.53, 1.57, y) * (1 - smooth(1.71, 1.75, y)) * smooth(0.0, 0.035, z) * (1 - smooth(0.06, 0.08, x));
  }
  const tmp = new Float32Array(m * 3);
  const step = (lambda: number, w: Float32Array = mask) => {
    for (let i = 0; i < m; i++) {
      const s = nb[i];
      if (!s.size || !w[i]) { tmp.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], i * 3); continue; }
      let ax = 0, ay = 0, az = 0;
      for (const j of s) { ax += P[j * 3]; ay += P[j * 3 + 1]; az += P[j * 3 + 2]; }
      const k = lambda * w[i], inv = 1 / s.size;
      tmp[i * 3] = P[i * 3] + k * (ax * inv - P[i * 3]);
      tmp[i * 3 + 1] = P[i * 3 + 1] + k * (ay * inv - P[i * 3 + 1]);
      tmp[i * 3 + 2] = P[i * 3 + 2] + k * (az * inv - P[i * 3 + 2]);
    }
    for (let i = 0; i < m * 3; i++) P[i] = tmp[i];
  };
  for (let it = 0; it < opts.iterations; it++) { step(0.55); step(-0.58); }
  for (let it = 0; it < opts.face; it++) { step(0.6, faceMask); step(-0.63, faceMask); }

  // 写回并按焊接后的拓扑重算法线（接缝两侧法线一致，不出现硬边）
  for (let i = 0; i < n; i++) { const id = idOf[i]; pos.setXYZ(i, P[id * 3], P[id * 3 + 1], P[id * 3 + 2]); }
  pos.needsUpdate = true;
  const N = new Float32Array(m * 3);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const a = idOf[idx.getX(t)], b = idOf[idx.getX(t + 1)], c = idOf[idx.getX(t + 2)];
    va.fromArray(P, a * 3); vb.fromArray(P, b * 3); vc.fromArray(P, c * 3);
    const fn = vc.sub(vb).cross(va.sub(vb));
    for (const v of [a, b, c]) { N[v * 3] += fn.x; N[v * 3 + 1] += fn.y; N[v * 3 + 2] += fn.z; }
  }
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const tv = new THREE.Vector3();
  for (let i = 0; i < n; i++) { const id = idOf[i]; tv.fromArray(N, id * 3).normalize(); nor.setXYZ(i, tv.x, tv.y, tv.z); }
  nor.needsUpdate = true;
  g.computeBoundingSphere();
}
