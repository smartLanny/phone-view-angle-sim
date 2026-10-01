/*
 * 场景预设。每个预设按参数（观看距离、离轴角）摆出完整场景：人物姿势、手机位置、道具、讲解机位。
 * 数字是起点，可以继续微调到看起来自然。
 */
import * as THREE from 'three';
import { capturePose, type Character, type PoseSnap } from './rig';
import { poseSeated, holdPhoneRight, armOnLap, handOnTable, lookAt, phoneMatrix, eyeWorld, type PhoneDims } from './pose';

const DEG = Math.PI / 180;
export const TABLE_Y = 0.70;         // 桌面高度
export const SUBWAY_SEAT = 0.44;     // 地铁座椅高度

export interface Ctx { you: Character; nb: Character; dims: PhoneDims }
export interface ParamDef { key: string; label: string; min: number; max: number; step: number; unit: string }
export interface Props { stool: number; table: number; bench: number }

export interface SceneState {
  you: PoseSnap;
  nb: PoseSnap | null;               // 旁座乘客（只有地铁场景有）
  phone: THREE.Matrix4;
  reach: boolean;                    // 手臂是否够得着（够不着时人物淡化）
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
  /** 从别的场景切过来时，过渡结束后自动进入谁的人眼视角 */
  autoEye?: 'you' | 'nb';
  build(ctx: Ctx, p: Record<string, number>): SceneState;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function camFrom(eye: THREE.Vector3, screen: THREE.Vector3, offset: THREE.Vector3, target = v3(0, 0, 0), fov = 30) {
  const mid = eye.clone().lerp(screen, 0.5);
  return { pos: mid.clone().add(offset), target: mid.clone().add(target), fov };
}

/** 坐着单手拿手机：沿视线放在 dist 处；theta 为手机绕竖直轴转开的角度（眼睛从屏幕右侧斜看）。 */
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
  const phone = phoneMatrix(center, normal, up0);
  const reach = holdPhoneRight(you, phone, dims);
  armOnLap(you, 'l');
  return { eye, phone, reach };
}

export const PRESETS: Preset[] = [
  {
    id: 'front', name: '正视', hint: '手机举在眼睛正前方，屏幕正对眼睛，作为基准',
    params: [
      { key: 'dist', label: '观看距离', min: 20, max: 50, step: 1, unit: 'cm' },
      { key: 'theta', label: '手机转开', min: 0, max: 60, step: 1, unit: '°' },
    ],
    defaults: { dist: 30, theta: 0 },
    build(ctx, p) {
      const { eye, phone, reach } = holding(ctx, p, { seatHeight: 0.46, lean: 2, headPitch: 0, gazePitch: 2, side: 0 });
      const scr = new THREE.Vector3().setFromMatrixPosition(phone);
      return {
        you: capturePose(ctx.you), nb: null, phone, reach,
        props: { stool: 1, table: 0, bench: 0 },
        explain: camFrom(eye, scr, v3(-0.85, 0.26, -0.5), v3(0, -0.04, 0)),
        derived: {},
      };
    },
  },
  {
    id: 'normal', name: '正常手持', hint: '坐着单手拿手机，眼睛到屏幕约 30 cm，微微低头',
    params: [
      { key: 'dist', label: '观看距离', min: 20, max: 50, step: 1, unit: 'cm' },
      { key: 'theta', label: '手机转开', min: 0, max: 60, step: 1, unit: '°' },
    ],
    defaults: { dist: 30, theta: 0 },
    build(ctx, p) {
      const { eye, phone, reach } = holding(ctx, p, { seatHeight: 0.46, lean: 8, headPitch: 18, gazePitch: 28, side: -0.02 });
      const scr = new THREE.Vector3().setFromMatrixPosition(phone);
      return {
        you: capturePose(ctx.you), nb: null, phone, reach,
        props: { stool: 1, table: 0, bench: 0 },
        explain: camFrom(eye, scr, v3(-0.9, 0.34, -0.38), v3(0, -0.05, 0)),
        derived: {},
      };
    },
  },
  {
    id: 'desk', name: '放在桌上', hint: '手机平放在桌面，人坐在桌前低头看；眼睛高出桌面约 45 cm',
    params: [{ key: 'theta', label: '离轴角', min: 15, max: 60, step: 1, unit: '°' }],
    defaults: { theta: 34 },
    build(ctx, p) {
      const { you, dims } = ctx;
      poseSeated(you, { seatHeight: 0.46, lean: 9, headPitch: 30 });
      const glassY = TABLE_Y + dims.T + dims.bump;     // 背面相机模组着桌
      let eye = eyeWorld(you), center = v3(0, 0, 0);
      for (let i = 0; i < 3; i++) {
        const h = eye.y - glassY;
        center = v3(eye.x, glassY, eye.z + h * Math.tan(p.theta * DEG));
        lookAt(you, center);
        eye = eyeWorld(you);
      }
      // 平放：屏幕朝上，手机顶部朝远离人的方向
      const phone = phoneMatrix(center, v3(0, 1, 0), v3(0, 0, 1));
      const r = handOnTable(you, 'r', v3(center.x - 0.22, TABLE_Y + 0.035, center.z - 0.2));
      const l = handOnTable(you, 'l', v3(center.x + 0.22, TABLE_Y + 0.035, center.z - 0.2));
      return {
        you: capturePose(you), nb: null, phone, reach: r && l,
        props: { stool: 1, table: 1, bench: 0 },
        explain: camFrom(eye, center, v3(-0.95, 0.55, -0.55), v3(0, -0.1, 0.06), 32),
        derived: { dist: eye.distanceTo(center) * 100, height: (eye.y - glassY) * 100 },
      };
    },
  },
  {
    id: 'subway', name: '地铁旁座', hint: '你坐着正常看手机，右边座位的乘客从侧面斜看你的屏幕',
    params: [{ key: 'theta', label: '旁人离轴角', min: 40, max: 70, step: 1, unit: '°' }],
    defaults: { theta: 55 },
    autoEye: 'nb',
    build(ctx, p) {
      const { eye, phone, reach } = holding(ctx, { dist: 30, theta: 0 }, { seatHeight: SUBWAY_SEAT, lean: 8, headPitch: 18, gazePitch: 28, side: -0.02 });
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
        props: { stool: 0, table: 0, bench: 1 },
        explain: { pos: scr.clone().add(v3(-0.5, 1.45, -1.2)), target: scr.clone().add(v3(-0.24, -0.04, 0.02)), fov: 25 },
        derived: {},
      };
    },
  },
];
