/*
 * 手机模型：机身（PBR 材质）+ 实测屏幕 + 背屏。
 * group 的局部坐标与 geometry.ts 一致（米），原点在屏幕玻璃中心。
 */
import * as THREE from 'three';
import { buildBody, buildScreenGeometry, MAT, MAT_COUNT } from './geometry';
import type { DeviceSpec, ColorWay } from './devices';
import { createScreenMaterial } from '../optics/screen';

/** 背屏的示意画面：抽象的发光圆角块（不是官方壁纸）。 */
function rearDisplayTexture(accent: string) {
  const W = 976, H = 596, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#05060c'; g.fillRect(0, 0, W, H);
  const blob = (x: number, y: number, w: number, h: number, a: number) => {
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, `rgba(255,255,255,${0.05 * a})`);
    gr.addColorStop(0.5, accent);
    gr.addColorStop(1, `rgba(0,0,0,0)`);
    g.save(); g.globalAlpha = a; g.fillStyle = gr;
    g.shadowColor = accent; g.shadowBlur = 40;
    g.beginPath(); g.roundRect(x, y, w, h, Math.min(w, h) / 2); g.fill(); g.restore();
  };
  // 镜头在显示区一侧（从背面看在左侧），画面集中在另一侧
  blob(470, 60, 170, 470, 0.85);
  blob(600, 60, 320, 220, 0.75);
  blob(600, 300, 320, 230, 0.6);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 星河蓝后盖的细小闪点（示意）。 */
function sparkleTexture() {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const a = rnd() ** 3;
    g.fillStyle = `rgba(200,215,255,${0.25 + 0.75 * a})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + a * 1.5, 1 + a * 1.5);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 6);
  return t;
}

export interface PhoneModel {
  group: THREE.Group;
  screen: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  spec: DeviceSpec;
  /** 显示区半宽 / 半高（米） */
  half: THREE.Vector2;
  /** 外观来源：参数化建模 / 苹果官网 AR 模型（本机） */
  source: 'param' | 'apple';
  setColor(c: ColorWay): void;
  dispose(): void;
}

export function buildPhone(spec: DeviceSpec, colorId?: string): PhoneModel {
  const group = new THREE.Group();
  group.name = 'phone:' + spec.id;
  const body = buildBody(spec.body);

  const frame = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const back = new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.12 });
  const islandGlass = new THREE.MeshPhysicalMaterial({
    color: '#050507', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    emissive: '#ffffff', emissiveIntensity: spec.rearDisplay ? 1.15 : 0,
  });
  const lensRing = new THREE.MeshPhysicalMaterial({ color: '#141518', metalness: 0.9, roughness: 0.3 });
  const lensGlass = new THREE.MeshPhysicalMaterial({ color: '#020306', roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.6, iridescenceIOR: 1.6 });
  const dark = new THREE.MeshPhysicalMaterial({ color: '#060608', roughness: 0.08, clearcoat: 1 });
  const flash = new THREE.MeshPhysicalMaterial({ color: '#d9cfa6', roughness: 0.45, clearcoat: 0.8 });
  const mats: THREE.Material[] = new Array(MAT_COUNT);
  mats[MAT.FRAME] = frame; mats[MAT.BUTTON] = frame; mats[MAT.ISLAND_RIM] = frame;
  mats[MAT.BACK] = back; mats[MAT.ISLAND] = islandGlass;
  mats[MAT.LENS_RING] = lensRing; mats[MAT.LENS_GLASS] = lensGlass;
  mats[MAT.DARK] = dark; mats[MAT.FLASH] = flash;
  const bodyMesh = new THREE.Mesh(body, mats);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  const scr = createScreenMaterial();
  const sc = spec.screen;
  const ratio = sc.resH / sc.resW;
  const wmm = (sc.diag * 25.4) / Math.sqrt(1 + ratio * ratio);
  const half = new THREE.Vector2(wmm / 2000, (wmm * ratio) / 2000);
  scr.uniforms.uHalf.value.copy(half);
  scr.uniforms.uCorner.value = sc.corner / 1000;
  scr.uniforms.uCut.value.set(sc.cutout.y / 1000, sc.cutout.half / 1000, sc.cutout.r / 1000);
  const screen = new THREE.Mesh(buildScreenGeometry(spec.body), scr);
  screen.name = 'screen';
  group.add(screen);

  let sparkle: THREE.Texture | null = null;
  const setColor = (c: ColorWay) => {
    frame.color.set(c.frame);
    back.color.set(c.back);
    back.roughness = c.backRough;
    back.clearcoatRoughness = c.backRough > 0.3 ? 0.45 : 0.08;
    if (c.sparkle) { sparkle ||= sparkleTexture(); back.emissiveMap = sparkle; back.emissive.set('#9fb4ff'); back.emissiveIntensity = 0.35; }
    else { back.emissiveMap = null; back.emissive.set('#000'); }
    back.needsUpdate = true;
    if (spec.rearDisplay) {
      islandGlass.emissiveMap?.dispose();
      islandGlass.emissiveMap = rearDisplayTexture(c.id === 'black' ? '#ff9a3c' : c.id === 'white' ? '#3fe0b8' : c.id === 'pink' ? '#ff6f8e' : '#4b6bff');
      islandGlass.needsUpdate = true;
    }
  };
  setColor(spec.colors.find((c) => c.id === colorId) || spec.colors[0]);

  return {
    group, screen: screen as PhoneModel['screen'], spec, half, setColor, source: 'param',
    dispose() { body.dispose(); screen.geometry.dispose(); mats.forEach((m) => m.dispose()); scr.dispose(); },
  };
}
