import * as THREE from 'three';
import '../../../web/duo-geometry.js';

/** 持握平面到手机局部坐标的刚体变换；正 Z 为握持面的屏幕方向。 */
export interface PhoneGrip {
  frame: THREE.Matrix4;
  W: number;
  H: number;
  T: number;
  thumb: THREE.Vector3;
  pinky: THREE.Vector3;
  fingerX: number;
  fingerZ: number;
}

/** 与原生 Duo 机框一致，握住左侧刚性叶片；折叠后不把两叶包围盒当作掌宽。 */
export function duoGrip(angle: number, surface: 'inner' | 'outer'): PhoneGrip {
  const D = window.DuoGeometry;
  const fold = THREE.MathUtils.clamp(angle, 0, 180);
  const side = -1;
  const leaf = D.leafPose(side, fold), display = D.frame(fold, surface);
  const center = D.rotate([side * 41.2267335, 0.123715, surface === 'outer' ? -5.24 : 0], leaf.rotation)
    .map((n: number, i: number) => n + leaf.position[i]);
  const position = new THREE.Vector3(...D.orient(center, display) as [number, number, number]).multiplyScalar(.001);
  const frame = new THREE.Matrix4().makeRotationY(leaf.rotation + display.rotation + (surface === 'outer' ? Math.PI : 0)).setPosition(position);
  const stack = surface === 'outer' ? Math.max(0, Math.cos(fold * Math.PI / 180)) * 5.76116 : 0;
  const W = .082453467, H = .117949355, T = (5.24 + stack) / 1000;
  const back = surface === 'outer' ? Math.sin(Math.min(fold, 90) * Math.PI / 180) ** 2 : 0;
  return { frame, W, H, T,
    fingerX: -W / 2 - .007 + .019 * back,
    fingerZ: -T / 2 * (1 - back) + (-T - .009) * back,
    pinky: new THREE.Vector3(-W / 2 + .012, -H / 2 - .007 + .019 * back, -T / 2 * (1 - back) + (-T - .009) * back),
    thumb: new THREE.Vector3(W / 2 + (surface === 'inner' ? -.008 : .007), 0, surface === 'inner' ? -T - .007 : -T / 2),
  };
}
