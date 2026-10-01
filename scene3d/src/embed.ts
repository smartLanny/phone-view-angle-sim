/*
 * 嵌入现有网页（web/index.html）的入口，打包成普通脚本 web/scene3d.js。
 * 数据、测试画面、人物模型都从页面已加载的全局变量取（data.js、patterns.js、scene3d-person.js），
 * 所以 GitHub Pages 和直接双击 index.html（file://）都能用。
 */
import { mount, type MountOptions } from './app';

declare global {
  interface Window {
    ANG_DATA: MountOptions['data'];
    SCENE3D_PERSON: object;
    SCENE3D_IPHONE?: Record<string, string>;
    Scene3D: { mount: (host: HTMLElement, extra?: Partial<MountOptions>) => ReturnType<typeof mount> };
  }
}

/**
 * 苹果官网 AR 模型（本机）：web/local/iphone18pm-<颜色>.js，内容是 GLB 的 base64。
 * 这个目录不进公开仓库，线上找不到文件时返回 null，改用参数化模型。
 */
function loadAppleIphone(variant: string): Promise<ArrayBuffer | null> {
  const decode = (b64: string) => {
    const bin = atob(b64.slice(b64.indexOf(',') + 1));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  };
  const have = () => window.SCENE3D_IPHONE?.[variant];
  if (have()) return Promise.resolve(decode(have()!));
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `local/iphone18pm-${variant}.js`;
    s.onload = () => resolve(have() ? decode(have()!) : null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

window.Scene3D = {
  mount: (host, extra = {}) => mount(host, {
    data: window.ANG_DATA,
    person: window.SCENE3D_PERSON,
    makePattern: (n, w, h) => window.Patterns.make(n, w, h),
    appleIphone: loadAppleIphone,
    ...extra,
  }),
};
