/*
 * 自动播放与导出视频。
 * 播放的步骤来自“编排”时间线（timeline.ts）：每段先换场景（和这一段的第一个视角 / 机型同时开始），再依次换这一段里的视角 / 机型。
 * 每一步先等上一步的动画走完，再停留设定的秒数。
 *
 * 导出视频用浏览器的“共享标签页”录屏（getDisplayMedia + MediaRecorder），录下的就是页面上看到的样子
 * （三维画面、标注、读数都在）；录制时自动隐藏工具栏等操作界面和鼠标。
 */

/** scene：换到这个场景；item：视角（explain / eye:you / eye:nb / stereo）或机型（dev:<id>）；seg / idx 用来在时间线上标出当前步 */
export interface Step { scene?: string; item?: string; seg: number; idx: number }

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
  /** 正在播放哪一步（null = 播完 / 停止） */
  onStep?(step: Step | null): void;
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
        api.onStep?.(st);
        api.apply(st);
        await waitSettled();
        const t0 = performance.now();
        while (!abort && performance.now() - t0 < api.hold() * 1000) await sleep(50);
      }
      return !abort;
    } finally {
      playing = false; api.onState(false, !!rec); api.onStep?.(null);
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
