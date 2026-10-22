import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync('public/models/iphone17pm.glb');
const out = process.argv[2] || process.env.WEB_DIR || '../web';
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.writeFileSync(path.join(out, 'assets/iphone17pm.js'),
  `window.PHONE_ASSETS = window.PHONE_ASSETS || {};\nwindow.PHONE_ASSETS.iphone17pm = '${source.toString('base64')}';\n`);
console.log('assets/iphone17pm.js', (source.length / 1048576).toFixed(2) + ' MB');
