/*
 * iPhone 18 Pro Max 外观：用苹果官网 iPhone 18 Pro 页面的 AR 模型（USDZ → GLB，只在本机，见 README），
 * 等比例放大成 Pro Max：长宽按机身高 150.0 → 163.4 mm 放大，厚度不变（两款都是 8.75 mm）。
 * 模型自带的屏幕（壁纸贴图）隐藏，换成按实测数据着色的屏幕。
 * 原模型：Y 向上、单位厘米、屏幕朝 −z；这里换到手机局部坐标（x 右、y 上、z 指向屏幕外，原点在屏幕玻璃中心，单位米）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildScreenGeometry } from './geometry';
import type { DeviceSpec } from './devices';
import type { PhoneModel } from './model';
import { createScreenMaterial } from '../optics/screen';

/** 我们的配色 id → 苹果模型里的颜色变体名 */
export const APPLE_VARIANT: Record<string, string> = { burgundy: 'Burgundy', glacier: 'Glacier', silver: 'Silver', black: 'Black' };

export async function buildApplePhone(spec: DeviceSpec, glb: ArrayBuffer): Promise<PhoneModel> {
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const meshes: THREE.Mesh[] = [];
  src.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const bounds = (m: THREE.Object3D) => new THREE.Box3().setFromObject(m);
  const zf = box.min.z;                                      // 正面玻璃
  const flatFront = (b: THREE.Box3) => b.max.z - b.min.z < 0.01 && Math.abs(b.min.z - zf) < 0.02;

  // 原屏幕：正面那块带自发光贴图的大平面
  const display = meshes
    .filter((m) => flatFront(bounds(m)) && (m.material as THREE.MeshStandardMaterial).emissiveMap)
    .sort((a, b) => { const A = bounds(a).getSize(new THREE.Vector3()), B = bounds(b).getSize(new THREE.Vector3()); return B.x * B.y - A.x * A.y; })[0];
  const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
  const k = spec.body.H / ((box.max.y - box.min.y) * 10);    // 等比例放大到 Pro Max 的机身高
  const cm = 0.01;
  // 绕 y 转 180°（x、z 同时取反）+ 缩放 + 平移；行列式为正，不改变三角形绕序
  const M = new THREE.Matrix4().set(
    -k * cm, 0, 0, k * cm * cx,
    0, k * cm, 0, -k * cm * cy,
    0, 0, -cm, cm * zf,
    0, 0, 0, 1,
  );
  const body = new THREE.Group();
  body.matrixAutoUpdate = false;
  body.matrix.copy(M);
  body.add(src);
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; }

  // 显示区与灵动岛按原模型量取（再放大）；圆角用规格值
  const scr = createScreenMaterial();
  const half = new THREE.Vector2();
  if (display) {
    const b = bounds(display);
    display.visible = false;
    half.set(((b.max.x - b.min.x) / 2) * k * cm, ((b.max.y - b.min.y) / 2) * k * cm);
    const top = b.max.y;
    const island = meshes.find((m) => {
      const ib = bounds(m), s = ib.getSize(new THREE.Vector3()), c = ib.getCenter(new THREE.Vector3());
      return flatFront(ib) && m !== display && s.x > 1 && s.x < 2 && s.y > 0.4 && s.y < 0.8 && Math.abs(c.x - cx) < 0.05 && c.y > cy + 5;
    });
    if (island) {
      const ib = bounds(island), s = ib.getSize(new THREE.Vector3()), c = ib.getCenter(new THREE.Vector3());
      const r = Math.min(s.x, s.y) / 2;
      scr.uniforms.uCut.value.set((top - c.y) * k * cm, (s.x / 2 - r) * k * cm, r * k * cm);
    } else {
      const ct = spec.screen.cutout;
      scr.uniforms.uCut.value.set(ct.y / 1000, ct.half / 1000, ct.r / 1000);
    }
  } else {
    const sc = spec.screen, ratio = sc.resH / sc.resW, w = (sc.diag * 25.4) / Math.sqrt(1 + ratio * ratio);
    half.set(w / 2000, (w * ratio) / 2000);
  }
  scr.uniforms.uHalf.value.copy(half);
  scr.uniforms.uCorner.value = spec.screen.corner / 1000;

  const group = new THREE.Group();
  group.name = 'phone:' + spec.id + ':apple';
  group.add(body);
  const screen = new THREE.Mesh(buildScreenGeometry(spec.body), scr);
  screen.position.z = 0.0002;          // 贴在原模型正面玻璃前 0.2 mm
  screen.name = 'screen';
  group.add(screen);

  return {
    group, screen: screen as PhoneModel['screen'], spec, half, source: 'apple',
    setColor() { /* 换色需要重新加载对应颜色的模型，由 app.ts 处理 */ },
    dispose() {
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of ([] as THREE.Material[]).concat(m.material)) {
          for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
          mat.dispose();
        }
      });
      screen.geometry.dispose(); scr.dispose();
    },
  };
}
