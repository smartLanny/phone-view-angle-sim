import fs from 'node:fs';
import path from 'node:path';
const source=fs.readFileSync('public/models/iphoneduo.glb');
const out=process.argv[2]||process.env.WEB_DIR||'../web';
fs.mkdirSync(path.join(out,'assets'),{recursive:true});
fs.writeFileSync(path.join(out,'assets/iphoneduo.js'),`window.PHONE_ASSETS=window.PHONE_ASSETS||{};\nwindow.PHONE_ASSETS.iphoneduo='${source.toString('base64')}';\n`);
console.log('assets/iphoneduo.js',(source.length/1048576).toFixed(2)+' MB');
