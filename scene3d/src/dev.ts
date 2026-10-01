/*
 * 独立开发入口（npm run dev）：数据、测试画面、人物模型从本项目的 public/ 与 legacy/ 读取。
 * 嵌进现有网页时用 src/embed.ts，从页面已加载的全局变量取。
 */
import './legacy/avatar.js';
import './legacy/patterns.js';
import { mount } from './app';
import { loadAngData } from './optics/model';

const q = new URLSearchParams(location.search);
const host = document.getElementById('stage')!;
const data = await loadAngData('./data/ang_data.js');
await window.Patterns.ready;
const app = await mount(host, {
  privacy: q.get('privacy') === '1',
  data,
  person: './models/ubc/Superhero_Male_FullBody.gltf',
  makePattern: (n, w, h) => window.Patterns.make(n, w, h),
  scene: q.get('scene') || undefined,
  view: (q.get('view') as 'eye' | 'explain') || undefined,
  pattern: q.get('pattern') || undefined,
});
if (q.has('seek')) app.seekView(+q.get('seek')!);
if (q.has('privacy')) app.setPrivacy(q.get('privacy') === '1');
if (q.has('viewer')) app.setViewer(q.get('viewer') as 'you' | 'nb');
if (q.has('from')) app.seek(q.get('from')!, q.get('scene') || 'normal', +(q.get('p') || 0.5));
for (const [k, v] of q) if (k.startsWith('param.')) app.setParam(k.slice(6), +v);
await app.ready;
(window as any).s3d = app;
(window as any).__ready = true;
