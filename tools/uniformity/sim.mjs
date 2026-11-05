#!/usr/bin/env node
/**
 * 给 build.py 用：在 Node 的 vm 里加载本页的 web/devices.js、data.js、model.js，输出 JSON。
 *
 *   node tools/uniformity/sim.mjs geometry            每台机型的屏幕半宽 / 半高（mm，与 app.js 的 dev() 算法一致）
 *   node tools/uniformity/sim.mjs angles <profile>    该 profile 在小角度内的白场亮度比与 XYZ（扣除测量相机视角时用）
 *
 * 光学数字全部来自 model.js 的 evalAt，这里不另写公式。
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['devices.js', 'data.js', 'model.js']) vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), ctx, { filename: f });
const SPECS = ctx.DEVICE_SPECS, DATA = ctx.ANG_DATA;
const KNOWN = Object.keys(SPECS);
const specKey = (device) => KNOWN.filter((k) => device === k || device.startsWith(k + ' ')).sort((a, b) => b.length - a.length)[0];

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'geometry') {
  const out = {};
  for (const device of [...new Set(DATA.profiles.map((p) => p.device))]) {
    const sc = SPECS[specKey(device)].screen, ratio = sc.resH / sc.resW;
    const w = (sc.diag * 25.4) / Math.sqrt(1 + ratio * ratio);
    out[device] = {
      half: sc.half || [w / 2, (w * ratio) / 2],
      profiles: DATA.profiles.filter((p) => p.device === device).map((p) => ({ id: p.id, privacy: p.privacy, privacyKind: p.privacyKind || null })),
    };
  }
  process.stdout.write(JSON.stringify(out));
} else if (cmd === 'angles') {
  const p = DATA.profiles.find((x) => x.id === arg);
  if (!p) throw new Error(`没有 profile ${arg}`);
  const m = ctx.AngleModel.createModel({ angles: DATA.angles, sets: p.sets }, { fill: 'vmirror' });
  const theta = [], y = [], W = [];
  for (let t = 0; t <= 30; t += 0.25) theta.push(t);
  for (const t of theta) {
    const ry = [], rw = [];
    for (let psi = 0; psi < 360; psi += 1) { const e = m.evalAt(t, psi); ry.push(+e.yRatio.toFixed(6)); rw.push(e.W.map((v) => +v.toFixed(6))); }
    y.push(ry); W.push(rw);
  }
  process.stdout.write(JSON.stringify({ profile: p.id, device: p.device, theta, psiStep: 1, yRatio: y, W, refW: m.ref.W }));
} else {
  throw new Error('用法：sim.mjs geometry | sim.mjs angles <profile>');
}
