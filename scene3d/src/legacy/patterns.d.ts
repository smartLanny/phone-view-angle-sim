// 原型的程序化测试画面（web/patterns.js），挂在 window.Patterns 上
export {};
declare global {
  interface Window {
    Patterns: { make(name: string, w: number, h: number): HTMLCanvasElement; ready: Promise<void> };
    AVATAR_SRC?: string;
  }
}
