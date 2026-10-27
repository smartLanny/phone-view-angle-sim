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
      // 官方参数 163.4 × 78.0 × 8.75 mm，6.9"（标准矩形 6.86"）2868×1320 @460ppi。
      // 机身用苹果官网 iPhone 18 Pro 的 AR 模型（© Apple，见 scene3d/CREDITS.md），长宽按官方尺寸放大成 Pro Max、厚度不变，
      // 转换见 scene3d/tools/convert-iphone18-usdz.py。四种颜色对应原模型的四个颜色变体（KHR_materials_variants）。
      model: 'iphone18pm',
      body: { W: 78.0, H: 163.4, T: 8.75, R: 12.8, glassInset: 1.0 },
      // 显示区按官方对角线与分辨率；等效圆角 10.3 mm 与原模型显示区一致（原模型为连续曲率圆角）
      screen: { diag: 6.86, resW: 1320, resH: 2868, corner: 10.3 },
      // 灵动岛按原模型量取、不放大（前摄模组 Pro 与 Pro Max 相同）：15.67 × 6.07 mm，中心距显示区顶边 5.35 mm
      cutout: { y: 5.352, half: 4.799, r: 3.035 },
      rough: 0.55,
      // swatch 与 3D 场景页一致；frame / back 取原模型中框底色（线性），机身按模型材质着色时不用
      colors: [
        { id: 'burgundy', name: '酒红色', variant: 'Burgundy', swatch: '#6b3d45', frame: [0.089, 0.041, 0.048], back: [0.089, 0.041, 0.048] },
        { id: 'glacier', name: '冰川色', variant: 'Glacier', swatch: '#a7bad6', frame: [0.561, 0.667, 0.955], back: [0.561, 0.667, 0.955] },
        { id: 'silver', name: '银色', variant: 'Silver', swatch: '#dcdcda', frame: [0.855, 0.858, 0.839], back: [0.855, 0.858, 0.839] },
        { id: 'black', name: '黑色', variant: 'Black', swatch: '#3a3a3b', frame: [0.027, 0.026, 0.026], back: [0.027, 0.026, 0.026] },
      ],
    },

    '华为 Mate 90 Pro Max 典藏版': {
      // 按用户提供的正反面参考图估算比例，仅用于外观示意，不代表官方尺寸。
      body: {
        W: 78.5, H: 163.0, T: 8.5, R: 12.5,
        glassInset: 0.95, backInset: 0.8, fillet: 0.8, sideBulge: 0.08,
        islandW: 52, islandH: 52, islandTop: 8.5, islandR: 26,
        islandDepth: 2.1, islandMat: 'glass',
        backTextureCrop: [0.107, 0.005, 0.893, 0.995],
        lenses: [],
        buttons: [[39, 18, 1], [64, 12, 1]],
        buttonThick: 2.4, buttonOut: 0.45,
      },
      screen: {
        diag: 6.9, resW: 1200, resH: 2600, corner: 10.2,
        holes: [[-7.5, 4.6, 2.05], [0, 4.6, 2.15], [7.5, 4.6, 2.05]],
      },
      cutout: { y: 0, half: 0, r: 0 },
      backTexture: 'assets/huawei-mate90-pro-max-collector-back.png',
      rough: 0.52,
      colors: [
        { id: 'collector-green', name: '典藏绿', swatch: '#b6cc80', frame: [0.09, 0.15, 0.045], back: [0.42, 0.55, 0.24] },
      ],
    },
    'iPhone 17 Pro Max': {
      model: 'iphone17pm',
      body: { W: 78.0, H: 163.4, T: 8.75, R: 12.8, glassInset: 1.0 },
      screen: { diag: 6.86, resW: 1320, resH: 2868, corner: 10.3, half: [36.34915948, 79.07397270] },
      cutout: { y: 5.27134895, half: 7.34708011, r: 3.03609848 },
      rough: 0.55,
      colors: [
        { id: 'orange', name: '宇宙橙', swatch: '#ed8b5b', frame: [0.933107, 0.192871, 0.064319], back: [0.748414, 0.163458, 0.0460524] },
      ],
    },
    'iPhone Duo': {
      foldable: true, model: 'iphoneduo',
      body: { W:164.6,H:117.8,T:5.2,R:7,glassInset:1.5 },
      screen: {diag:7.58,resW:2670,resH:1878,corner:6.0,half:[78.765,55.40]},
      screens: {
        inner:{diag:7.58,resW:2670,resH:1878,corner:6.0,half:[78.765,55.40],cutout:{y:0,half:0,r:0},holes:[]},
        outer:{diag:5.36,resW:1398,resH:2034,corner:5.6,half:[38.585,56.14],cutout:{y:0,half:0,r:0},holes:[[30.879,7.688,3.045]]},
      },
      cutout: {y:0,half:0,r:0},rough:.5,
      // 两种颜色对应原模型的两个颜色变体（KHR_materials_variants）
      colors:[{id:'white',name:'星白色',variant:'Star White',swatch:'#e1dfd8',frame:[.7,.69,.66],back:[.85,.84,.81]},
        {id:'night',name:'夜空色',variant:'Night Sky',swatch:'#24303f',frame:[.05,.07,.1],back:[.012,.036,.06]}],
    },
  };
})(window);
