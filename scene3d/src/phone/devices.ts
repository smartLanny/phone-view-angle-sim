/*
 * 机型外观参数（单位 mm）。官方参数之外的尺寸为估计值，来源见各项注释与 README。
 */
import { MAT, type BodySpec } from './geometry';

export interface ColorWay { id: string; name: string; swatch: string; frame: string; back: string; backRough: number; sparkle?: boolean }

export interface DeviceSpec {
  id: string;
  name: string;
  /** data.js 里对应的机型名前缀 */
  dataDevice: string;
  body: BodySpec;
  screen: { diag: number; resW: number; resH: number; corner: number; cutout: { y: number; half: number; r: number } };
  colors: ColorWay[];
  rearDisplay: boolean;
}

export const XIAOMI_18_PRO_MAX: DeviceSpec = {
  id: 'xiaomi18pm',
  name: '小米 18 Pro Max',
  dataDevice: '小米 18 Pro Max',
  body: {
    // 官方：163.39 × 77.6 × 8.39 mm（黑 / 白 / 粉玻纤后盖；星河蓝玻璃后盖 8.47 mm）
    W: 77.6, H: 163.39, T: 8.39,
    R: 12.2,                    // 估计：按官方正面图量取
    glassInset: 1.16,           // 估计：屏幕显示区宽 73.3 mm（由 6.9″ 与 2624×1208 算出），黑边 0.99 mm
    backInset: 1.3,
    fillet: 1.25,               // “大微弧四曲中框”
    sideBulge: 0.12,
    // 相机模组即背屏：2.9″ 976×596（官方）→ 显示区约 62.9 × 38.4 mm，加 1.22 mm 边；位置按官方背面图量取（估计）
    island: { w: 65.4, h: 40.9, top: 5.6, r: 8.0, depth: 2.6, mat: 'glass', rim: 0.7 },
    // 两颗大镜头竖排在模组靠机身右侧（从正面看；从背面看在左侧），按官方图量取（估计）
    lenses: [[21.8, 9.3, 8.0, 0.35], [21.8, -9.4, 8.0, 0.35]],
    flats: [
      { x: 21.8, y: 25.6, w: 13.4, h: 6.2, r: 3.1, mat: MAT.DARK },     // 模组下方的黑色胶囊窗口
      { x: 10.4, y: 25.6, w: 5.0, h: 5.0, r: 2.5, mat: MAT.FLASH },     // 闪光灯
    ],
    // 右侧：音量键、电源键；左侧一个按键（按官方正面 / 侧面图量取，估计）
    buttons: [[41, 20.3, 1], [68.2, 10.7, 1], [59.6, 10.6, -1]],
    buttonThick: 2.6, buttonOut: 0.55,
  },
  screen: { diag: 6.9, resW: 1208, resH: 2624, corner: 10.05, cutout: { y: 4.4, half: 0, r: 1.6 } },
  colors: [
    { id: 'blue', name: '星河蓝', swatch: '#2a3aa8', frame: '#2b3fb8', back: '#1d2a8a', backRough: 0.18, sparkle: true },
    { id: 'black', name: '黑色', swatch: '#2b2c30', frame: '#2a2b2f', back: '#26272b', backRough: 0.55 },
    { id: 'white', name: '白色', swatch: '#e6e6e8', frame: '#d9d9db', back: '#ececee', backRough: 0.55 },
    { id: 'pink', name: '冰桃粉', swatch: '#e9b7b3', frame: '#e3b2ae', back: '#efc6c2', backRough: 0.55 },
  ],
  rearDisplay: true,
};

export const DEVICES = [XIAOMI_18_PRO_MAX];
