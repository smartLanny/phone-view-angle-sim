// public/models/iphone18pm.glb（由 tools/convert-iphone18-usdz.py 从苹果官网 AR 模型转换，© Apple，见 CREDITS.md）
// → <WEB_DIR>/assets/iphone18pm.js（base64 内嵌，file:// 也能用）
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync('public/models/iphone18pm.glb');
const out = process.argv[2] || process.env.WEB_DIR || '../web';
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.writeFileSync(path.join(out, 'assets/iphone18pm.js'),
  `window.PHONE_ASSETS = window.PHONE_ASSETS || {};\nwindow.PHONE_ASSETS.iphone18pm = '${source.toString('base64')}';\n`);
console.log('assets/iphone18pm.js', (source.length / 1048576).toFixed(2) + ' MB');
