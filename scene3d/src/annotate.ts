/*
 * 讲解视角的标注：眼睛到屏幕顶 / 中 / 底的视线、屏幕法线与离轴角弧、观看距离，
 * 以及每个点的亮度和色偏读数。读数全部来自实测模型。
 * 标签在屏幕空间里排版：放在手机远离眼睛的一侧，不压住屏幕、彼此不重叠，用细引线连回测点。
 */
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { anglesOf, type AngleModel, type Eval } from './optics/model';

/** 第二位观看者的标识色（暖橙，与主强调色蓝区分） */
export const SECOND = '#ff9d4d';

export interface Probe { key: string; name: string; local: THREE.Vector3; world: THREE.Vector3; ev: Eval; theta: number }

class FatLine {
  geo = new LineGeometry();
  mat: LineMaterial;
  obj: Line2;
  constructor(scene: THREE.Scene, color: string, width: number, opacity: number, dashed = false) {
    this.mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, dashed, dashSize: 0.008, gapSize: 0.006, depthTest: true });
    this.obj = new Line2(this.geo, this.mat);
    this.obj.renderOrder = 30;
    this.obj.frustumCulled = false;
    scene.add(this.obj);
  }
  set(points: THREE.Vector3[]) {
    this.geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
    if (this.mat.dashed) this.obj.computeLineDistances();
  }
  set visible(v: boolean) { this.obj.visible = v; }
}

function arcPoints(center: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, n = 24) {
  const u = a.clone().normalize(), v = b.clone().normalize();
  const ang = u.angleTo(v);
  const axis = new THREE.Vector3().crossVectors(u, v);
  if (axis.lengthSq() < 1e-10) return [];
  axis.normalize();
  return Array.from({ length: n + 1 }, (_, i) => center.clone().addScaledVector(u.clone().applyAxisAngle(axis, (ang * i) / n), r));
}

export class Annotations {
  private lines: Record<string, FatLine> = {};
  private layer: HTMLDivElement;
  private svg: SVGSVGElement;
  private labels: Record<string, HTMLDivElement> = {};
  probes: Probe[] = [];
  visible = true;

  constructor(private scene: THREE.Scene, private accent: string, host: HTMLElement) {
    const L = (k: string, w: number, o: number, d = false, c = accent) => (this.lines[k] = new FatLine(scene, c, w, o, d));
    L('c', 2.2, 1); L('t', 1.3, 0.65, true); L('b', 1.3, 0.65, true);
    L('n', 1.2, 0.8, true, '#ffffff'); L('arcC', 1.6, 0.95); L('arcT', 1.2, 0.8); L('arcB', 1.2, 0.8);
    L('v2', 1.6, 0.85, true, SECOND);
    this.layer = document.createElement('div');
    this.layer.className = 'ann-layer';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('ann-leaders');
    this.layer.appendChild(this.svg);
    host.appendChild(this.layer);
    for (const k of ['dist', 't', 'c', 'b', 'v2']) {
      const el = document.createElement('div');
      el.className = 'ann ' + (k === 'dist' ? 'ann-dist' : k === 'v2' ? 'ann-v2' : 'ann-probe');
      this.layer.appendChild(el);
      this.labels[k] = el;
    }
  }

  setResolution(w: number, h: number) { for (const l of Object.values(this.lines)) l.mat.resolution.set(w, h); }

  /** 第二位观看者（地铁场景里没被选中的那个人）：只画到屏幕中心的视线和一个读数 */
  second: { eye: THREE.Vector3; name: string; ev: Eval; theta: number } | null = null;
  showSecondLabel = false;

  /** 计算三个测点（屏幕顶 / 中 / 底，取显示区中线）相对眼睛的离轴角与实测读数，并更新三维线。 */
  update(eye: THREE.Vector3, phone: THREE.Matrix4, half: THREE.Vector2, model: AngleModel, second?: { eye: THREE.Vector3; name: string } | null) {
    const inv = phone.clone().invert();
    const eyeL = eye.clone().applyMatrix4(inv);
    const mk = (key: string, name: string, y: number): Probe => {
      const local = new THREE.Vector3(0, y, 0.0003);
      const a = anglesOf(eyeL.clone().sub(local));
      return { key, name, local, world: local.clone().applyMatrix4(phone), ev: model.evalAt(a.theta, a.psi), theta: a.theta };
    };
    const inset = 0.006;
    this.probes = [mk('t', '顶部', half.y - inset), mk('c', '中心', 0), mk('b', '底部', -half.y + inset)];
    const [t, c, b] = this.probes;
    this.lines.c.set([eye, c.world]);
    this.lines.t.set([eye, t.world]);
    this.lines.b.set([eye, b.world]);
    const nrm = new THREE.Vector3(0, 0, 1).transformDirection(phone);
    this.lines.n.set([c.world, c.world.clone().addScaledVector(nrm, 0.07)]);
    const arc = (p: Probe, r: number) => (p.theta > 1 ? arcPoints(p.world, nrm, eye.clone().sub(p.world), r) : []);
    const setArc = (k: string, pts: THREE.Vector3[]) => { this.lines[k].visible = this.visible && pts.length > 1; if (pts.length > 1) this.lines[k].set(pts); };
    setArc('arcC', arc(c, 0.045));
    setArc('arcT', arc(t, 0.03));
    setArc('arcB', arc(b, 0.03));
    for (const k of ['c', 't', 'b', 'n']) this.lines[k].visible = this.visible;
    if (second) {
      const a = anglesOf(second.eye.clone().applyMatrix4(inv).sub(c.local));
      this.second = { eye: second.eye, name: second.name, ev: model.evalAt(a.theta, a.psi), theta: a.theta };
      this.lines.v2.set([second.eye, c.world]);
    } else this.second = null;
    this.lines.v2.visible = this.visible && !!second;
    return this.probes;
  }

  /** 标签排版（每帧，在渲染之后）。 */
  layout(camera: THREE.Camera, eye: THREE.Vector3, phone: THREE.Matrix4, half: THREE.Vector2, W: number, H: number) {
    this.layer.style.display = this.visible ? '' : 'none';
    if (!this.visible || !this.probes.length) return;
    const proj = (p: THREE.Vector3) => { const v = p.clone().project(camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, z: v.z }; };
    // 手机在屏幕上的外接框
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => proj(new THREE.Vector3(sx * (half.x + 0.003), sy * (half.y + 0.003), 0).applyMatrix4(phone)));
    const box = { x0: Math.min(...corners.map((c) => c.x)), x1: Math.max(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), y1: Math.max(...corners.map((c) => c.y)) };
    const eyeS = proj(eye);
    const side = eyeS.x < (box.x0 + box.x1) / 2 ? 1 : -1;   // 标签放在远离眼睛的一侧
    const compact = W < 640;   // 窄屏只留离轴角和亮度
    const fmt = (p: Probe) => compact
      ? `<span class="k">${p.name}</span><b>${p.theta.toFixed(0)}°</b><span class="sep"></span><b>${Math.round(p.ev.yRatio * 100)}%</b>`
      : `<span class="k">${p.name}</span><b>${p.theta.toFixed(0)}°</b>` +
      `<span class="sep"></span><span class="k">亮度</span><b>${Math.round(p.ev.yRatio * 100)}%</b>` +
      `<span class="sep"></span><span class="k">色偏</span><b>${p.ev.jncd.toFixed(1)}</b>` +
      (p.ev.clamped ? '<span class="warn">超出实测范围</span>' : '');
    // 顶部 / 底部与中心相差不到 3° 时只标一个“屏幕”，少一点字
    const [pt, pc, pb] = this.probes;
    const merged = Math.abs(pt.theta - pc.theta) < 3 && Math.abs(pb.theta - pc.theta) < 3;
    for (const k of ['t', 'b']) this.labels[k].style.display = merged ? 'none' : '';
    const shown = merged ? [{ ...pc, name: '屏幕' }] : this.probes;
    const items = shown.map((p) => {
      const el = this.labels[p.key];
      const html = fmt(p);
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
      const a = proj(p.world);
      return { el, a, w: el.offsetWidth, h: el.offsetHeight, y: a.y };
    });
    // 纵向排开，互不重叠，并保持在画面内
    items.sort((p, q) => p.y - q.y);
    const gap = 8;
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1], cur = items[i];
      const minY = prev.y + (prev.h + cur.h) / 2 + gap;
      if (cur.y < minY) cur.y = minY;
    }
    const over = items.length ? items[items.length - 1].y + items[items.length - 1].h / 2 - (H - 90) : 0;
    if (over > 0) items.forEach((it) => { it.y -= over; });
    let paths = '';
    for (const it of items) {
      const x = side > 0 ? box.x1 + 28 : box.x0 - 28 - it.w;
      const lx = Math.min(Math.max(x, 12), W - it.w - 12);
      it.el.style.transform = `translate(${lx}px, ${it.y - it.h / 2}px)`;
      const ex = side > 0 ? lx : lx + it.w;
      paths += `<path d="M${it.a.x},${it.a.y} L${(it.a.x + ex) / 2},${it.y} L${ex},${it.y}"/><circle cx="${it.a.x}" cy="${it.a.y}" r="2.5"/>`;
    }
    this.svg.innerHTML = paths;
    // 观看距离：标在中心视线的中点，向远离手机的方向偏一点
    const c = pc;
    const mid = proj(eye.clone().lerp(c.world, 0.5));
    const d = this.labels.dist;
    const dist = `<b>${(eye.distanceTo(c.world) * 100).toFixed(0)} cm</b><span class="k">观看距离</span>`;
    if (d.dataset.html !== dist) { d.innerHTML = dist; d.dataset.html = dist; }
    let dx = mid.x - d.offsetWidth / 2, dy = mid.y - d.offsetHeight - 10;
    const hit = (y: number) => items.some((it) => {
      const lx = side > 0 ? box.x1 + 28 : box.x0 - 28 - it.w;
      return dx < lx + it.w && dx + d.offsetWidth > lx && y < it.y + it.h / 2 && y + d.offsetHeight > it.y - it.h / 2;
    });
    if (hit(dy)) dy = mid.y + 10;
    if (hit(dy)) dx = Math.min(dx, (side > 0 ? box.x0 : box.x1) - d.offsetWidth - 16);
    dx = Math.min(Math.max(dx, 8), W - d.offsetWidth - 8);
    d.style.transform = `translate(${dx}px, ${dy}px)`;
    // 第二位观看者：标在他那条视线靠眼睛的一端
    const v2 = this.labels.v2;
    // 第二位观看者的读数显示在小窗下方，这里只留视线，避免和测点标签挤在一起
    v2.style.display = 'none';
    if (this.second && this.showSecondLabel) {
      const s2 = this.second;
      const html2 = `<span class="k">${s2.name}</span><b>${s2.theta.toFixed(0)}°</b><span class="sep"></span><span class="k">亮度</span><b>${Math.round(s2.ev.yRatio * 100)}%</b>` +
        (compact ? '' : `<span class="sep"></span><span class="k">色偏</span><b>${s2.ev.jncd.toFixed(1)}</b>`);
      if (v2.dataset.html !== html2) { v2.innerHTML = html2; v2.dataset.html = html2; }
      v2.style.display = '';
      const pe = proj(s2.eye.clone().lerp(c.world, 0.25));
      const x2 = Math.min(Math.max(pe.x - v2.offsetWidth / 2, 8), W - v2.offsetWidth - 8);
      v2.style.transform = `translate(${x2}px, ${pe.y - v2.offsetHeight - 12}px)`;
    }
  }

  setVisible(v: boolean) {
    this.visible = v;
    for (const [k, l] of Object.entries(this.lines)) l.visible = v && (k !== 'v2' || !!this.second);
    this.layer.style.display = v ? '' : 'none';
  }
}
