/*
 * 风格样张：同一个场景，只换背景、人物材质、灯光和强调色。
 */
import * as THREE from 'three';
import type { LookParams } from './look';

export interface Style {
  id: string;
  name: string;
  note: string;
  bg: [string, string];          // 背景径向渐变：中心 → 边缘
  ui: { text: string; dim: string; panel: string };
  accent: string;
  look: LookParams;              // 人物半透明外观
  prop: () => THREE.Material;    // 凳子
  shadow: number;                // 地面投影浓度
  exposure: number;
  env: number;                   // 环境反射强度
  lights: (scene: THREE.Scene, target: THREE.Vector3) => THREE.DirectionalLight;   // 返回投影主光
}

function keyLight(scene: THREE.Scene, target: THREE.Vector3, color: string, intensity: number, pos: [number, number, number]) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(...pos).add(target);
  l.target.position.copy(target);
  l.castShadow = true;
  l.shadow.mapSize.set(2048, 2048);
  l.shadow.radius = 6;
  l.shadow.blurSamples = 16;
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.02;
  const s = l.shadow.camera as THREE.OrthographicCamera;
  s.left = -1.2; s.right = 1.2; s.top = 1.4; s.bottom = -1.0; s.near = 0.1; s.far = 8;
  scene.add(l, l.target);
  return l;
}
function rim(scene: THREE.Scene, target: THREE.Vector3, color: string, intensity: number, pos: [number, number, number]) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(...pos).add(target);
  l.target.position.copy(target);
  scene.add(l, l.target);
}

export const STYLES: Style[] = [
  {
    id: 'a', name: 'A · 暗场冷光', note: '近黑舞台 + 半透明人物，冷色轮廓光勾边，强调色蓝',
    bg: ['#22252b', '#060708'],
    ui: { text: '#f2f3f5', dim: '#9aa0aa', panel: 'rgba(18,19,22,.72)' },
    accent: '#4aa3ff',
    look: { color: '#dfe5ee', rim: '#8cc0ff', rimStrength: 1.3, rimPower: 2.2, alphaCenter: 0.12, alphaEdge: 0.9, roughness: 0.5, lit: 0.35 },
    prop: () => new THREE.MeshStandardMaterial({ color: '#25272c', roughness: 0.6 }),
    shadow: 0.55, exposure: 1.0, env: 0.35,
    lights(scene, t) {
      scene.add(new THREE.HemisphereLight('#cfd8e6', '#0c0d10', 0.35));
      const k = keyLight(scene, t, '#fff4e8', 2.6, [1.2, 2.4, 1.6]);
      rim(scene, t, '#8fbaff', 2.2, [-1.6, 1.4, -1.8]);
      rim(scene, t, '#ffffff', 0.6, [-2.0, 0.6, 0.8]);
      return k;
    },
  },
  {
    id: 'b', name: 'B · 浅灰影棚', note: '浅灰无缝背景 + 烟灰半透明人物 + 大面积柔光，强调色橙',
    bg: ['#f6f7f9', '#d5d8dd'],
    ui: { text: '#16181c', dim: '#5d636e', panel: 'rgba(255,255,255,.75)' },
    accent: '#ff5a1f',
    look: { color: '#2f353e', rim: '#2f353e', rimStrength: 0.0, rimPower: 1.8, alphaCenter: 0.34, alphaEdge: 0.92, roughness: 0.55, lit: 0.55 },
    prop: () => new THREE.MeshStandardMaterial({ color: '#c3c7ce', roughness: 0.7 }),
    shadow: 0.28, exposure: 1.05, env: 0.6,
    lights(scene, t) {
      scene.add(new THREE.HemisphereLight('#ffffff', '#b9bdc4', 1.1));
      const k = keyLight(scene, t, '#ffffff', 2.2, [1.0, 3.0, 1.4]);
      rim(scene, t, '#ffffff', 1.4, [-1.8, 1.6, -1.6]);
      return k;
    },
  },
  {
    id: 'c', name: 'C · 夜蓝磨砂玻璃', note: '深蓝夜景 + 磨砂玻璃人物（带折射）+ 青紫轮廓光，强调色青',
    bg: ['#1a2b52', '#04060c'],
    ui: { text: '#eef4ff', dim: '#93a3c4', panel: 'rgba(8,14,30,.7)' },
    accent: '#5fe1ff',
    look: { color: '#dce8ff', rim: '#5fe1ff', rimStrength: 0.7, rimPower: 2.2, alphaCenter: 0.55, alphaEdge: 0.95, roughness: 0.4, clearcoat: 0.6, glass: true },
    prop: () => new THREE.MeshStandardMaterial({ color: '#16203a', roughness: 0.5, metalness: 0.2 }),
    shadow: 0.4, exposure: 1.1, env: 0.8,
    lights(scene, t) {
      scene.add(new THREE.HemisphereLight('#9fb6ff', '#05070c', 0.5));
      const k = keyLight(scene, t, '#e6efff', 1.8, [1.2, 2.6, 1.4]);
      rim(scene, t, '#5fe1ff', 3.0, [-1.6, 1.2, -1.6]);
      rim(scene, t, '#b18cff', 1.6, [1.8, 0.8, -1.4]);
      return k;
    },
  },
];

/** 径向渐变背景（作为 scene.background，透明材质也能折射到它）。 */
export function gradientTexture(inner: string, outer: string, w = 1600, h = 900) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!;
  const r = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.hypot(w, h) * 0.6);
  r.addColorStop(0, inner); r.addColorStop(1, outer);
  g.fillStyle = r; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
