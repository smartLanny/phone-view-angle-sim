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

## 显示边缘

显示轮廓取自 Landscape 内屏 `UXtsBZYlaUvHoEh`、外屏 `hhgAIoCGsHXeDPY` 的面片外边界；相机孔的内环不参与轮廓。原屏幕宽高、中心和折叠坐标保持不变，将边界归一到现有 157.53 × 110.80 mm / 77.17 × 112.28 mm 的显示区域，仅清理小于 0.001 mm 的近直边浮点波动。内屏轮廓不是单一圆弧；外屏靠铰链一侧和另一侧轮廓不同，不能用同一个圆半径代替。

固定边界点用沿弧长的三次 Hermite 曲线连接，顶边与侧边的端点切线分别水平和竖直。网格在上下角部使用余弦分布的 32 行、中间使用 16 行，保持折叠横向 128 列及中央折痕采样。原来高度 64 等分时，内屏 6 mm 圆角仅约 3–4 段，第一段对应约 44.65° 圆弧，内切误差约 0.450 mm；shader 无法补回这块已缺失的网格。

Duo 的 `corner=0` 仅取消 shader 的第二次统一圆弧裁剪，实际圆角完整由网格边界定义；没有更换 shader、放大画面或调整外壳。以原尺寸归一后的全部原生外边界作双向距离核对，新网格最大轮廓偏差小于 0.0063 mm。`tools/test_duo_geometry.mjs` 留有独立原生边界抽样，检查四角贴合、尺寸、UV 三角形方向、非均匀行的外屏 UV、0° / 90° / 180° 及连续切屏参考框架，同时保留 Closed 截面和 100 µm / 1.1° 折痕回归。

## 转轴盖与内屏表面

同一 USDZ 里还有一块没有转进网页模型的转轴网格 `MvKPXGSdYDVvSpk`（材质 `isnmyjbXNQZlHGY`）。把 Closed / Landscape 两个姿态的组合变换展开后（USD 坐标 ×10 再平移 (0, −58.85, −2.49) 即网页模型的毫米坐标，误差 < 1e−5 mm）：

- 截面是 U 形壳：宽 8.224 mm、深 2.894 mm，底面在 z = −3.622 mm 平直，两角圆弧约 R2.1，两侧竖直到 z = −0.728 mm；长度 y = −57.669 ~ 57.916 mm。截面点记在 `web/phone3d.js` 的 `HINGE_HALF`。
- 以两半机身的中线为参照，它在两个姿态之间几乎不动：Landscape 时整个藏在两半机身靠折痕一侧的开口里；Closed 时两半机身绕它转开，底面比两段侧壁外沿凸出约 2.3 mm。两姿态之间只整体下沉 0.207 mm（另有 0.3% 的宽度压缩，忽略）。分别以左、右半机身为参照换算到本项目的闭合姿态，结果一致（相差 < 0.01 mm）。
- 材质：缎面金属，星光色底色 (0.89, 0.860, 0.801)、金属度 1，粗糙度贴图均值约 0.31；与抛光中框（粗糙度 0.05）不同。

内屏网格 `UXtsBZYlaUvHoEh` 的材质用第二套 UV 在一张 16×16 的两段式贴图上取清漆参数：大部分面落在“磨砂”段（清漆强度 0.4×2、粗糙度 0.4），只有一圈 24 边形圆片落在“镜面”段（清漆强度 0.2×2、粗糙度 0.05）——这就是屏下摄像头。圆心 (33.683, 48.620) mm、半径 2.326 mm，在右半屏靠上。外屏为普通镜面清漆（强度 0.25、粗糙度 0.05）。

## 环境光遮蔽与颜色变体

网页用的 `iphoneduo.glb` 转换时丢了两样东西，用 `tools/patch-duo-usdz.py`（需要本机的原 USDZ）补回：

- 环境光遮蔽：原材质几乎都接了 occlusion 贴图，glb 里一张都没有。逐个材质按原 UV 组（st → TEXCOORD_0、st1 → TEXCOORD_1，已逐顶点核对一致）挂回 `occlusionTexture`；大图缩到 512²。中框、内屏面板等 7 种材质在原文件里展开 / 合上用两张不同的 AO，合成一张（R = 展开、G = 合上），材质 extras 标 `aoClosedInGreen`，渲染端按开合角混合。
- 颜色变体：原文件有 Star White / Night Sky 两套（星白色是 Color 变体覆盖，夜空色是底层默认值）。夜空色用 `KHR_materials_variants` 加入：16 种材质的底色 / 金属度 / 粗糙度 / 清漆不同，4 张底色贴图不同（背板覆层的透明度烘进 alpha）。转轴盖不在 glb 里，夜空色参数写在 `web/phone3d.js`。

另外核对过：glb 的底色、金属度粗糙度（G = 粗糙度、B = 金属度）、法线贴图与原文件逐像素一致；原文件里只写了清漆粗糙度、没写强度的材质，清漆强度都是 0（glTF 默认值），渲染端按 0 处理。

