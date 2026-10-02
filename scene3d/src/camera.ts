/*
 * 镜头：讲解视角（可拖动环绕）与人眼视角之间平滑过渡。
 * 人眼视角的镜头就在两眼中点、看向屏幕中心；近裁剪面 1 cm。
 * 过渡时头部先淡出（progress 0.2→0.55），镜头再进入头部，避免看到头部内部。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ViewMode = 'explain' | 'eye';
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface Pose { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; near: number }

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mode: ViewMode = 'explain';
  /** 0 = 讲解视角，1 = 人眼视角（过渡中为中间值） */
  progress = 0;
  private anim: { from: number; to: number; t0: number; dur: number } | null = null;
  private explainFov = 30;
  private baseFov = 30;
  private aspect = 1.6;
  private eyeFov = 46;
  /** 人眼视角的视场：按手机在眼中的张角算，让手机占画面高度约 70%（只是放大，不改变观看位置） */
  setEyeFov(f: number) { this.eyeFov = f; }

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.explainFov, aspect, 0.05, 30);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.35;
    this.controls.maxDistance = 4;
    this.controls.maxPolarAngle = Math.PI * 0.58;
    this.controls.enablePan = false;
  }

  /** 竖屏 / 窄屏时放宽讲解视角的视场，让人和手机都在画面里（按横向覆盖范围不变来换算）。 */
  /** 视场最多放宽 1.6 倍，其余靠把镜头沿视线往后拉（避免近处物体被广角拉得很大）。 */
  private dolly = 1;
  private fit() {
    const k = Math.max(1, 1.5 / this.aspect);
    const fk = Math.min(k, 1.6);
    this.dolly = k / fk;
    this.explainFov = (2 * Math.atan(Math.tan((this.baseFov * Math.PI) / 360) * fk) * 180) / Math.PI;
  }
  private base: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  setAspect(a: number) {
    this.aspect = a;
    this.camera.aspect = a;
    const before = this.dolly;
    this.fit();
    if (this.progress === 0) {
      this.camera.fov = this.explainFov;
      if (this.base && Math.abs(before - this.dolly) > 1e-3) this.setExplain(this.base.pos, this.base.target, this.baseFov);
    }
    this.camera.updateProjectionMatrix();
  }

  /** 设置讲解视角的机位（切换场景时调用）。 */
  setExplain(pos: THREE.Vector3, target: THREE.Vector3, fov = 30) {
    this.base = { pos: pos.clone(), target: target.clone() };
    this.baseFov = fov;
    this.fit();
    fov = this.explainFov;
    pos = target.clone().add(pos.clone().sub(target).multiplyScalar(this.dolly));
    this.controls.target.copy(target);
    if (this.progress > 0) { this.savedPos = pos.clone(); return; }   // 人眼视角里只更新“回去”的机位
    this.camera.position.copy(pos);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  /** 当前讲解机位（人眼视角时为退出后要回到的机位）。 */
  getExplain() { return { pos: (this.savedPos ?? this.camera.position).clone(), target: this.controls.target.clone() }; }
  /** 当前讲解机位，换算回 setExplain 用的“拉远前”坐标（含用户手动转过的镜头），用来从当前机位平滑转到新机位 */
  getExplainBase() {
    const t = this.controls.target.clone(), p = (this.savedPos ?? this.camera.position).clone();
    return { pos: t.clone().add(p.sub(t).divideScalar(this.dolly)), target: t, fov: this.baseFov };
  }

  private explainPose(): Pose {
    const c = this.camera.clone();
    c.position.copy(this.savedPos ?? this.camera.position);
    c.lookAt(this.controls.target);
    return { pos: c.position.clone(), quat: c.quaternion.clone(), fov: this.explainFov, near: 0.05 };
  }
  private savedPos: THREE.Vector3 | null = null;

  static eyePose(eye: THREE.Vector3, look: THREE.Vector3, up: THREE.Vector3, fov: number): Pose {
    const m = new THREE.Matrix4().lookAt(eye, look, up);
    return { pos: eye.clone(), quat: new THREE.Quaternion().setFromRotationMatrix(m), fov, near: 0.01 };
  }

  setMode(mode: ViewMode, dur = 1250) {
    if (mode === this.mode && !this.anim) return;
    if (mode === 'eye' && this.progress === 0) this.savedPos = this.camera.position.clone();
    this.mode = mode;
    this.anim = { from: this.progress, to: mode === 'eye' ? 1 : 0, t0: performance.now(), dur: dur * Math.abs((mode === 'eye' ? 1 : 0) - this.progress) || 1 };
  }

  /** 直接跳到某个过渡进度（调试 / 截图用）。 */
  seek(p: number) { this.anim = null; if (p > 0 && this.progress === 0) this.savedPos = this.camera.position.clone(); this.progress = p; this.mode = p >= 0.5 ? 'eye' : 'explain'; }

  get busy() { return !!this.anim; }

  /** 每帧调用：eye / look 为当前姿势下的眼睛与屏幕中心。返回头部淡出量。 */
  update(now: number, eye: THREE.Vector3, look: THREE.Vector3, up: THREE.Vector3): number {
    if (this.anim) {
      const k = Math.min(1, (now - this.anim.t0) / this.anim.dur);
      this.progress = this.anim.from + (this.anim.to - this.anim.from) * k;
      if (k >= 1) { this.progress = this.anim.to; this.anim = null; }
    }
    const p = this.progress;
    this.controls.enabled = p === 0;
    if (p === 0) {
      if (this.savedPos) { this.camera.position.copy(this.savedPos); this.savedPos = null; }
      this.camera.fov = this.explainFov; this.camera.near = 0.05;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      return 0;
    }
    const a = this.explainPose(), b = CameraRig.eyePose(eye, look, up, this.eyeFov);
    const e = ease(p);
    // 位置走一条略向上拱的曲线，避免直线穿过肩膀
    const mid = a.pos.clone().lerp(b.pos, 0.5).add(new THREE.Vector3(0, 0.12 * Math.sin(Math.PI * e), 0));
    const q1 = a.pos.clone().lerp(mid, e), q2 = mid.clone().lerp(b.pos, e);
    this.camera.position.copy(q1.lerp(q2, e));
    this.camera.quaternion.copy(a.quat).slerp(b.quat, e);
    this.camera.fov = a.fov + (b.fov - a.fov) * e;
    this.camera.near = a.near + (b.near - a.near) * e;
    this.camera.updateProjectionMatrix();
    return THREE.MathUtils.smoothstep(p, 0.2, 0.55);
  }
}
