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

export const IPHONE_18_PRO_MAX: DeviceSpec = {
  id: 'iphone18pm',
  name: 'iPhone 18 Pro Max',
  dataDevice: 'iPhone 18 Pro Max',
  body: {
    // 官方：163.4 × 78.0 × 8.75 mm；含相机平台 11.54 mm、含镜头 13.77 mm（沿用原网页 devices.js 的数值）
    W: 78.0, H: 163.4, T: 8.75,
    R: 12.8,                    // 估计
    glassInset: 1.0, backInset: 0.9, fillet: 0.6, sideBulge: 0,
    // 铝合金一体机身，顶部通栏相机平台（与机身同材质），平台凸起 2.79 mm
    island: { w: 76.2, h: 40, top: 0.9, r: [11.9, 2.0], depth: 2.79, mat: 'frame', rim: 0 },
    backMat: 'frame',
    // 三摄呈三角形排布在平台一侧（从背面看在左侧），镜头再凸起约 2.2 mm（估计位置）
    lenses: [[26.5, 9, 8.25, 2.2], [26.5, -9, 8.25, 2.2], [11.5, 0, 8.25, 2.2]],
    flats: [
      { x: -27, y: 10, w: 6.0, h: 6.0, r: 3.0, mat: MAT.FLASH, island: true },    // 闪光灯
      { x: -27, y: -10, w: 6.4, h: 6.4, r: 3.2, mat: MAT.DARK, island: true },    // LiDAR
      { x: -18, y: 0, w: 1.4, h: 1.4, r: 0.7, mat: MAT.DARK, island: true },      // 麦克风
      // 平台下方的玻璃窗（无线充电区），颜色与机身相同（估计尺寸）
      { x: 0, y: -21.5, w: 70.5, h: 104, r: 9, mat: MAT.BACK },
    ],
    // 左侧：操作按钮、音量 +/−；右侧：电源键、相机控制（估计位置）
    buttons: [[31, 7, -1], [44, 12, -1], [58, 12, -1], [48, 20, 1], [100, 17, 1]],
    buttonThick: 2.4, buttonOut: 0.5,
  },
  // 6.9″（标准矩形 6.86″），2868 × 1320 @460ppi；灵动岛宽约 14 mm
  screen: { diag: 6.86, resW: 1320, resH: 2868, corner: 10.3, cutout: { y: 4.9, half: 4.0, r: 3.05 } },
  colors: [
    { id: 'burgundy', name: '酒红色', swatch: '#661c2c', frame: '#5a1a28', back: '#62202e', backRough: 0.5 },
    { id: 'glacier', name: '冰川色', swatch: '#b9cddc', frame: '#a9bfd0', back: '#b6cada', backRough: 0.5 },
    { id: 'silver', name: '银色', swatch: '#e3e4e5', frame: '#d6d7d9', back: '#e6e6e7', backRough: 0.5 },
    { id: 'black', name: '黑色', swatch: '#2e2f33', frame: '#2a2b2f', back: '#2c2d31', backRough: 0.5 },
  ],
  rearDisplay: false,
};

export const DEVICES = [XIAOMI_18_PRO_MAX, IPHONE_18_PRO_MAX];
