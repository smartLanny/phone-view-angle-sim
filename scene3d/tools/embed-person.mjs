// 把人物 glTF（及其 .bin）合成一个缓冲区内嵌的 JSON，写成 window.SCENE3D_PERSON = {...}
// 用法: node tools/embed-person.mjs [输出目录，默认 $WEB_DIR 或 ../web]
import fs from 'node:fs';
import path from 'node:path';

const src = 'public/models/ubc/Superhero_Male_FullBody.gltf';
const out = process.argv[2] || process.env.WEB_DIR || '../web';
const g = JSON.parse(fs.readFileSync(src, 'utf8'));
for (const b of g.buffers) {
  const bin = fs.readFileSync(path.join(path.dirname(src), b.uri));
  b.uri = 'data:application/octet-stream;base64,' + bin.toString('base64');
}
const js = '/* 人物模型：Quaternius Universal Base Characters（CC0），已去贴图。由 scene3d/tools/embed-person.mjs 生成 */\n'
  + 'window.SCENE3D_PERSON = ' + JSON.stringify(g) + ';\n';
fs.writeFileSync(path.join(out, 'scene3d-person.js'), js);
console.log('scene3d-person.js', (js.length / 1024).toFixed(0) + ' KB →', out);
