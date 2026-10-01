/*
 * 人物加载与摆姿势工具。
 * 模型：Quaternius Universal Base Characters（CC0），Blender 式骨骼——每根骨骼沿本地 +Y 指向子骨骼，
 * T 姿势下掌心朝下；人物面朝 +Z，Y 向上，单位米。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const DEG = Math.PI / 180;
const loader = new GLTFLoader();

export interface Character {
  root: THREE.Object3D;
  bones: Record<string, THREE.Bone>;
  meshes: THREE.SkinnedMesh[];
  /** 两眼中点在 Head 骨骼局部坐标里的位置（由眼球网格的绑定姿态求得）。 */
  eyeLocal: THREE.Vector3;
  /** 人物的右方（右眼方向）、头顶方向在 Head 骨骼局部坐标里的方向（站立时分别是世界 −X、+Y） */
  headRightLocal: THREE.Vector3;
  headUpLocal: THREE.Vector3;
  rest: Map<THREE.Bone, THREE.Quaternion>;
}

/** src 为 glTF 地址，或已内嵌缓冲区（data URI）的 glTF JSON 对象（file:// 下也能用）。 */
export async function loadCharacter(src: string | object, hairUrls: string[] = []): Promise<Character> {
  const gltf = typeof src === 'string' ? await loader.loadAsync(src) : await loader.parseAsync(JSON.stringify(src), '');
  const root = gltf.scene;
  const bones: Record<string, THREE.Bone> = {};
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });

  // 发型是单独文件、绑在同名骨架的 Head 上：把它的骨骼换成人物本身的骨骼
  for (const hu of hairUrls) {
    const h = await loader.loadAsync(hu);
    const hairMeshes: THREE.SkinnedMesh[] = [];
    h.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) hairMeshes.push(o as THREE.SkinnedMesh); });
    for (const m of hairMeshes) {
      const sk = m.skeleton;
      const mapped = sk.bones.map((b) => bones[b.name]);
      if (mapped.some((b) => !b)) continue;
      m.removeFromParent();
      const holder = meshes[0].parent!;
      holder.add(m);
      m.bind(new THREE.Skeleton(mapped, sk.boneInverses), m.bindMatrix);
      m.name = 'hair:' + m.name;
      meshes.push(m);
    }
  }

  root.updateMatrixWorld(true);
  // 眼球网格：按网格名或材质名识别（男性模型的眼球网格叫 Face，材质叫 MI_Eyes）
  const eyes = meshes.find((m) => /eye/i.test(m.name) || /eye/i.test((m.material as THREE.Material).name));
  const eyeRest = new THREE.Vector3(0, 1.656, 0.06);
  if (eyes) { eyes.geometry.computeBoundingBox(); eyes.geometry.boundingBox!.getCenter(eyeRest); }
  const eyeLocal = bones.Head.worldToLocal(eyeRest.clone());
  const headQi = bones.Head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const headRightLocal = new THREE.Vector3(-1, 0, 0).applyQuaternion(headQi);
  const headUpLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(headQi);
  const rest = new Map<THREE.Bone, THREE.Quaternion>();
  for (const b of Object.values(bones)) rest.set(b, b.quaternion.clone());
  for (const m of meshes) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; }
  return { root, bones, meshes, eyeLocal, headRightLocal, headUpLocal, rest };
}

export function resetPose(c: Character) {
  for (const [b, q] of c.rest) b.quaternion.copy(q);
  c.root.updateMatrixWorld(true);
}

export const worldPos = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); };
export const worldQuat = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return o.getWorldQuaternion(new THREE.Quaternion()); };

/** 把骨骼的世界旋转设为 q（换算到父坐标）。 */
export function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion) {
  const pq = bone.parent ? worldQuat(bone.parent) : new THREE.Quaternion();
  bone.quaternion.copy(pq.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

/** 绕世界轴旋转骨骼（度）。 */
export function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, deg: number) {
  const d = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), deg * DEG);
  setWorldQuat(bone, d.multiply(worldQuat(bone)));
}

/** 绕骨骼本地轴旋转（度）。 */
export function rotateLocal(bone: THREE.Object3D, axis: 'x' | 'y' | 'z', deg: number) {
  const v = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(v, deg * DEG));
  bone.updateMatrixWorld(true);
}

/** 让骨骼 +Y 指向世界方向（最小旋转，保留原有扭转）。 */
export function aimY(bone: THREE.Object3D, dir: THREE.Vector3) {
  const q = worldQuat(bone);
  const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  setWorldQuat(bone, new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize()).multiply(q));
}

/**
 * 两骨骼 IK：让 hand 骨骼的原点落到 target，肘部朝 pole 一侧弯。
 * 骨长取当前长度，返回是否够得着（够不着时手臂伸直指向目标）。
 */
export function solveTwoBone(upper: THREE.Bone, lower: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3): boolean {
  const S = worldPos(upper), E = worldPos(lower), W = worldPos(hand);
  const L1 = S.distanceTo(E), L2 = E.distanceTo(W);
  const D = target.clone().sub(S);
  const reach = D.length();
  const d = THREE.MathUtils.clamp(reach, Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  const dir = D.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
  const pd = pole.clone().sub(S);
  pd.sub(dir.clone().multiplyScalar(pd.dot(dir))).normalize();
  const elbow = S.clone().addScaledVector(dir, a).addScaledVector(pd, h);
  aimY(upper, elbow.clone().sub(S));
  const wrist = S.clone().addScaledVector(dir, d);
  aimY(lower, wrist.sub(worldPos(lower)));
  return reach <= L1 + L2;
}

/** 两眼中点（世界坐标）。 */
export function eyeWorld(c: Character) {
  c.bones.Head.updateWorldMatrix(true, false);
  return c.bones.Head.localToWorld(c.eyeLocal.clone());
}

/** 头的右方、头顶方向（世界坐标，单位向量）。 */
export function headAxes(c: Character) {
  const q = c.bones.Head.getWorldQuaternion(new THREE.Quaternion());
  return { right: c.headRightLocal.clone().applyQuaternion(q).normalize(), up: c.headUpLocal.clone().applyQuaternion(q).normalize() };
}

/** 左眼、右眼（世界坐标）：从两眼中点沿头的右方各偏半个瞳距。 */
export function eyePair(c: Character, ipd = 0.063): [THREE.Vector3, THREE.Vector3] {
  const m = eyeWorld(c), r = headAxes(c).right;
  return [m.clone().addScaledVector(r, -ipd / 2), m.clone().addScaledVector(r, ipd / 2)];
}

/** 复制一个人物（共用几何体，骨骼独立），用于地铁场景的旁座乘客。 */
export function cloneCharacter(c: Character): Character {
  const root = cloneSkinned(c.root);
  const bones: Record<string, THREE.Bone> = {};
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible && !o.name.endsWith(':depth')) meshes.push(o as THREE.SkinnedMesh);
  });
  const rest = new Map<THREE.Bone, THREE.Quaternion>();
  for (const [b, q] of c.rest) rest.set(bones[b.name], q.clone());
  for (const m of meshes) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; }
  return { root, bones, meshes, eyeLocal: c.eyeLocal.clone(), headRightLocal: c.headRightLocal.clone(), headUpLocal: c.headUpLocal.clone(), rest };
}

/** 姿势快照：根节点位置 + 每根骨骼的局部旋转，用于场景之间插值。 */
export interface PoseSnap { root: THREE.Vector3; q: THREE.Quaternion[] }
export function capturePose(c: Character): PoseSnap {
  return { root: c.root.position.clone(), q: Object.values(c.bones).map((b) => b.quaternion.clone()) };
}
export function applyPose(c: Character, s: PoseSnap) {
  c.root.position.copy(s.root);
  Object.values(c.bones).forEach((b, i) => b.quaternion.copy(s.q[i]));
  c.root.updateMatrixWorld(true);
}
export function blendPose(c: Character, a: PoseSnap, b: PoseSnap, t: number) {
  c.root.position.lerpVectors(a.root, b.root, t);
  Object.values(c.bones).forEach((bone, i) => bone.quaternion.slerpQuaternions(a.q[i], b.q[i], t));
  c.root.updateMatrixWorld(true);
}
