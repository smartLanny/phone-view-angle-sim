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
    Scene3D: { mount: (host: HTMLElement, extra?: Partial<MountOptions>) => ReturnType<typeof mount> };
  }
}

window.Scene3D = {
  mount: (host, extra = {}) => mount(host, {
    data: window.ANG_DATA,
    person: window.SCENE3D_PERSON,
    makePattern: (n, w, h) => window.Patterns.make(n, w, h),
    ...extra,
  }),
};
