const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'web/data.js'), 'utf8'), context);
const payload = context.window.ANG_DATA;
const { createModel, norm360 } = require('../web/model.js');
assert.equal(payload.profiles.length, 5);
let checked = 0;
for (const profile of payload.profiles) {
  const model = createModel({ angles: payload.angles, sets: profile.sets }, { fill: 'vmirror' });
  assert.equal(model.lines.length, 12);
  assert.ok(model.lines.every(line => !line.virtual));
  assert.deepEqual(model.lines.map(line => line.psi), Array.from({length:12}, (_,i) => i*30));
  for (const set of profile.sets) for (const sign of [-1, 1]) for (const theta of [0, 2, 30, 60, 70]) {
    const psi = norm360(set.phi + (sign < 0 ? 180 : 0));
    const sample = model.evalAt(theta, psi);
    const i = payload.angles.indexOf(sign * theta), zero = payload.angles.indexOf(0);
    const expected = set.data.W[i][1] / set.data.W[zero][1];
    assert.ok(Math.abs(sample.yRatio - expected) < 1e-12, `${profile.id} phi=${set.phi} theta=${sign*theta}`);
    assert.ok([sample.jncd, sample.de00, ...sample.T].every(Number.isFinite));
    checked++;
  }
  assert.ok(model.buildLUT().data.every(Number.isFinite));
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/measurement-sources.json')));
assert.equal(manifest.files.length, 30);
for (const file of manifest.files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file.file))).digest('hex'), file.sha256);
console.log(`Verified 30 source hashes, 5 six-direction profiles, 12 measured rays/profile, ${checked} exact-direction optical samples, and finite LUTs.`);
