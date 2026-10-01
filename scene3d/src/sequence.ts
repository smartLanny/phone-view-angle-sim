/*
 * 自动播放与导出视频。
 * 播放顺序就是工具栏上的顺序：按场景按钮的先后，每个场景里再按视角按钮的先后各展示一遍（按钮可以左右拖动排序，见 sortable）。
 * 每一步先等上一步的动画走完，再停留设定的秒数。
 *
 * 导出视频用浏览器的“共享标签页”录屏（getDisplayMedia + MediaRecorder），录下的就是页面上看到的样子
 * （三维画面、标注、读数都在）；录制时自动隐藏工具栏等操作界面和鼠标。
 */

export interface Step { scene: string; view: string }

export interface PlayApi {
  /** 执行一步（只发起动作，动画由 settled 判断是否结束） */
  apply(step: Step): void;
  /** 所有动画是否都已结束 */
  settled(): boolean;
  /** 每一步停留的秒数 */
  hold(): number;
  /** 录制时隐藏操作界面 */
  setRecording(on: boolean): void;
  /** 播放 / 录制状态变了（更新按钮） */
  onState(playing: boolean, recording: boolean): void;
  toast(msg: string): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createPlayer(api: PlayApi) {
  let playing = false, abort = false;
  let rec: MediaRecorder | null = null;

  async function waitSettled() {
    await sleep(120);
    const t0 = performance.now();
    while (!abort && !api.settled() && performance.now() - t0 < 20000) await sleep(50);
  }
  async function play(steps: Step[]): Promise<boolean> {
    if (playing || !steps.length) return false;
    playing = true; abort = false; api.onState(true, !!rec);
    try {
      for (const st of steps) {
        if (abort) break;
        api.apply(st);
        await waitSettled();
        const t0 = performance.now();
        while (!abort && performance.now() - t0 < api.hold() * 1000) await sleep(50);
      }
      return !abort;
    } finally {
      playing = false; api.onState(false, !!rec);
    }
  }
  function stop() {
    abort = true;
    if (rec && rec.state === 'recording') rec.stop();
  }

  async function exportVideo(steps: Step[]) {
    if (playing) return;
    const md = navigator.mediaDevices as MediaDevices | undefined;
    if (!md?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      api.toast('这个浏览器不支持录屏导出，请用电脑上的 Chrome / Edge / Safari');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await md.getDisplayMedia({
        video: { frameRate: { ideal: 60 } },
        audio: false,
        preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions);
    } catch (err) {
      const e = err as DOMException;
      api.toast(e?.name === 'NotAllowedError' ? '已取消导出（没有允许录制这个标签页）' : `无法开始录制：${e?.message || e}`);
      return;
    }
    const mime = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 20_000_000 });
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>((res) => { r.onstop = () => res(); });
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stop());   // 在浏览器里点了“停止共享”
    rec = r;
    api.setRecording(true);
    api.onState(false, true);
    try {
      await sleep(700);                     // 等浏览器的共享提示收起、界面隐藏生效
      r.start(1000);
      await play(steps);
      await sleep(500);
    } finally {
      if (r.state === 'recording') r.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      rec = null;
      api.setRecording(false);
      api.onState(false, false);
    }
    if (!chunks.length) { api.toast('没有录到画面'); return; }
    const type = r.mimeType || mime || 'video/webm';
    const blob = new Blob(chunks, { type });
    const a = document.createElement('a');
    const d = new Date(), p2 = (n: number) => String(n).padStart(2, '0');
    a.download = `可视角演示-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    api.toast(`已导出视频 ${(blob.size / 1048576).toFixed(1)} MB（${type.includes('mp4') ? 'MP4' : 'WebM'}）`);
  }

  return {
    play, stop, exportVideo,
    get playing() { return playing; },
    get recording() { return !!rec; },
  };
}

/**
 * 让一组按钮可以左右拖动排序：鼠标按下后横向移动超过几个像素就开始拖；触屏要先长按再拖（不影响横向滑动工具栏）。
 * 没拖动就是普通点击。scale 为按钮所在工具栏的缩放（大屏幕放大时屏幕位移要除回去）。
 */
export function sortable(seg: HTMLElement, onReorder: (ids: string[]) => void, scale: () => number) {
  let st: null | {
    b: HTMLButtonElement; id: number; x0: number; y0: number; armed: boolean; moved: boolean; timer: number;
    items: HTMLButtonElement[]; mids: number[]; from: number; to: number; step: number;
  } = null;
  let suppress = false;
  seg.addEventListener('click', (e) => { if (suppress) { suppress = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  seg.addEventListener('touchmove', (e) => { if (st?.armed) e.preventDefault(); }, { passive: false });
  seg.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || e.button !== 0 || b.disabled) return;
    const items = [...seg.querySelectorAll('button')] as HTMLButtonElement[];
    st = { b, id: e.pointerId, x0: e.clientX, y0: e.clientY, armed: e.pointerType === 'mouse', moved: false, timer: 0, items, mids: [], from: items.indexOf(b), to: items.indexOf(b), step: 0 };
    if (!st.armed) st.timer = window.setTimeout(() => { if (st) { st.armed = true; b.classList.add('lift'); } }, 320);
  });
  const end = (e: PointerEvent, cancel = false) => {
    if (!st || e.pointerId !== st.id) return;
    clearTimeout(st.timer);
    const s = st; st = null;
    s.b.classList.remove('lift', 'drag');
    seg.classList.remove('sorting');
    s.items.forEach((it) => { it.style.transform = ''; });
    if (!s.moved) return;
    suppress = true; setTimeout(() => { suppress = false; }, 50);
    if (cancel || s.to === s.from) return;
    const ids = s.items.map((it) => it.dataset.v!);
    const [m] = ids.splice(s.from, 1);
    ids.splice(s.to, 0, m);
    onReorder(ids);
  };
  window.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x0;
    if (!st.moved) {
      if (!st.armed) {                     // 触屏还没长按就动了：当作滑动工具栏，放弃
        if (Math.abs(dx) > 8 || Math.abs(e.clientY - st.y0) > 8) { clearTimeout(st.timer); st = null; }
        return;
      }
      if (Math.abs(dx) < 6) return;
      st.moved = true;
      try { st.b.setPointerCapture(e.pointerId); } catch { /* 有的浏览器不支持就算了 */ }
      st.b.classList.add('drag');
      seg.classList.add('sorting');
      st.mids = st.items.map((it) => { const r = it.getBoundingClientRect(); return r.left + r.width / 2; });
      const r = st.b.getBoundingClientRect(), gap = st.items.length > 1 ? Math.abs(st.mids[1] - st.mids[0]) - (st.items[0].getBoundingClientRect().width + st.items[1].getBoundingClientRect().width) / 2 : 0;
      st.step = r.width + Math.max(0, gap);
    }
    const k = scale();
    st.b.style.transform = `translateX(${dx / k}px)`;
    const x = st.mids[st.from] + dx;
    let to = st.from;
    while (to < st.items.length - 1 && x > st.mids[to + 1]) to++;
    while (to > 0 && x < st.mids[to - 1]) to--;
    st.to = to;
    st.items.forEach((it, i) => {
      if (it === st!.b) return;
      const shift = st!.from < to && i > st!.from && i <= to ? -1 : st!.from > to && i < st!.from && i >= to ? 1 : 0;
      it.style.transform = shift ? `translateX(${(shift * st!.step) / k}px)` : '';
    });
  });
  window.addEventListener('pointerup', (e) => end(e));
  window.addEventListener('pointercancel', (e) => end(e, true));
}
