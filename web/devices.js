/*
 * 机型外观参数（单位 mm），键名为 data.js 中 device 的名称或其前缀
 * （如 “iPhone 18 Pro Max GH3” 等不同屏幕供应商版本共用 “iPhone 18 Pro Max” 的外观）。
 *   body   传给 Phone3D.build 的机身参数（缺省项取 phone3d.js 的 SPEC）
 *   screen 屏幕对角线按“标准矩形”口径（英寸）、分辨率、屏幕圆角
 *   cutout 前摄开孔: y 为中心距屏幕顶边，half 为胶囊直线段半长（0 即圆孔），r 为半径
 *   rough  中框粗糙度（GGX）: 0.2 抛光 … 0.5 左右 喷砂阳极氧化 … 0.8 很哑；背板磨砂玻璃同步变化
 *   colors 机身配色（线性 RGB），swatch 为界面色块
 */
(function (root) {
  'use strict';

  root.DEVICE_SPECS = {
    '小米 18 Pro Max': {
      // 官方参数 163.39 × 77.6 × 8.39 mm，6.9" 1208×2624
      body: {},
      screen: { diag: 6.9, resW: 1208, resH: 2624, corner: 10.05 },
      cutout: { y: 5.2, half: 0, r: 1.55 },
      rough: 0.55,
      colors: [
        { id: 'blue', name: '星河蓝', swatch: '#2a3aa8', frame: [0.07, 0.11, 0.55], back: [0.04, 0.05, 0.30] },
        { id: 'black', name: '黑色', swatch: '#2b2c30', frame: [0.10, 0.10, 0.11], back: [0.035, 0.035, 0.04] },
        { id: 'white', name: '白色', swatch: '#e6e6e8', frame: [0.78, 0.78, 0.80], back: [0.82, 0.82, 0.83] },
        { id: 'pink', name: '冰桃粉', swatch: '#e9b7b3', frame: [0.84, 0.56, 0.55], back: [0.88, 0.66, 0.64] },
      ],
    },

    'iPhone 18 Pro Max': {
      // 官方参数 163.4 × 78.0 × 8.75 mm，6.9"（标准矩形 6.86"）2868×1320 @460ppi；
      // 铝金属一体机身 + 通栏相机平台（含平台厚 11.54 mm，含镜头 13.77 mm），灵动岛宽约 14 mm。
      body: {
        W: 78.0, H: 163.4, T: 8.75, R: 12.8,
        glassInset: 1.0, backInset: 0.9, fillet: 0.6, sideBulge: 0,
        islandW: 76.2, islandH: 40, islandTop: 0.9, islandR: [11.9, 2.0], islandDepth: 2.79,
        islandMat: 'frame',
        lenses: [
          [26.5, 9, 8.25, 2.2], [26.5, -9, 8.25, 2.2], [11.5, 0, 8.25, 2.2],   // 三摄
          [-27, 10, 3.0, 0], [-27, -10, 3.2, 0], [-18, 0, 0.7, 0],             // 闪光灯 / LiDAR / 麦克风
        ],
        buttons: [[31, 7, -1], [44, 12, -1], [58, 12, -1], [48, 20, 1], [100, 17, 1]],
        buttonThick: 2.4, buttonOut: 0.5,
      },
      screen: { diag: 6.86, resW: 1320, resH: 2868, corner: 10.3 },
      cutout: { y: 4.9, half: 4.0, r: 3.05 },
      rough: 0.55,
      colors: [
        { id: 'burgundy', name: '酒红色', swatch: '#661c2c', frame: [0.12, 0.012, 0.024], back: [0.10, 0.010, 0.020] },
        { id: 'glacier', name: '冰川色', swatch: '#b9cddc', frame: [0.45, 0.58, 0.70], back: [0.50, 0.62, 0.73] },
        { id: 'silver', name: '银色', swatch: '#e3e4e5', frame: [0.72, 0.72, 0.72], back: [0.80, 0.80, 0.80] },
        { id: 'black', name: '黑色', swatch: '#2e2f33', frame: [0.035, 0.035, 0.04], back: [0.025, 0.025, 0.03] },
      ],
    },
  };
})(window);
