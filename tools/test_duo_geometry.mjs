import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../web/duo-geometry.js', import.meta.url), 'utf8'), { window });
const D = window.DuoGeometry;
const section = JSON.parse(fs.readFileSync(new URL('../scene3d/tools/duo-section.json', import.meta.url)));
const near = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const nativeCorners = {
  inner: [[12.619486,.000152],[9.254121,.05493],[6.635829,.41123],[4.314801,1.321727],[2.403961,2.8388],[1.027787,4.878713],[.277487,7.261033],[.025504,9.956009],[.000271,12.609988]],
  outerLeft: [[1.757376,.000057],[1.048839,.044887],[.664357,.184221],[.344662,.438553],[.126185,.783801],[.023281,1.179904],[.000047,1.75614]],
  outerRight: [[13.334653,.000162],[9.870637,.061508],[7.121381,.452457],[4.668379,1.429958],[2.605477,3.070709],[1.123564,5.250465],[.30642,7.78294],[.029155,10.598431],[.000338,13.334427]],
};
function boundary(mesh) {
  let columns=1;
  while(mesh.local[2*columns+1]===mesh.local[1])columns++;
  const rows=mesh.local.length/(2*columns),points=[];
  for(let j=0;j<rows;j++)points.push(mesh.local.slice(2*j*columns,2*j*columns+2));
  for(let j=rows-1;j>=0;j--)points.push(mesh.local.slice(2*(j*columns+columns-1),2*(j*columns+columns-1)+2));
  return points;
}
function edgeDistance(p,loop) {
  return Math.min(...loop.map((a,i)=>{
    const b=loop[(i+1)%loop.length],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  }));
}

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

let cornerError=0;
for(const key of ['inner','outer']) {
  const d=D.screens[key],mesh=D.buildScreen(key,180).mesh,loop=boundary(mesh);
  near(d.width,key==='inner'?157.53:77.17,1e-12);
  near(d.height,key==='inner'?110.80:112.28,1e-12);
  near(Math.max(...loop.map(p=>p[0]))-Math.min(...loop.map(p=>p[0])),d.width,1e-10);
  near(Math.max(...loop.map(p=>p[1]))-Math.min(...loop.map(p=>p[1])),d.height,1e-10);
  assert.equal(d.corner,0,'the mesh boundary must not be clipped by a second circular mask');
  for(const sx of [-1,1])for(const sy of [-1,1]) {
    const samples=nativeCorners[key==='inner'?'inner':sx<0?'outerLeft':'outerRight'];
    for(const [x,y] of samples)cornerError=Math.max(cornerError,edgeDistance([sx*(d.width/2-x),sy*(d.height/2-y)],loop));
  }
  for(let i=0;i<mesh.idx.length;i+=3) {
    const [a,b,c]=mesh.idx.slice(i,i+3).map(n=>mesh.local.slice(2*n,2*n+2));
    assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0,'screen UV triangle folded or collapsed');
  }
}
assert.ok(cornerError<.008,`native corner mismatch ${cornerError} mm`);

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
    for(const mix of [0,.37,1])for(const key of ['inner','outer']) {
      const mesh=D.buildScreen(key,angle,surface,false,mix).mesh,fr=D.frame(angle,surface,mix),d=D.screens[key];
      const outerCenter=D.surfaceFrame('outer',.5,.5,angle).point;
      near(fr.rotation,(Math.PI-(180-angle)*Math.PI/360)*mix,1e-12);
      for(let k=0;k<3;k++)near(fr.origin[k],outerCenter[k]*mix,1e-12);
      for(let i=0;i<mesh.pos.length/3;i+=97) {
        const u=mesh.uv[2*i],v=mesh.uv[2*i+1],p=D.surfaceFrame(key,u,v,angle);
        const expected=D.orient(p.point.map((n,k)=>n+.025*p.normal[k]),fr),normal=D.orient(p.normal,fr,true);
        near(mesh.local[2*i],(u-.5)*d.width,1e-10);
        near(mesh.local[2*i+1],(v-.5)*d.height,1e-10);
        for(let k=0;k<3;k++){near(mesh.pos[3*i+k],expected[k],1e-9);near(mesh.nor[3*i+k],normal[k],1e-10);}
      }
    }
  }
}

console.log(`Duo geometry: native corner error ${(cornerError*1000).toFixed(3)} µm; dimensions/UV retained; Closed source retained; mesh PV ${(peakValley * 1000).toFixed(3)} µm; central normal ${centralAngle.toFixed(6)}°; six poses and continuous display frames passed.`);
