import * as THREE from 'three';
import '../../../web/duo-geometry.js';

/** 持握平面到手机局部坐标的刚体变换；正 Z 为握持面的屏幕方向。 */
export interface PhoneGrip {
  frame: THREE.Matrix4;
  W: number;
  H: number;
  T: number;
}

/** 始终握住右侧刚性叶片，开合时随叶片转动，不把两叶包围盒当作掌宽。 */
export function duoGrip(angle: number, surface: 'inner' | 'outer', mix?: number): PhoneGrip {
  const D = window.DuoGeometry;
  const fold = THREE.MathUtils.clamp(angle, 0, 180);
  const side = 1;
  const leaf = D.leafPose(side, fold), display = D.frame(fold, surface, mix);
  const center = D.rotate([41.2267335, 0.123715, 0], leaf.rotation)
    .map((n: number, i: number) => n + leaf.position[i]);
  const position = new THREE.Vector3(...D.orient(center, display) as [number, number, number]).multiplyScalar(.001);
  const frame = new THREE.Matrix4().makeRotationY(leaf.rotation + display.rotation).setPosition(position);
  const W = .082453467, H = .117949355, T = .00524;
  return { frame, W, H, T };
}
