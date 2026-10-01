/*
 * 场景预设。每个预设按参数（观看距离、离轴角）摆出完整场景：人物姿势、手机位置、道具、讲解机位。
 * 数字是起点，可以继续微调到看起来自然。
 */
import * as THREE from 'three';
import { capturePose, type Character, type PoseSnap } from './rig';
import { poseSeated, poseLyingLeft, headFrame, LIE_LEFT, holdPhoneRight, armOnLap, handOnTable, lookAt, phoneMatrix, eyeWorld, type PhoneDims } from './pose';

const DEG = Math.PI / 180;
export const TABLE_Y = 0.70;         // 桌面高度
export const SUBWAY_SEAT = 0.44;     // 地铁座椅高度
export const BED_Y = 0.5;            // 床面高度
/** 正常拿手机时比正对视线多往后仰的角度（正常手持、地铁里的你都这样拿） */
const HOLD_TILT = 18;

export interface Ctx { you: Character; nb: Character; dims: PhoneDims }
export interface ParamDef { key: string; label: string; min: number; max: number; step: number; unit: string }
export interface Props { stool: number; table: number; bench: number; bed: number }

export interface SceneState {
  you: PoseSnap;
  nb: PoseSnap | null;               // 旁座乘客（只有地铁场景有）
  phone: THREE.Matrix4;
  reach: boolean;                    // 手臂是否够得着（够不着时人物淡化）
  lying?: boolean;                   // 躺着：人眼视角的“上”跟着头（不保持世界水平），两只眼睛上下分开
  props: Props;
  explain: { pos: THREE.Vector3; target: THREE.Vector3; fov: number };
  derived: Record<string, number>;   // 由参数算出的量（如桌面场景的观看距离）
}

export interface Preset {
  id: string;
  name: string;
  hint: string;
  params: ParamDef[];
  defaults: Record<string, number>;
  /** 在画面上拖动手机时，横向 / 纵向分别改哪个参数（每像素改多少，可为负） */
  drag?: { x?: { key: string; perPx: number }; y?: { key: string; perPx: number } };
  /** 躺着的场景（见 SceneState.lying） */
  lying?: boolean;
  build(ctx: Ctx, p: Record<string, number>): SceneState;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function camFrom(eye: THREE.Vector3, screen: THREE.Vector3, offset: THREE.Vector3, target = v3(0, 0, 0), fov = 30) {
  const mid = eye.clone().lerp(screen, 0.5);
  return { pos: mid.clone().add(offset), target: mid.clone().add(target), fov };
}

/** 坐着单手拿手机：沿视线放在 dist 处；theta 为手机绕竖直轴转开的角度（眼睛从屏幕右侧斜看），tilt 为前后俯仰（顶端往外倒为正）。 */
function holding(ctx: Ctx, p: Record<string, number>, seat: { seatHeight: number; lean: number; headPitch: number; gazePitch: number; side: number }) {
  const { you, dims } = ctx;
  poseSeated(you, seat);
  const eye = eyeWorld(you);
  const gaze = v3(0, -Math.sin(seat.gazePitch * DEG), Math.cos(seat.gazePitch * DEG));
  const center = eye.clone().addScaledVector(gaze, p.dist / 100);
  center.x += seat.side;
  const toEye = eye.clone().sub(center).normalize();
  // 绕手机自身的竖直方向转 theta：屏幕转向人物左侧，眼睛相对屏幕偏到右边（ψ = 0°）
  const up0 = v3(0, 1, 0).sub(toEye.clone().multiplyScalar(toEye.y)).normalize();
  const normal = toEye.clone().applyAxisAngle(up0, -(p.theta || 0) * DEG);
  const up = up0.clone();
  if (p.tilt) {
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    normal.applyAxisAngle(right, -p.tilt * DEG);
    up.applyAxisAngle(right, -p.tilt * DEG);
  }
  const phone = phoneMatrix(center, normal, up);
  const reach = holdPhoneRight(you, phone, dims);
  armOnLap(you, 'l');
  return { eye, phone, reach };
}

export const PRESETS: Preset[] = [
  {
    id: 'front', name: '正视', hint: '手机举在眼睛正前方，屏幕正对眼睛，作为基准',
    params: [
      { key: 'dist', label: '观看距离', min: 20, max: 50, step: 1, unit: 'cm' },
      { key: 'theta', label: '手机转开', min: -45, max: 60, step: 1, unit: '°' },
      { key: 'tilt', label: '手机俯仰', min: -40, max: 40, step: 1, unit: '°' },
    ],
    defaults: { dist: 30, theta: 0, tilt: 0 },
    drag: { x: { key: 'theta', perPx: 0.25 }, y: { key: 'tilt', perPx: 0.25 } },
    build(ctx, p) {
      const { eye, phone, reach } = holding(ctx, p, { seatHeight: 0.46, lean: 2, headPitch: 0, gazePitch: 2, side: 0 });
      const scr = new THREE.Vector3().setFromMatrixPosition(phone);
      return {
        you: capturePose(ctx.you), nb: null, phone, reach,
        props: { stool: 1, table: 0, bench: 0, bed: 0 },
        explain: camFrom(eye, scr, v3(-0.85, 0.26, -0.5), v3(0, -0.04, 0)),
        derived: {},
      };
    },
  },
  {
    id: 'normal', name: '正常手持', hint: '坐着单手拿手机，眼睛到屏幕约 30 cm，微微低头；手机比正对视线再往后仰一些（顶端往外），眼睛从屏幕下方斜看',
    params: [
      { key: 'dist', label: '观看距离', min: 20, max: 50, step: 1, unit: 'cm' },
      { key: 'theta', label: '手机转开', min: -45, max: 60, step: 1, unit: '°' },
      { key: 'tilt', label: '手机俯仰', min: -40, max: 40, step: 1, unit: '°' },
    ],
    defaults: { dist: 30, theta: 0, tilt: HOLD_TILT },
    drag: { x: { key: 'theta', perPx: 0.25 }, y: { key: 'tilt', perPx: 0.25 } },
    build(ctx, p) {
      const { eye, phone, reach } = holding(ctx, p, { seatHeight: 0.46, lean: 8, headPitch: 18, gazePitch: 28, side: -0.02 });
      const scr = new THREE.Vector3().setFromMatrixPosition(phone);
      return {
        you: capturePose(ctx.you), nb: null, phone, reach,
        props: { stool: 1, table: 0, bench: 0, bed: 0 },
        explain: camFrom(eye, scr, v3(-0.9, 0.34, -0.38), v3(0, -0.05, 0)),
        derived: {},
      };
    },
  },
  {
    id: 'desk', name: '放在桌上', hint: '手机平放在桌面，人坐在桌前低头看；眼睛高出桌面约 45 cm',
    params: [
      { key: 'theta', label: '离轴角', min: 15, max: 60, step: 1, unit: '°' },
      { key: 'rot', label: '在桌上转动', min: -90, max: 90, step: 1, unit: '°' },
    ],
    defaults: { theta: 34, rot: 0 },
    drag: { y: { key: 'theta', perPx: -0.15 }, x: { key: 'rot', perPx: 0.4 } },
    build(ctx, p) {
      const { you, dims } = ctx;
      poseSeated(you, { seatHeight: 0.46, lean: 9, headPitch: 30 });
      // 平放时底边和背面相机凸起着桌，手机顶端（远离人的一端）略微翘起 α
      const dy = dims.islandY + dims.H / 2;
      const len = Math.hypot(dims.bump, dy);
      const alpha = Math.atan2(dims.bump, dy);
      const glassY = TABLE_Y + (dims.bump * dims.H / 2 + dy * dims.T) / len;   // 屏幕中心离桌面的高度
      let eye = eyeWorld(you), center = v3(0, 0, 0);
      for (let i = 0; i < 3; i++) {
        const h = eye.y - glassY;
        // 法线朝人倾斜 α，所以水平距离按 θ + α 算，屏幕中心的离轴角正好是 θ
        center = v3(eye.x, glassY, eye.z + h * Math.tan(p.theta * DEG + alpha));
        lookAt(you, center);
        eye = eyeWorld(you);
      }
      // 在桌面上绕竖直轴转动（翘起的方向跟着手机一起转）
      const spin = new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), (p.rot || 0) * DEG);
      const normal = v3(0, Math.cos(alpha), -Math.sin(alpha)).applyQuaternion(spin);
      const phone = phoneMatrix(center, normal, v3(0, Math.sin(alpha), Math.cos(alpha)).applyQuaternion(spin));
      const r = handOnTable(you, 'r', v3(center.x - 0.22, TABLE_Y + 0.035, center.z - 0.2), TABLE_Y);
      const l = handOnTable(you, 'l', v3(center.x + 0.22, TABLE_Y + 0.035, center.z - 0.2), TABLE_Y);
      return {
        you: capturePose(you), nb: null, phone, reach: r && l,
        props: { stool: 1, table: 1, bench: 0, bed: 0 },
        explain: camFrom(eye, center, v3(-0.95, 0.55, -0.55), v3(0, -0.1, 0.06), 32),
        derived: { dist: eye.distanceTo(center) * 100, height: (eye.y - glassY) * 100 },
      };
    },
  },
  {
    id: 'subway', name: '地铁旁座', hint: '你坐着正常看手机（和正常手持一样往后仰），右边座位的乘客从侧面斜看你的屏幕',
    params: [{ key: 'theta', label: '旁人离轴角', min: 40, max: 70, step: 1, unit: '°' }],
    defaults: { theta: 55 },
    drag: { x: { key: 'theta', perPx: 0.15 } },
    build(ctx, p) {
      const { eye, phone, reach } = holding(ctx, { dist: 30, theta: 0, tilt: HOLD_TILT }, { seatHeight: SUBWAY_SEAT, lean: 8, headPitch: 18, gazePitch: 28, side: -0.02 });
      const you = capturePose(ctx.you);
      const scr = new THREE.Vector3().setFromMatrixPosition(phone);
      // 旁人眼睛的目标位置：从屏幕中心出发，与法线成 theta、偏向人物右侧（−X），高度与自己的眼睛相近
      const N = v3(0, 0, 1).transformDirection(phone);
      const S = v3(-1, 0, 0).sub(N.clone().multiplyScalar(-N.x)).normalize();
      const D = N.clone().multiplyScalar(Math.cos(p.theta * DEG)).addScaledVector(S, Math.sin(p.theta * DEG)).normalize();
      const want = eye.y - 0.02;
      const t = D.y > 0.05 ? (want - scr.y) / D.y : 0.6;
      const target = scr.clone().addScaledVector(D, THREE.MathUtils.clamp(t, 0.35, 0.9));
      const nb = ctx.nb;
      let rootX = -0.6, rootZ = 0;
      for (let i = 0; i < 4; i++) {
        poseSeated(nb, { seatHeight: SUBWAY_SEAT, lean: 14, headPitch: 6, sideLean: 10, rootX, rootZ });
        lookAt(nb, scr);
        const e = eyeWorld(nb);
        rootX = Math.min(rootX + target.x - e.x, -0.45);    // 不能坐进你的位置
        rootZ += target.z - e.z;
      }
      poseSeated(nb, { seatHeight: SUBWAY_SEAT, lean: 14, headPitch: 6, sideLean: 10, rootX, rootZ });
      lookAt(nb, scr);
      armOnLap(nb, 'l'); armOnLap(nb, 'r');
      return {
        you, nb: capturePose(nb), phone, reach,
        props: { stool: 0, table: 0, bench: 1, bed: 0 },
        explain: { pos: scr.clone().add(v3(-0.5, 1.45, -1.2)), target: scr.clone().add(v3(-0.24, -0.04, 0.02)), fov: 25 },
        derived: {},
      };
    },
  },
  {
    id: 'side', name: '侧卧', lying: true,
    hint: '向左侧躺在床上看手机：手机举在脸前，但离下面那只眼睛更近，屏幕不在两眼正中——两只眼睛看屏幕的角度差得多，双眼色差很大',
    params: [
      { key: 'dist', label: '观看距离', min: 18, max: 40, step: 1, unit: 'cm' },
      { key: 'shift', label: '手机偏向下面的眼睛', min: -20, max: 80, step: 1, unit: 'mm' },
      { key: 'turn', label: '屏幕转向上面的眼睛', min: -30, max: 30, step: 1, unit: '°' },
    ],
    defaults: { dist: 22, shift: 45, turn: 0 },
    drag: { x: { key: 'turn', perPx: 0.2 }, y: { key: 'shift', perPx: -0.3 } },
    build(ctx, p) {
      const { you, dims } = ctx;
      poseLyingLeft(you, { bedY: BED_Y, pelvisX: -0.35, backZ: -0.05, headPitch: 12 });
      // 手机：在脸前 dist 处，沿两眼连线往下面那只眼睛（左眼）偏 shift；屏幕“上”和头顶同向（内容是正的），
      // 屏幕默认和脸平行（法线朝脸），turn 再把屏幕转向上面那只眼睛
      const eye = eyeWorld(you);
      const { right, up, fwd } = headFrame(you);
      const center = eye.clone().addScaledVector(fwd, p.dist / 100).addScaledVector(right, -p.shift / 1000);
      const normal = fwd.clone().negate().applyAxisAngle(up, (p.turn || 0) * DEG);   // 绕头顶方向转：正值让法线偏向右眼（上面）
      const phone = phoneMatrix(center, normal, up);
      const reach = holdPhoneRight(you, phone, dims, LIE_LEFT);
      return {
        you: capturePose(you), nb: null, phone, reach, lying: true,
        props: { stool: 0, table: 0, bench: 0, bed: 1 },
        explain: camFrom(eye, center, v3(-0.5, 0.3, 0.34), v3(0.02, -0.01, 0.06), 36),   // 从脚那头的前上方看：脸、两眼的视线和手机都在画面里
        derived: {},
      };
    },
  },
];
