// 本机的苹果官网 AR 模型（public/local/phone_<颜色>.glb）→ <WEB_DIR>/local/iphone18pm-<颜色>.js（base64 内嵌，file:// 也能用）。
// 这些文件有版权，只在本机使用：web/local/ 已写进仓库根目录的 .gitignore，不会进公开仓库 / GitHub Pages。
// 没有本机模型时什么都不做，网页自动改用参数化模型。
import fs from 'node:fs';
import path from 'node:path';

const src = 'public/local';
const out = path.join(process.argv[2] || process.env.WEB_DIR || '../web', 'local');
const files = fs.existsSync(src) ? fs.readdirSync(src).filter((f) => /^phone_\w+\.glb$/.test(f)) : [];
if (!files.length) { console.log('没有本机苹果模型，跳过'); process.exit(0); }
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'README.txt'),
  '苹果官网 iPhone 18 Pro 的 AR 模型（转成 GLB 后 base64 内嵌）。版权归 Apple，只在本机使用，不要提交到仓库。\n'
  + '来源: https://www.apple.com/iphone-18-pro/ 页面上的 iphone-18-pro-e-sim.usdz\n');
for (const f of files) {
  const v = f.match(/^phone_(\w+)\.glb$/)[1];
  const b64 = fs.readFileSync(path.join(src, f)).toString('base64');
  fs.writeFileSync(path.join(out, `iphone18pm-${v}.js`),
    `window.SCENE3D_IPHONE = window.SCENE3D_IPHONE || {};\nwindow.SCENE3D_IPHONE[${JSON.stringify(v)}] = 'data:model/gltf-binary;base64,${b64}';\n`);
  console.log(`local/iphone18pm-${v}.js`, (b64.length / 1048576).toFixed(1) + ' MB');
}
