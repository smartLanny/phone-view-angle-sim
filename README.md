# 手机屏幕可视角度仿真

根据实测的屏幕离轴光谱数据，在浏览器里用 WebGL 仿真手机屏幕从不同角度看过去的亮度衰减与色偏，并可对比防窥模式 / 防窥膜的效果。

**在线访问：<https://smartlanny.github.io/phone-view-angle-sim/>**

![界面截图](docs/screenshot.jpg)

## 功能

- **真实效果**：拖动旋转手机，按每个像素相对眼睛的实际离轴角逐像素计算亮度与色偏（近距离观看时屏幕上下两端角度不同，也会体现出来）
- **读数**：偏转角度、中心亮度、色偏 JNCD、ΔE2000（含亮度）
- **双机对比**：左右并排对比两台机器 / 防窥开关前后
- **双眼立体**：按瞳距分别渲染左右眼所见画面，可平行视或交叉视观看双眼看到的差异
- **画面**：浅色 / 深色界面、纯白、色卡、灰阶，也可上传或直接拖入、粘贴自己的图片
- **显示模式**：真实效果 / 原图 / 角度分布热力图，竖屏 / 横屏，多种机身配色

## 内置测试数据

| 机型 | 状态 |
|---|---|
| 小米 18 Pro Max | 普通 / 开启防窥模式 |
| iPhone 18 Pro Max（GH3 屏） | 普通 / 贴防窥膜 |

每种状态测量 4 个方向：手机竖着转（0°）、面内顺时针转 30°、60°、横着转（90°），每个方向离轴角 −70° ~ 70°、步长 2°，记录白 / 红 / 绿 / 蓝 / 黑五个画面的 CIE XYZ（cd/m²）。其它方向由这 8 条半径线插值得到。

数据已经打包进 `web/data.js`，网页打开即用，无需后端。原始测量文件（`.ang2`）也一并放在仓库里。

## 本地运行

纯静态网页，任意静态服务器即可：

```bash
python3 -m http.server 8765 --directory web
```

然后打开 <http://localhost:8765>。

## 更新数据

把新的 `.ang2` 测量文件放进仓库目录（可以放在以机型名开头的子文件夹里，多出的部分会作为屏幕供应商后缀，如 `iphone18 Pro Max GH3/`），然后重新生成 `web/data.js`：

```bash
python3 tools/convert_ang2.py
```

机型外观参数（尺寸、圆角、开孔、配色）在 `web/devices.js` 中配置。

## 目录结构

```
web/                网页本体（GitHub Pages 发布这个目录）
  index.html
  app.js            界面与交互
  model.js          可视角光学模型（插值、色偏、JNCD、ΔE2000）
  phone3d.js        手机机身几何与渲染
  devices.js        机型外观参数
  patterns.js       程序化测试画面
  data.js           内置测量数据（由 tools/convert_ang2.py 生成）
tools/
  convert_ang2.py   .ang2 → web/data.js
  embed_avatar.py   头像内嵌为 web/avatar.js
docs/               文献调研笔记
*.ang2              原始测量数据
```

## 许可

[MIT](LICENSE)
