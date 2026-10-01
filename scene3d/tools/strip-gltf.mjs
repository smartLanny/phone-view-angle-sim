// 精简 Quaternius UBC 的 glTF：去掉贴图引用（场景里统一换成自己的材质），只保留几何体、骨骼与蒙皮。
// 用法: node tools/strip-gltf.mjs <输入.gltf> <输出目录>
import fs from 'node:fs';
import path from 'node:path';

const [src, outDir] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(src, 'utf8'));
delete g.images; delete g.textures; delete g.samplers;
for (const m of g.materials || []) {
  const pbr = m.pbrMetallicRoughness || {};
  delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
  delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  delete m.extensions;
}
if (g.extensionsUsed) g.extensionsUsed = g.extensionsUsed.filter((e) => !/texture/i.test(e));
const name = path.basename(src);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, name), JSON.stringify(g));
for (const b of g.buffers) fs.copyFileSync(path.join(path.dirname(src), b.uri), path.join(outDir, b.uri));
console.log(name, '→', outDir);
