/*
 * 编排：自动播放的时间线（工具栏上方的一条）。
 * 由若干“段”组成，每段是一个场景，后面跟着这一段里依次展示的视角 / 机型（例如 正常手持：讲解视角 → 人眼视角 → 双眼视差）。
 *   - 从下方工具栏把场景、视角、机型按钮拖上来插入（场景 = 新的一段，视角 / 机型 = 插到某一段里的某个位置）；
 *     “防窥”开关拖上来插入的是它当前的状态（先把开关拨到想要的状态再拖）
 *   - 时间线里的按钮左右拖动调整顺序（场景按钮带着整段一起移动），拖出时间线就删除
 *   - 点一下跳到那一步
 * 触屏先长按再拖。时间线存在本机浏览器里。
 */

export interface Segment { scene: string; items: string[] }
export interface Labels { scene(id: string): string; item(id: string, scene: string): string }

const KEY = 's3d-timeline';
export const DEFAULT_TIMELINE: Segment[] = [
  { scene: 'front', items: ['explain', 'eye:you'] },
  { scene: 'normal', items: ['explain', 'eye:you', 'stereo'] },
  { scene: 'desk', items: ['explain', 'eye:you'] },
  { scene: 'subway', items: ['explain', 'eye:nb', 'priv:on'] },
];

type Src = { kind: 'scene' | 'item'; value: string; text?: string; from?: { seg: number; idx: number } };   // idx −1 = 场景按钮（整段）

export function createTimeline(box: HTMLElement, opts: {
  labels: Labels;
  validScene(id: string): boolean;
  validItem(id: string): boolean;
  /** 工具栏里可以拖上来的按钮所在的容器，以及按钮代表什么；pick 用于不是按钮的控件（如防窥开关），返回拖出去的值和显示的文字 */
  sources: { el: HTMLElement; kind: 'scene' | 'item'; map?: (v: string) => string; pick?: () => { value: string; text: string } }[];
  open(): void;
  jump(seg: Segment, idx: number): void;
  onChange?(): void;
}) {
  const load = (): Segment[] => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (Array.isArray(v)) {
        const segs = v.filter((s) => s && opts.validScene(s.scene)).map((s) => ({ scene: s.scene, items: (s.items || []).filter((i: string) => opts.validItem(i)) }));
        if (segs.length) return segs;
      }
    } catch { /* 用默认 */ }
    return DEFAULT_TIMELINE.map((s) => ({ scene: s.scene, items: [...s.items] }));
  };
  let segs = load();
  let cur: { seg: number; idx: number } | null = null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(segs)); } catch { /* 隐私模式 */ } opts.onChange?.(); };

  box.innerHTML = `<div class="tl-strip" data-tl="strip"></div>
    <div class="tl-foot"><span>从下方拖入按钮插入 · 左右拖动排序 · 拖出删除 · 点一下跳到那一步</span><button class="s3d-link" data-tl="reset">恢复默认</button></div>
    <div class="tl-mark" data-tl="mark"></div>`;
  const strip = box.querySelector('[data-tl="strip"]') as HTMLElement;
  const mark = box.querySelector('[data-tl="mark"]') as HTMLElement;
  (box.querySelector('[data-tl="reset"]') as HTMLElement).addEventListener('click', () => { segs = DEFAULT_TIMELINE.map((s) => ({ scene: s.scene, items: [...s.items] })); save(); render(); });

  function render() {
    strip.innerHTML = segs.map((s, i) => `<div class="tl-seg" data-seg="${i}">
        <span class="tl-chip tl-scene${cur?.seg === i && cur.idx === -1 ? ' cur' : ''}" data-seg="${i}" data-idx="-1">${opts.labels.scene(s.scene)}</span>${s.items.map((it, j) =>
          `<span class="tl-chip${cur?.seg === i && cur.idx === j ? ' cur' : ''}${it.startsWith('dev:') || it.startsWith('priv:') ? ' tl-dev' : ''}" data-seg="${i}" data-idx="${j}">${opts.labels.item(it, s.scene)}</span>`).join('')}</div>`).join('')
      || '<div class="tl-empty">把场景按钮从下方拖到这里</div>';
  }
  render();

  // ---------- 拖动 ----------
  let st: null | {
    src: Src; el: HTMLElement; id: number; x0: number; y0: number; armed: boolean; moved: boolean; timer: number;
    ghost?: HTMLElement; drop?: { seg: number; idx: number } | 'remove' | null;
  } = null;
  let suppress = false;
  const swallow = (e: Event) => { if (suppress) { suppress = false; e.stopImmediatePropagation(); e.preventDefault(); } };

  const begin = (e: PointerEvent, el: HTMLElement, src: Src) => {
    if (e.button !== 0) return;
    st = { src, el, id: e.pointerId, x0: e.clientX, y0: e.clientY, armed: e.pointerType === 'mouse', moved: false, timer: 0 };
    if (!st.armed) st.timer = window.setTimeout(() => { if (st) { st.armed = true; el.classList.add('tl-lift'); } }, 320);
  };
  for (const s of opts.sources) {
    s.el.addEventListener('click', swallow, true);
    s.el.addEventListener('touchmove', (e) => { if (st?.armed) e.preventDefault(); }, { passive: false });
    s.el.addEventListener('pointerdown', (e) => {
      if (s.pick) { const p = s.pick(); begin(e, s.el, { kind: s.kind, value: p.value, text: p.text }); return; }
      const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
      if (!b?.dataset.v) return;
      begin(e, b, { kind: s.kind, value: s.map ? s.map(b.dataset.v) : b.dataset.v });
    });
  }
  strip.addEventListener('touchmove', (e) => { if (st?.armed) e.preventDefault(); }, { passive: false });
  strip.addEventListener('pointerdown', (e) => {
    const c = (e.target as HTMLElement).closest('.tl-chip') as HTMLElement | null;
    if (!c) return;
    const seg = +c.dataset.seg!, idx = +c.dataset.idx!;
    begin(e, c, idx < 0 ? { kind: 'scene', value: segs[seg].scene, from: { seg, idx } } : { kind: 'item', value: segs[seg].items[idx], from: { seg, idx } });
  });
  strip.addEventListener('click', (e) => {
    if (suppress) { suppress = false; return; }
    const c = (e.target as HTMLElement).closest('.tl-chip') as HTMLElement | null;
    if (c) opts.jump(segs[+c.dataset.seg!], +c.dataset.idx!);
  });

  /** 指针位置对应的插入位置：场景 → 段与段之间；视角 / 机型 → 某一段里的某个位置。离开时间线太远 → 删除 / 不插入 */
  const findDrop = (x: number, y: number, src: Src): { seg: number; idx: number } | 'remove' | null => {
    const r = box.getBoundingClientRect();
    const pad = 36;
    if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) return src.from ? 'remove' : null;
    const segEls = [...strip.querySelectorAll('.tl-seg')] as HTMLElement[];
    if (!segEls.length) return src.kind === 'scene' ? { seg: 0, idx: -1 } : null;
    const rowDist = (rc: DOMRect) => (y < rc.top ? rc.top - y : y > rc.bottom ? y - rc.bottom : 0);
    if (src.kind === 'scene') {
      let best = { d: Infinity, seg: 0 };
      segEls.forEach((el, i) => {
        const rc = el.getBoundingClientRect();
        for (const [px, at] of [[rc.left, i], [rc.right, i + 1]] as [number, number][]) {
          const d = Math.abs(x - px) + 3 * rowDist(rc);
          if (d < best.d) best = { d, seg: at };
        }
      });
      return { seg: best.seg, idx: -1 };
    }
    let best = { d: Infinity, seg: 0, idx: 0 };
    segEls.forEach((el, i) => {
      const chips = [...el.querySelectorAll('.tl-chip')] as HTMLElement[];   // 第 0 个是场景按钮
      for (let j = 0; j < chips.length; j++) {
        const rc = chips[j].getBoundingClientRect();
        const d = Math.abs(x - rc.right) + 3 * rowDist(rc);                  // 插到第 j 个按钮后面 = items 的第 j 位
        if (d < best.d) best = { d, seg: i, idx: j };
      }
    });
    return { seg: best.seg, idx: best.idx };
  };
  const showMark = (drop: { seg: number; idx: number } | 'remove' | null, src: Src) => {
    if (!drop || drop === 'remove') { mark.style.display = 'none'; return; }
    const br = box.getBoundingClientRect();
    const segEls = [...strip.querySelectorAll('.tl-seg')] as HTMLElement[];
    let x: number, rc: DOMRect;
    if (src.kind === 'scene') {
      const el = segEls[Math.min(drop.seg, segEls.length - 1)];
      rc = el ? el.getBoundingClientRect() : strip.getBoundingClientRect();
      x = drop.seg >= segEls.length ? rc.right + 3 : rc.left - 4;
    } else {
      const chips = [...segEls[drop.seg].querySelectorAll('.tl-chip')] as HTMLElement[];
      rc = chips[drop.idx].getBoundingClientRect();
      x = rc.right + 2;
    }
    Object.assign(mark.style, { display: 'block', left: (x - br.left) + 'px', top: (rc.top - br.top - 2) + 'px', height: (rc.height + 4) + 'px' });
  };

  window.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (!st.moved) {
      if (!st.armed) { if (Math.hypot(dx, dy) > 8) { clearTimeout(st.timer); st = null; } return; }
      if (Math.hypot(dx, dy) < 6) return;
      st.moved = true;
      opts.open();
      const g = document.createElement('div');
      g.className = 'tl-ghost';
      g.textContent = st.src.text || st.el.textContent;
      box.ownerDocument.body.appendChild(g);
      st.ghost = g;
      st.el.classList.add('tl-src');
      try { st.el.setPointerCapture(e.pointerId); } catch { /* 不支持就算了 */ }
    }
    st.ghost!.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    st.drop = findDrop(e.clientX, e.clientY, st.src);
    st.ghost!.classList.toggle('remove', st.drop === 'remove');
    showMark(st.drop, st.src);
  });
  const end = (e: PointerEvent, cancel = false) => {
    if (!st || e.pointerId !== st.id) return;
    clearTimeout(st.timer);
    const s = st; st = null;
    s.el.classList.remove('tl-lift', 'tl-src');
    s.ghost?.remove();
    mark.style.display = 'none';
    if (!s.moved) return;
    suppress = true; setTimeout(() => { suppress = false; }, 60);
    if (cancel || !s.drop) return;
    apply(s.src, s.drop);
  };
  window.addEventListener('pointerup', (e) => end(e));
  window.addEventListener('pointercancel', (e) => end(e, true));

  function apply(src: Src, drop: { seg: number; idx: number } | 'remove') {
    const f = src.from;
    if (drop === 'remove') {
      if (!f) return;
      if (f.idx < 0) segs.splice(f.seg, 1); else segs[f.seg].items.splice(f.idx, 1);
    } else if (src.kind === 'scene') {
      let at = drop.seg;
      if (f) {                                     // 整段移动
        const [moved] = segs.splice(f.seg, 1);
        if (f.seg < at) at--;
        segs.splice(at, 0, moved);
      } else segs.splice(at, 0, { scene: src.value, items: [] });
    } else {
      let { seg, idx } = drop;
      if (f) {
        segs[f.seg].items.splice(f.idx, 1);
        if (f.seg === seg && f.idx < idx) idx--;
      }
      segs[seg].items.splice(idx, 0, src.value);
    }
    cur = null;
    save(); render();
  }

  return {
    get segments() { return segs; },
    set(s: Segment[]) { segs = s.map((x) => ({ scene: x.scene, items: [...x.items] })); save(); render(); },
    highlight(c: { seg: number; idx: number } | null) { cur = c; render(); },
    render,
  };
}
