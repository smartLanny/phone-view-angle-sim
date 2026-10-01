// 原型的程序化测试画面（web/patterns.js），挂在 window.Patterns 上
export {};
declare global {
  interface Window {
    Patterns: { make(name: string, w: number, h: number): HTMLCanvasElement; ready: Promise<void> };
    AVATAR_SRC?: string;
  }
}

// 原型的数据图（web/viz.js），挂在 window.Viz 上
export interface VizPad {
  setField(key: string, sampler: (theta: number, psi: number) => number, o?: { pal?: string; levels?: number }): void;
  update(s: Record<string, unknown>): void;
  draw(): void;
}
export interface VizCharts { update(s: Record<string, unknown>): void; render(): void }
declare global {
  interface Window {
    Viz: {
      createPad(canvas: HTMLCanvasElement, opts: { maxTheta: number; onInput: (t: number, p: number, done: boolean) => void; onHover?: (h: { theta: number; psi: number } | null) => void }): VizPad;
      createCharts(el: HTMLElement, opts: { maxTheta: number; onPick: (t: number) => void }): VizCharts;
      PALETTES: Record<string, { label: string; banded: boolean }>;
      paletteCSS(name: string, levels: number, reverse: boolean): string;
      dirName(psi: number): string;
    };
  }
}
