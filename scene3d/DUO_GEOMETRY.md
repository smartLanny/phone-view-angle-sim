# Duo 几何接入

主网页和三维场景共用 `web/duo-geometry.js`。屏幕测量来自独立 `DUO_DATA.inner / outer`；初始均为 null，SCI / SCE、波长轴、测量几何、仪器、单位和 angularScatter 也分别留空。没有向 `ANG_DATA` 添加虚构测量。

几何中 0° 表示闭合、180° 表示展开。只提供折叠角，不提供折痕宽度调节。内屏是一张连续 UV 网格；两叶不是两台独立机型。

## 固定闭合截面

原始文件为 [Duo USDZ](https://www.apple.com/105/media/us/iphone-duo/2026/9305e4b9-72d9-4c05-9381-b572adadd5e5/ar/iPhone_Duo_e-sim_Star-White_Variant.usdz)，产品页和规格入口为 [产品](https://www.apple.com/iphone-duo/)及[技术规格](https://www.apple.com/iphone-duo/specs/)。原资产有 Closed / Landscape 两个静态 Pose，没有连续折叠动画。

`tools/extract-duo-section.py` 从 Closed 内屏网格 `UXtsBZYlaUvHoEh` 的原始 UV 提取半截面：U=0.5 为折痕尖端，向一侧采样至 U≈0.5461055。原单位厘米转为毫米，保留 `(U−0.5, 半间距, 距尖端深度)`；左右由对称关系连接。结果见 `tools/duo-section.json`。可用现有带 pxr 的 Blender Python 复查：

```sh
'/Applications/Blender.app/Contents/Resources/5.0/python/bin/python3.11' tools/extract-duo-section.py /path/to/iPhone_Duo.usdz -o tools/duo-section.json
```

源网格给出的两侧平直内表面间距约 0.52 mm，水滴最宽处约 2.45 mm；对应展开 UV 的过渡长度约 14.53 mm。这三个量含义不同，没有拿媒体报道的水滴宽直接当弧长。运行时对这些固定采样点做平滑插值；0° 使用闭合截面，中间姿态仍为几何过渡，不代表实测铰链运动。

展开态另叠加用户指定的代表工况：峰谷高度差 0.1 mm，跨中线中央切线相对展开基准平面倾斜 1.1°。1.1° 不是两侧夹角，也不是开合角。这两个指标不足唯一还原全截面，因此采用紧支撑的平滑代表曲线 `z = −A × t × (1−t²)³`（`t=x/h`，`|t|≤1`；区间外为 0）。令 `fmax=216/(343×√7)`、`A=0.1/(2×fmax)`、`h=A/tan(1.1°)`，半宽约 10.94 mm。极值在 `t=±1/√7`，高度为 ±0.05 mm；中央导数为 `−tan(1.1°)`，端点高度、一阶和二阶导数均为 0。该代表曲线宽度与闭合水滴过渡长度分开，刚性机身两叶保持原位置。

残余高度及导数均乘 `sin²(开合角 / 2)`：180° 保留全幅起伏和中央 1.1° 法线，0° 完全归零，不撑大原 Closed 截面。position、normal、tangentU 使用同一高度函数与解析导数；此几何工况不被标记为 Duo 的亮度、色度或 SCI / SCE 实测数据。

## Raw renderer 接口

`Phone3D.buildDuo(angle, surface='inner')` 的长度单位为毫米。第二参数仅将所选屏幕的中心移到原点并令其基准平面朝 +Z，不改变 angle；残余折痕的局部 1.1° 法线仍保留。

- `body`：原机身 Mesh 格式，附原生材质基础色 tint 和金属度 / 粗糙度 finish。屏幕后面的黑色遮挡层不透明，正反两面均写深度。
- `screens[]`：两个条目，key 为 inner / outer，各有 mesh、screenHalf、corner、cutout、holes、profile、frame、sample(u,v)。
- `mesh.pos / nor / tangent`：逐顶点 3 分量，分别为变形后位置、法线、U 切向。`mesh.local / uv` 为 2 分量，分别是未折弯平面毫米坐标和连续 UV。
- `frame`、`sample(u,v)`：所选观察朝向下的 point、normal、tangentU、tangentV。供 CPU 指标与每像素局部方向一致地计算 θ / ψ。
- `corners`：当前形态包围盒的 8 个角；`spec`：机身基准尺寸。机型列表按原顺序后追加 Duo，保留旧数字哈希顺序。

三维 `buildDuoPhone` 保留两个独立屏幕材质与纹理，使用相同局部法线 / 切向着色。无数据时显示当前原图或几何离轴角图，亮度 / 色偏 / ΔE 留为破折号，数据面板显示待补充，不借用旧设备曲线。
