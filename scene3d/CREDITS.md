# 外部素材与许可

| 素材 | 来源 | 许可 | 用法 |
|---|---|---|---|
| 人物：Superhero_Male_FullBody | Quaternius · [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html)（免费 Standard 版，itch.io 下载，2025-12-16 版本） | CC0 1.0（见 `public/models/ubc/LICENSE-Quaternius-UBC.txt`） | 去掉了全部贴图，只保留几何体、骨骼（含手指骨骼）与蒙皮；不用头发、眼球和眉毛；运行时按骨骼收细四肢和肩颈、平滑肌肉与面部细节，做成普通身材的中性人台，并换成自己的半透明材质 |
| three.js | <https://threejs.org> | MIT | 渲染 |
| iPhone Duo AR 模型（`iPhone_Duo_e-sim_Star-White_Variant.usdz`） | Apple 官网 [iPhone Duo](https://www.apple.com/iphone-duo/) 页面的 AR 模型 | © Apple Inc.，见下方说明 | 转换为 `public/models/iphoneduo.glb`（网页内嵌为 `web/assets/iphoneduo.js`）；`tools/patch-duo-usdz.py` 从原 USDZ 补回环境光遮蔽贴图与夜空色；转轴截面、内屏清漆参数取自原模型 |
| iPhone 17 Pro Max 外观 | Apple 官网 iPhone 17 Pro 系列的 AR 模型 | © Apple Inc.，见下方说明 | `tools/convert-phone17.py`（Blender）转换为 `public/models/iphone17pm.glb`（网页内嵌为 `web/assets/iphone17pm.js`） |
| iPhone 18 Pro Max 外观（`iphone-18-pro-e-sim.usdz`） | Apple 官网 [iPhone 18 Pro](https://www.apple.com/iphone-18-pro/) 页面的 AR 模型 | © Apple Inc.，见下方说明 | `tools/convert-iphone18-usdz.py` 转换为 `public/models/iphone18pm.glb`（四种颜色是同一文件里的材质变体，网页内嵌为 `web/assets/iphone18pm.js`）；长宽按官方 163.4 × 78.0 mm 放大成 Pro Max（原模型机身 149.96 × 71.78 mm），厚度不变；原模型的屏幕网格去掉 |
| NumPy、Pillow | PyPI | BSD / HPND | 本机转换工具，不随项目分发 |

免费版只含 Superhero 比例的男女两个基础模型；常规比例（Regular）在付费的 Source 版里。

## 苹果官网模型

上表三款手机的外观模型来自 Apple 官网产品页的 AR（AR Quick Look）模型，版权归 Apple Inc. 所有。
本项目用于配合 Apple 的产品宣传，经项目方确认，这些模型及由其转换、补全得到的文件（GLB、内嵌的 base64 脚本、贴图）可以随本公开仓库和 GitHub Pages 网页一起发布。
除格式转换（含颜色变体、去掉模型自带的屏幕网格）、按官方尺寸缩放、补回转换时丢失的贴图之外，没有修改模型本身；Duo 的转轴盖按原模型里的截面重建，网页上的屏幕显示是本项目按实测数据另行绘制的。
如需在本项目之外使用这些模型，请直接向 Apple 了解其使用条款。

