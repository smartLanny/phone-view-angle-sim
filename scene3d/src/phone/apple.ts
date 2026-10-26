/*
 * 苹果官网 AR 模型做的机身（USDZ → GLB，© Apple，来源见 CREDITS.md）：iPhone 18 Pro Max（iPhone 18 Pro 按官方尺寸放大）、
 * iPhone 17 Pro Max。GLB 已经换到手机局部坐标（x 右、y 上、z 指向屏幕外，原点在屏幕玻璃正面中心，单位米），
 * 模型自带的屏幕在转换时去掉了，这里换成按实测数据着色的屏幕。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildScreenGeometry } from './geometry';
import type { DeviceSpec } from './devices';
import type { PhoneModel } from './model';
import { createScreenMaterial } from '../optics/screen';

/**
 * 选定颜色变体（KHR_materials_variants）：把各图元的 material 换成该变体的材质，返回新的 GLB。
 * three.js 的 GLTFLoader 不认这个扩展，所以在解析前改写 JSON。没有这个变体时原样返回。
 */
export function selectVariant(glb: ArrayBuffer, variant?: string): ArrayBuffer {
  if (!variant) return glb;
  const dv = new DataView(glb), jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen)));
  const vi = (json.extensions?.KHR_materials_variants?.variants || []).findIndex((v: { name: string }) => v.name === variant);
  if (vi < 0) return glb;
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    const m = prim.extensions?.KHR_materials_variants?.mappings?.find((x: { variants: number[] }) => x.variants.includes(vi));
    if (m) prim.material = m.material;
  }
  const text = new TextEncoder().encode(JSON.stringify(json)), pad = (4 - (text.length % 4)) % 4;
  const rest = new Uint8Array(glb, 20 + jsonLen);           // BIN 块（含块头）
  const out = new Uint8Array(20 + text.length + pad + rest.length), o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
  o.setUint32(12, text.length + pad, true); o.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + text.length + pad); out.set(rest, 20 + text.length + pad);
  return out.buffer as ArrayBuffer;
}

export async function buildApplePhone(spec: DeviceSpec, glb: ArrayBuffer): Promise<PhoneModel> {
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  const src = gltf.scene;
  src.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const scr = createScreenMaterial(), sc = spec.screen;
  const half = new THREE.Vector2(...sc.half!).multiplyScalar(0.001);
  scr.uniforms.uHalf.value.copy(half);
  scr.uniforms.uCorner.value = sc.corner / 1000;
  scr.uniforms.uCut.value.set(sc.cutout.y / 1000, sc.cutout.half / 1000, sc.cutout.r / 1000);
  const screen = new THREE.Mesh(buildScreenGeometry(spec.body), scr);
  screen.position.z = 0.00002;
  screen.name = 'screen';
  const group = new THREE.Group();
  group.name = 'phone:' + spec.id;
  group.add(src, screen);
  return {
    group, screen, spec, half, source: 'apple',
    setColor() { /* 换色要换材质变体，由 app.ts 重新建模型 */ },
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
