/*
 * 独立开发入口（npm run dev）：数据、测试画面、人物模型从本项目的 public/ 与 legacy/ 读取。
 * 嵌进现有网页时用 src/embed.ts，从页面已加载的全局变量取。
 */
import './legacy/avatar.js';
import './legacy/patterns.js';
import './legacy/viz.js';
import { mount } from './app';
import { loadAngData } from './optics/model';

const q = new URLSearchParams(location.search);
const host = document.getElementById('stage')!;
const data = await loadAngData('./data/ang_data.js?v=20261008-mate90');
await window.Patterns.ready;
const app = await mount(host, {
  privacy: q.get('privacy') === '1',
  device: q.get('device') || undefined,
  // 本机的苹果官网模型（public/local/，不进仓库）；没有就用参数化模型
  appleIphone: q.get('apple') === '0' ? undefined : async (v) => {
    const r = await fetch(`./local/phone_${v}.glb`);
    return r.ok ? r.arrayBuffer() : null;
  },
  data,
  person: './models/ubc/Superhero_Male_FullBody.gltf',
  makePattern: (n, w, h) => window.Patterns.make(n, w, h),
  scene: q.get('scene') || undefined,
  view: q.get('view') === 'stereo' ? 'eye' : (q.get('view') as 'eye' | 'explain') || undefined,
  pattern: q.get('pattern') || undefined,
});
if (q.has('seek')) app.seekView(+q.get('seek')!);
if (q.has('privacy')) app.setPrivacy(q.get('privacy') === '1');
if (q.has('viewer')) app.setViewer(q.get('viewer') as 'you' | 'nb');
if (q.has('from')) app.seek(q.get('from')!, q.get('scene') || 'normal', +(q.get('p') || 0.5));
for (const [k, v] of q) if (k.startsWith('param.')) app.setParam(k.slice(6), +v);
if (q.get('data') === '1') app.setData(true);
// 双眼视差：?view=stereo，&st=毫秒 停在自动播放的某一刻，&stl=split|overlay|wiggle 直接切到某种显示
if (q.get('view') === 'stereo') {
  app.stereoStart();
  if (q.has('st')) app.stereoSeek(+q.get('st')!);
  if (q.has('stl')) app.stereoLayout(q.get('stl') as 'split' | 'overlay' | 'wiggle');
}
await app.ready;
(window as any).s3d = app;
(window as any).__ready = true;
