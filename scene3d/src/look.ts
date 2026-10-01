/*
 * 人物的半透明简化外观。
 * 每个蒙皮网格复制一份只写深度的“预通道”，再用透明材质画颜色（depthFunc ≤），
 * 这样半透明时只看到最外层表面，看不到身体内部和手臂交叠处的重影。
 * 透明度、边缘光都放在 uniform 里，后面做“切换后淡到 0.3”时直接改 fade。
 */
import * as THREE from 'three';
import type { Character } from './rig';

export interface LookParams {
  color: string;        // 主体颜色
  rim: string;          // 边缘光颜色
  rimStrength: number;
  rimPower: number;     // 越大边缘越窄
  alphaCenter: number;  // 正对视线处的不透明度
  alphaEdge: number;    // 轮廓处的不透明度
  roughness: number;
  lit?: number;         // 受光部分的比例（越小越“平”，只剩轮廓光）
  clearcoat?: number;
  glass?: boolean;      // 物理透射（磨砂玻璃）
}

export interface Look {
  uniforms: { uFade: { value: number }; uHeadView: { value: THREE.Vector3 }; uHeadR: { value: number }; uHeadFade: { value: number } };
  setFade(v: number): void;
  /**
   * 深度预通道的强度 0..1：人物淡入 / 淡出途中按这个比例抖动着写深度（不是一下子开 / 关），
   * 既不会在身后的物体上突然挖出人形的洞，也不会在淡入完成时突然换一种样子。
   */
  setDepth(k: number): void;
  /** 头部淡出：head 为头部中心的世界坐标，fade 0..1（1 = 完全隐藏），每帧随镜头更新。 */
  setHead(head: THREE.Vector3, camera: THREE.Camera, fade: number): void;
}

export function applyLook(c: Character, p: LookParams, renderOrder = 10): Look {
  const uniforms = {
    uFade: { value: 1 },
    uRim: { value: new THREE.Color(p.rim) },
    uRimStrength: { value: p.rimStrength },
    uRimPower: { value: p.rimPower },
    uAlphaCenter: { value: p.alphaCenter },
    uAlphaEdge: { value: p.alphaEdge },
    uLit: { value: p.lit ?? 1 },
    uHeadView: { value: new THREE.Vector3(0, 0, 1e3) },
    uHeadR: { value: 0.16 },
    uHeadFade: { value: 0 },
    uDepthK: { value: 1 },
  };
  const mat = new THREE.MeshPhysicalMaterial({
    color: p.color, roughness: p.roughness, metalness: 0,
    clearcoat: p.clearcoat ?? 0.3, clearcoatRoughness: 0.35,
    transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth,
    ...(p.glass ? { transmission: 0.9, thickness: 0.22, ior: 1.42, attenuationColor: new THREE.Color(p.rim), attenuationDistance: 0.8 } : {}),
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFade; uniform vec3 uRim; uniform float uRimStrength; uniform float uRimPower;
        uniform float uAlphaCenter; uniform float uAlphaEdge; uniform float uLit;
        uniform vec3 uHeadView; uniform float uHeadR; uniform float uHeadFade;`)
      .replace('#include <opaque_fragment>', `
        float fres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), uRimPower);
        outgoingLight = outgoingLight * uLit + uRim * fres * uRimStrength;
        diffuseColor.a = mix(uAlphaCenter, uAlphaEdge, fres) * uFade;
        float hd = length(-vViewPosition - uHeadView);
        diffuseColor.a *= 1.0 - uHeadFade * (1.0 - smoothstep(uHeadR * 0.75, uHeadR, hd));
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'figure-look' + (p.glass ? '-glass' : '');

  // 深度预通道：头部淡出过半后直接丢弃头部片元，镜头进入头部时不挡视线
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  depthMat.onBeforeCompile = (sh) => {
    sh.uniforms.uHeadView = uniforms.uHeadView; sh.uniforms.uHeadR = uniforms.uHeadR; sh.uniforms.uHeadFade = uniforms.uHeadFade;
    sh.uniforms.uFade = uniforms.uFade; sh.uniforms.uDepthK = uniforms.uDepthK;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vViewP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvViewP = mvPosition.xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vViewP; uniform vec3 uHeadView; uniform float uHeadR; uniform float uHeadFade; uniform float uFade; uniform float uDepthK;')
      .replace('void main() {', 'void main() {\n  if (uDepthK < 0.01 || uFade < 0.02 || (uHeadFade > 0.5 && length(vViewP - uHeadView) < uHeadR * 0.9)) discard;\n  if (uDepthK < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) >= uDepthK) discard;');
  };
  depthMat.customProgramCacheKey = () => 'figure-depth';
  for (const m of [...c.meshes]) {
    const prepass = m.clone() as THREE.SkinnedMesh;   // 共用几何体与骨架
    prepass.material = depthMat;
    prepass.renderOrder = renderOrder;
    prepass.castShadow = true;
    prepass.receiveShadow = false;
    prepass.name = m.name + ':depth';
    m.parent!.add(prepass);
    m.material = mat;
    m.renderOrder = renderOrder + 1;
    m.castShadow = false;
  }
  return {
    uniforms,
    setFade(v: number) { uniforms.uFade.value = v; },
    setDepth(k: number) { uniforms.uDepthK.value = Math.min(1, Math.max(0, k)); },
    setHead(head, camera, fade) {
      uniforms.uHeadView.value.copy(head).applyMatrix4(camera.matrixWorldInverse);
      uniforms.uHeadFade.value = fade;
    },
  };
}
