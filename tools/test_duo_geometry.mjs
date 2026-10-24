import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../web/duo-geometry.js', import.meta.url), 'utf8'), { window });
const D = window.DuoGeometry;
const section = JSON.parse(fs.readFileSync(new URL('../scene3d/tools/duo-section.json', import.meta.url)));
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);

for (const [u, x, z] of section.closedHalfSection) {
  const p = D.foldPoint(u * section.restWidth, 0, 0).point;
  near(p[0], x, 0.00025);
  near(p[2], z, 0.00025);
}

const flat = D.buildScreen('inner', 180).mesh;
const heights = [];
for (let i = 0; i < flat.pos.length / 3; i++) {
  if (Math.abs(flat.local[2 * i + 1]) < 1e-8) heights.push(flat.pos[3 * i + 2]);
}
const peakValley = Math.max(...heights) - Math.min(...heights);
near(peakValley, 0.1, 0.00005);
const center = D.surfaceFrame('inner', 0.5, 0.5, 180);
const centralAngle = Math.acos(center.normal[2]) * 180 / Math.PI;
near(centralAngle, 1.1, 0.000001);

for (const angle of [0, 90, 180]) {
  for (const surface of ['inner', 'outer']) {
    const frame = D.frame(angle, surface);
    const { mesh } = D.buildScreen(surface, angle, surface);
    assert.ok(mesh.pos.every(Number.isFinite));
    for (const u of [0.1, 0.45, 0.5, 0.55, 0.9]) {
      const f = D.surfaceFrame(surface, u, 0.5, angle);
      near(Math.hypot(...f.normal), 1, 1e-10);
      near(dot(f.normal, f.tangentU), 0, 1e-10);
      const a = D.surfaceFrame(surface, u - 1e-7, 0.5, angle).point;
      const b = D.surfaceFrame(surface, u + 1e-7, 0.5, angle).point;
      const tangent = b.map((n, i) => n - a[i]);
      near(dot(f.normal, tangent) / Math.hypot(...tangent), 0, 1e-6);
      assert.ok(D.orient(f.point, frame).every(Number.isFinite));
    }
  }
}

console.log(`Duo geometry: Closed source retained; mesh PV ${(peakValley * 1000).toFixed(3)} µm; central normal ${centralAngle.toFixed(6)}°; six poses passed.`);
