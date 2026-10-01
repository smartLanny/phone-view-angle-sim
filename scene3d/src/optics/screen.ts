/*
 * 屏幕着色器：由原型 app.js 的片元着色器移植。
 * 每个像素用它相对“眼睛”（不是镜头）的实际离轴角查表，得到实测的亮度变化与色偏。
 * 不受光照、不做色调映射、不进后期，正视纯白时输出正好是 255。
 */
import * as THREE from 'three';
import type { AngleModel } from './model';

const VS = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FS = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  varying vec3 vLocal;
  out highp vec4 outColor;
  uniform sampler2D uImg;
  uniform sampler2D uLut;
  uniform int uLutW;
  uniform vec3 uEye;        // 眼睛位置（手机局部坐标，米）
  uniform vec2 uHalf;       // 显示区半宽 / 半高（米）
  uniform float uCorner;    // 显示区圆角
  uniform vec3 uCut;        // 前摄开孔：中心距显示区顶边、胶囊直线段半长、半径
  uniform vec2 uImgScale;
  uniform int uMode;        // 0 实测效果  1 原图  2 离轴角分布
  uniform float uChroma;    // 色偏（色度偏离）的倍数，亮度不变；1 = 实测。双眼叠加时按双眼累加放大

  vec3 srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec3 lin2srgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

  vec3 lut(int blk, float th, float ps) {
    float x = clamp(th, 0.0, float(uLutW - 1));
    int x0 = min(int(floor(x)), uLutW - 2);
    float fx = x - float(x0);
    float y = mod(ps, 360.0);
    int y0 = min(int(floor(y)), 359);
    int y1 = (y0 + 1) % 360;
    float fy = y - float(y0);
    int off = blk * 360;
    vec3 a = texelFetch(uLut, ivec2(x0, off + y0), 0).rgb;
    vec3 b = texelFetch(uLut, ivec2(x0 + 1, off + y0), 0).rgb;
    vec3 c = texelFetch(uLut, ivec2(x0, off + y1), 0).rgb;
    vec3 d = texelFetch(uLut, ivec2(x0 + 1, off + y1), 0).rgb;
    return mix(mix(a, b, fx), mix(c, d, fx), fy);
  }
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float isoLine(float v, float s) {
    float f = v / s, w = max(fwidth(f), 1e-6);
    return 1.0 - smoothstep(0.0, w * 1.3, abs(fract(f + 0.5) - 0.5));
  }

  void main() {
    vec2 pp = vLocal.xy;
    float px = length(fwidth(pp));
    float inside = 1.0 - smoothstep(-px, 0.0, sdRoundBox(pp, uHalf, uCorner));

    vec3 d = uEye - vec3(pp, 0.0);
    float th = degrees(atan(length(d.xy), d.z));
    float ps = degrees(atan(d.y, d.x));
    if (ps < 0.0) ps += 360.0;

    vec2 iuv = (pp / (2.0 * uHalf)) * uImgScale + 0.5;
    vec3 lin = srgb2lin(texture(uImg, iuv).rgb);

    vec3 scr;
    if (uMode == 2) {
      float t = clamp(th / 70.0, 0.0, 1.0);
      scr = mix(vec3(0.80, 0.89, 0.98), vec3(0.05, 0.21, 0.42), t);
      scr = mix(scr, t < 0.5 ? vec3(0.04, 0.1, 0.22) : vec3(0.85, 0.92, 1.0), 0.6 * isoLine(th, 10.0));
    } else if (uMode == 1) {
      scr = lin2srgb(lin);
    } else {
      vec3 sim = vec3(dot(lut(0, th, ps), lin), dot(lut(1, th, ps), lin), dot(lut(2, th, ps), lin));
      if (uChroma != 1.0) {
        // 只放大色度偏离：同样亮度、不偏色的颜色 + 偏色部分 × 倍数（偏色部分亮度为 0，所以亮度不变）
        vec3 Yw = vec3(0.2126, 0.7152, 0.0722);
        float y0 = dot(lin, Yw);
        vec3 neutral = y0 > 1e-5 ? lin * (dot(sim, Yw) / y0) : sim;
        sim = max(neutral + (sim - neutral) * uChroma, 0.0);
      }
      scr = lin2srgb(sim);
    }
    vec2 q = pp - vec2(0.0, uHalf.y - uCut.x);
    q.x = max(abs(q.x) - uCut.y, 0.0);
    scr *= smoothstep(uCut.z, uCut.z + px, length(q));

    outColor = vec4(mix(vec3(0.004), scr, inside), 1.0);
  }`;

export function lutTexture(model: AngleModel) {
  const lut = model.buildLUT();
  const tex = new THREE.DataTexture(lut.data, lut.width, lut.height, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, width: lut.width, data: lut.data };
}

export function createScreenMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VS,
    fragmentShader: FS,
    toneMapped: false,
    uniforms: {
      uImg: { value: null },
      uLut: { value: null },
      uLutW: { value: 71 },
      uEye: { value: new THREE.Vector3(0, 0, 0.3) },
      uHalf: { value: new THREE.Vector2(0.0366, 0.0796) },
      uCorner: { value: 0.01 },
      uCut: { value: new THREE.Vector3(0.0044, 0, 0.0016) },
      uImgScale: { value: new THREE.Vector2(1, 1) },
      uMode: { value: 0 },
      uChroma: { value: 1 },
    },
  });
}
