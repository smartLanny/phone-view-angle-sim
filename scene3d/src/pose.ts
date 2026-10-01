/*
 * 姿势积木：坐姿、右手持机、手放大腿 / 桌面、转头看某处。
 * 各场景（presets.ts）用这些积木拼出完整姿势。坐标：人物面朝 +Z，右侧为 −X，单位米。
 */
import * as THREE from 'three';
import { type Character, resetPose, rotateWorld, rotateLocal, aimY, setWorldQuat, solveTwoBone, eyeWorld, headAxes, worldPos, worldQuat } from './rig';

const DEG = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** 手机外形尺寸（米）：宽、高、厚；背面最大凸起（相机平台 + 镜头）与平台中心的 y */
export interface PhoneDims { W: number; H: number; T: number; bump: number; islandY: number }

export interface SeatParams {
  seatHeight: number;
  lean: number;          // 上身前倾（度）
  headPitch: number;     // 低头（度）
  sideLean?: number;     // 上身侧倾（度，正值向人物左侧 +X）
  rootX?: number; rootZ?: number;
}

/** 坐姿：髋关节落到座面上方约 8 cm，大腿向前、小腿垂直、脚放平，上身前倾、低头。 */
export function poseSeated(c: Character, p: SeatParams) {
  const b = c.bones;
  resetPose(c);
  c.root.position.set(0, 0, 0);
  c.root.updateMatrixWorld(true);
  const hipRest = worldPos(b.thigh_r).y;
  c.root.position.set(p.rootX ?? 0, p.seatHeight + 0.08 - hipRest, p.rootZ ?? 0);
  c.root.updateMatrixWorld(true);
  aimY(b.thigh_r, new THREE.Vector3(-0.12, -0.06, 1));
  aimY(b.thigh_l, new THREE.Vector3(0.12, -0.06, 1));
  aimY(b.calf_r, new THREE.Vector3(-0.03, -1, 0.1));
  aimY(b.calf_l, new THREE.Vector3(0.03, -1, 0.1));
  aimY(b.foot_r, new THREE.Vector3(-0.05, -0.3, 1));
  aimY(b.foot_l, new THREE.Vector3(0.05, -0.3, 1));
  rotateWorld(b.spine_01, X, p.lean * 0.4);
  rotateWorld(b.spine_02, X, p.lean * 0.3);
  rotateWorld(b.spine_03, X, p.lean * 0.3);
  if (p.sideLean) {
    rotateWorld(b.spine_02, Z, -p.sideLean * 0.5);
    rotateWorld(b.spine_03, Z, -p.sideLean * 0.5);
  }
  rotateWorld(b.neck_01, X, p.headPitch * 0.45);
  rotateWorld(b.Head, X, p.headPitch * 0.55);
}

export interface LieParams {
  bedY: number;          // 床面高度
  pelvisX: number;       // 骨盆沿床长方向的位置（头朝 +X）
  backZ: number;         // 骨盆前后位置
  headPitch: number;     // 低头（度，朝胸口方向）
}

/** 侧卧的身体朝向：整个人绕前后方向（Z）转 −90°，左侧在下、头朝 +X、仍面朝 +Z；
 *  肩比髋宽，躺平时肩、髋都着床，身体会略微斜着（头那头高 7°） */
export const LIE_LEFT = new THREE.Quaternion().setFromAxisAngle(Z, -83 * DEG);

/**
 * 向左侧卧（左侧压在床上），用来看手机：髋、膝微屈，上身微微前弓，头枕在枕头上、稍低头；
 * 左臂（压在下面）向前搭在床上，右手留给手机（之后用 holdPhoneRight 摆）。
 * 方向都按“站着时的身体方向”写，再经 LIE_LEFT 转到世界坐标。
 */
export function poseLyingLeft(c: Character, p: LieParams) {
  const b = c.bones;
  resetPose(c);
  c.root.position.set(0, 0, 0);
  c.root.updateMatrixWorld(true);
  const B = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(LIE_LEFT);
  // 绕骨盆转（不绕脚底的根骨骼）：和坐姿之间过渡时，人像是往侧面躺下去，上身不会先往上甩一个大弧
  setWorldQuat(b.pelvis, LIE_LEFT.clone().multiply(worldQuat(b.pelvis)));
  // 腿直接按世界方向摆（头朝 +X、脚朝 −X）：下面的腿贴着床面，上面的腿往下收、膝盖叠在下面那条腿上方
  const W3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  aimY(b.thigh_l, W3(-0.62, -0.09, 0.78));
  aimY(b.calf_l, W3(-0.86, 0, -0.5));
  aimY(b.thigh_r, W3(-0.55, -0.33, 0.78));
  aimY(b.calf_r, W3(-0.86, -0.02, -0.45));
  aimY(b.foot_l, B(0.05, -0.25, 1));
  aimY(b.foot_r, B(-0.05, -0.25, 1));
  const bx = B(1, 0, 0);
  rotateWorld(b.spine_01, bx, 5);
  rotateWorld(b.spine_02, bx, 5);
  rotateWorld(b.spine_03, bx, 4);
  rotateWorld(b.neck_01, bx, p.headPitch * 0.45);
  rotateWorld(b.Head, bx, p.headPitch * 0.55);
  // 左臂（压在下面）：向前平放在床上、略朝头的方向，手放松
  aimY(b.upperarm_l, W3(0.35, -0.03, 1));
  aimY(b.lowerarm_l, W3(0.2, -0.03, 1));
  aimY(b.hand_l, W3(0.15, -0.06, 1));
  shareTwist(b.lowerarm_l, b.hand_l);
  relaxFingers(c, 'l');
  // 压在床上的一侧（左肩、左髋）落到床面上：关节到皮肤表面约 6 / 9 cm，再陷进床垫 1 cm
  c.root.updateMatrixWorld(true);
  const low = Math.min(worldPos(b.upperarm_l).y - 0.06, worldPos(b.thigh_l).y - 0.09);
  const pel = worldPos(b.pelvis);
  c.root.position.set(p.pelvisX - pel.x, p.bedY - 0.01 - low, p.backZ - pel.z);
  c.root.updateMatrixWorld(true);
}

/** 头的右方 / 头顶 / 前方（世界坐标），给侧卧时摆手机用 */
export function headFrame(c: Character) {
  const { right, up } = headAxes(c);
  return { right, up, fwd: new THREE.Vector3().crossVectors(up, right).normalize() };
}

/** 握持参数：手指走向与竖直方向的夹角、掌心向左偏转、手腕相对右下角的位置、指尖落点。 */
export const GRIP = { beta: 55, yaw: 42, dx: 0.028, dy: -0.020, dz: -0.024, tipOut: 0.009, tipZ: 1.2 };

/** 右手相对手机的握持姿态（手机局部坐标）：手腕在右下角外后方，掌心贴背面并略朝左，四指斜向左上绕到左边框。 */
function gripMatrix(d: PhoneDims) {
  const beta = GRIP.beta * DEG, yaw = GRIP.yaw * DEG;
  const n = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const Xh = n.clone().negate();
  const across = new THREE.Vector3(-Math.cos(yaw), 0, -Math.sin(yaw));
  const Yh = across.multiplyScalar(Math.cos(beta)).add(new THREE.Vector3(0, Math.sin(beta), 0)).normalize();
  const Zh = new THREE.Vector3().crossVectors(Xh, Yh);
  const m = new THREE.Matrix4().makeBasis(Xh, Yh, Zh);
  m.setPosition(d.W / 2 + GRIP.dx, -d.H / 2 + GRIP.dy, -d.T + GRIP.dz);
  return m;
}

/**
 * 手腕扭转分担：手相对前臂绕前臂长轴（骨骼 +Y）的扭转，分 k 给前臂、手腕只留剩下的部分，手的世界朝向不变。
 * 旋前 / 旋后本来就主要发生在前臂；全压在手腕上时蒙皮会拧成“麻花”，场景之间过渡时更明显。
 */
export function shareTwist(lower: THREE.Bone, hand: THREE.Bone, k = 0.5) {
  const q = hand.quaternion;
  let ang = 2 * Math.atan2(q.y, q.w);
  if (ang > Math.PI) ang -= 2 * Math.PI;
  if (ang < -Math.PI) ang += 2 * Math.PI;
  const T = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang * k);
  lower.quaternion.multiply(T);
  hand.quaternion.premultiply(T.invert());
  lower.updateMatrixWorld(true);
}

/** 右手握住手机（phone 为手机局部 → 世界矩阵）。返回手臂是否够得着。body：身体整体的朝向（侧卧时），用来摆肘部方向 */
export function holdPhoneRight(c: Character, phone: THREE.Matrix4, d: PhoneDims, body?: THREE.Quaternion): boolean {
  const b = c.bones;
  const hand = phone.clone().multiply(gripMatrix(d));
  const wrist = new THREE.Vector3().setFromMatrixPosition(hand);
  const handQ = new THREE.Quaternion().setFromRotationMatrix(hand);
  rotateWorld(b.clavicle_r, Z, 6);
  // 手机举得高 / 远、手臂伸直也差一点时：把肩膀往手机方向带（肩胛前伸 / 上提，最多约 30°）。只动锁骨，头和眼睛不动
  const armLen = worldPos(b.upperarm_r).distanceTo(worldPos(b.lowerarm_r)) + worldPos(b.lowerarm_r).distanceTo(worldPos(b.hand_r));
  for (let i = 0; i < 10; i++) {
    const s0 = worldPos(b.upperarm_r);
    if (s0.distanceTo(wrist) <= armLen - 0.003) break;
    const root = worldPos(b.clavicle_r);
    const axis = new THREE.Vector3().crossVectors(s0.clone().sub(root), wrist.clone().sub(root));
    if (axis.lengthSq() < 1e-10) break;
    rotateWorld(b.clavicle_r, axis, 3);
  }
  const sh = worldPos(b.upperarm_r);
  const pole = new THREE.Vector3(-0.25, -0.45, -0.15);
  if (body) pole.applyQuaternion(body);
  const ok = solveTwoBone(b.upperarm_r, b.lowerarm_r, b.hand_r, wrist, sh.clone().add(pole));
  setWorldQuat(b.hand_r, handQ);
  shareTwist(b.lowerarm_r, b.hand_r);

  // 手指按目标点摆：第一节指向左边框背面外侧，后两节指向左边框上的落点；指尖不进入屏幕前方
  const L = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(phone);
  const edgeX = -d.W / 2;
  const finger = (name: string, y: number, knuckleOut: number) => {
    const knuckle = L(edgeX - knuckleOut, y - 0.004, -d.T - 0.006);
    const tip = L(edgeX - GRIP.tipOut, y + 0.006, -d.T * GRIP.tipZ);
    aimY(b[`${name}_01_r`], knuckle.sub(worldPos(b[`${name}_01_r`])));
    aimY(b[`${name}_02_r`], tip.clone().sub(worldPos(b[`${name}_02_r`])));
    aimY(b[`${name}_03_r`], tip.clone().sub(worldPos(b[`${name}_03_r`])));
  };
  finger('index', 0.030, 0.004);
  finger('middle', 0.006, 0.006);
  finger('ring', -0.018, 0.006);
  const pinkyTip = L(edgeX + 0.012, -d.H / 2 - 0.004, -d.T * 0.5);
  aimY(b.pinky_01_r, L(edgeX + 0.004, -d.H / 2 + 0.004, -d.T - 0.008).sub(worldPos(b.pinky_01_r)));
  aimY(b.pinky_02_r, pinkyTip.clone().sub(worldPos(b.pinky_02_r)));
  aimY(b.pinky_03_r, pinkyTip.clone().sub(worldPos(b.pinky_03_r)));
  const thumbTarget = L(d.W / 2 + GRIP.tipOut + 0.002, 0.0, -d.T * GRIP.tipZ);
  aimY(b.thumb_01_r, thumbTarget.clone().sub(worldPos(b.thumb_01_r)));
  aimY(b.thumb_02_r, thumbTarget.clone().sub(worldPos(b.thumb_02_r)));
  aimY(b.thumb_03_r, thumbTarget.clone().sub(worldPos(b.thumb_03_r)));
  return ok;
}

const relaxFingers = (c: Character, s: 'l' | 'r', k = 1) => {
  const b = c.bones;
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    rotateLocal(b[`${f}_01_${s}`], 'x', 18 * k); rotateLocal(b[`${f}_02_${s}`], 'x', 25 * k); rotateLocal(b[`${f}_03_${s}`], 'x', 15 * k);
  }
  rotateLocal(b[`thumb_02_${s}`], 'x', 10 * k);
};

/** 手自然放在大腿上。 */
export function armOnLap(c: Character, s: 'l' | 'r') {
  const b = c.bones, sx = s === 'l' ? 1 : -1;
  aimY(b[`upperarm_${s}`], new THREE.Vector3(0.12 * sx, -1, 0.18));
  aimY(b[`lowerarm_${s}`], new THREE.Vector3(-0.15 * sx, -0.45, 1));
  aimY(b[`hand_${s}`], new THREE.Vector3(-0.2 * sx, -0.35, 1));
  rotateLocal(b[`hand_${s}`], 'y', 70 * sx);
  shareTwist(b[`lowerarm_${s}`], b[`hand_${s}`]);
  relaxFingers(c, s);
}

/**
 * 手平放在桌面上（掌心朝下、手指向前、拇指朝内），target 为手腕位置。
 * 给了 surfaceY（桌面高度）时检查指尖：低于桌面（加上指肚厚度）就把手腕抬高再摆一次，手指不穿进桌面。
 */
export function handOnTable(c: Character, s: 'l' | 'r', target: THREE.Vector3, surfaceY?: number): boolean {
  const b = c.bones, sx = s === 'l' ? 1 : -1;
  const sh = worldPos(b[`upperarm_${s}`]);
  // 右手骨骼 +X 为手背，左手骨骼镜像（−X 为手背）
  const Xh = new THREE.Vector3(0, sx > 0 ? -1 : 1, 0);
  const Yh = new THREE.Vector3(-0.25 * sx, 0, 1).normalize();
  const Zh = new THREE.Vector3().crossVectors(Xh, Yh);
  const handQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xh, Yh, Zh));
  // relaxFingers 是在当前角度上叠加，重摆前先还原手指
  const fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((f) => [1, 2, 3].map((n) => b[`${f}_0${n}_${s}`])).filter(Boolean);
  const rest = fingers.map((f) => f.quaternion.clone());
  const place = (t: THREE.Vector3) => {
    fingers.forEach((f, i) => f.quaternion.copy(rest[i]));
    const ok = solveTwoBone(b[`upperarm_${s}`], b[`lowerarm_${s}`], b[`hand_${s}`], t, sh.clone().add(new THREE.Vector3(0.35 * sx, -0.3, -0.25)));
    setWorldQuat(b[`hand_${s}`], handQ);
    shareTwist(b[`lowerarm_${s}`], b[`hand_${s}`]);
    relaxFingers(c, s, 0.3);                   // 放在桌上的手指只微微弯
    return ok;
  };
  let ok = place(target);
  if (surfaceY !== undefined) {
    const t = target.clone();
    for (let i = 0; i < 3; i++) {
      const low = Math.min(...['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => worldPos(b[`${f}_04_leaf_${s}`]).y));
      const need = surfaceY + 0.009 - low;      // 指尖骨骼到指肚表面约 9 mm
      if (need < 0.001) break;
      t.y += need;
      ok = place(t);
    }
  }
  return ok;
}

/** 转头看向 target：躯干、脖子、头按比例分担。 */
export function lookAt(c: Character, target: THREE.Vector3) {
  const b = c.bones;
  for (const [bone, k] of [[b.spine_03, 0.2], [b.neck_01, 0.35], [b.Head, 1]] as [THREE.Bone, number][]) {
    const head = eyeWorld(c);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat(b.Head));
    const want = target.clone().sub(head).normalize();
    const full = new THREE.Quaternion().setFromUnitVectors(fwd, want);
    const part = new THREE.Quaternion().slerp(full, k);
    setWorldQuat(bone, part.multiply(worldQuat(bone)));
  }
}

/** 手指末端在手机局部坐标里的位置（检查用）。 */
export function fingertipsLocal(c: Character, phone: THREE.Matrix4) {
  const inv = phone.clone().invert();
  const out: Record<string, THREE.Vector3> = {};
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) out[f] = worldPos(c.bones[`${f}_04_leaf_r`]).applyMatrix4(inv);
  return out;
}

/** 屏幕中心在 center、法线为 normal 的手机矩阵；屏幕“上”尽量朝 upHint。 */
export function phoneMatrix(center: THREE.Vector3, normal: THREE.Vector3, upHint = new THREE.Vector3(0, 1, 0)) {
  const Zp = normal.clone().normalize();
  const Yp = upHint.clone().sub(Zp.clone().multiplyScalar(upHint.dot(Zp))).normalize();
  const Xp = new THREE.Vector3().crossVectors(Yp, Zp);
  return new THREE.Matrix4().makeBasis(Xp, Yp, Zp).setPosition(center);
}

export { eyeWorld };
