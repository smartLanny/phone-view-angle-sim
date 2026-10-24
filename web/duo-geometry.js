(function (root) {
  'use strict';
  const screens = {
    inner: { width: 157.53, height: 110.80, resW: 2670, resH: 1878, corner: 6.0, cutout: { y: 0, half: 0, r: 0 }, holes: [] },
    outer: { width: 77.17, height: 112.28, resW: 1398, resH: 2034, corner: 5.6, cutout: { y: 0, half: 0, r: 0 }, holes: [[30.67, 7.91, 3.045]] },
  };
  const closed = [[0, 0, 0], [.00419135, .61196, .07723], [.00838275, 1.09029, .41282], [.0125742, 1.22656, .99537], [.01676555, 1.15484, 1.61563], [.0209570, 1.00918, 2.23029], [.0251484, .83883, 2.84139], [.0293398, .66778, 3.45379], [.0335312, .51110, 4.07112], [.03772255, .38197, 4.69582], [.0419140, .29365, 5.32862], [.0461055, .26058, 5.96773]].map(([u, x, z]) => [u * screens.inner.width, x, z]);
  const halfCrease = closed[closed.length - 1][0];
  const residualAmplitude=.1/(2*216/(343*Math.sqrt(7)));
  const residual={peakValley:.1,centralSlopeDegrees:1.1,halfWidth:residualAmplitude/Math.tan(1.1*Math.PI/180)};
  function residualPoint(x,angle) {
    const weight=Math.sin(Math.max(0,Math.min(180,angle))*Math.PI/360)**2,L=residual.halfWidth;
    if(Math.abs(x)>=L)return {height:0,derivative:0};
    const t=x/L,k=1-t*t;
    return {height:-weight*residualAmplitude*t*k*k*k,derivative:-weight*residualAmplitude/L*k*k*(1-7*t*t)};
  }
  const rotate = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
  function closedPoint(s) {
    let i = 0;
    while (i < closed.length - 2 && closed[i + 1][0] < s) i++;
    const a = closed[i], b = closed[i + 1], ds = b[0] - a[0], t = (s - a[0]) / ds;
    const slope = (j, k) => j === 0 ? (k === 1 ? (closed[1][1] / closed[1][0]) : 0) : j === closed.length - 1 ? (k === 1 ? 0 : 1) : (closed[j + 1][k] - closed[j - 1][k]) / (closed[j + 1][0] - closed[j - 1][0]);
    const val = [], derivative = [];
    for (let k = 1; k <= 2; k++) {
      const m0 = slope(i, k) * ds, m1 = slope(i + 1, k) * ds;
      val.push((2*t*t*t-3*t*t+1)*a[k]+(t*t*t-2*t*t+t)*m0+(-2*t*t*t+3*t*t)*b[k]+(t*t*t-t*t)*m1);
      derivative.push(((6*t*t-6*t)*a[k]+(3*t*t-4*t+1)*m0+(-6*t*t+6*t)*b[k]+(3*t*t-2*t)*m1)/ds);
    }
    return { val, derivative };
  }
  function foldPoint(x, y, angle) {
    const beta = (180 - Math.max(0, Math.min(180, angle))) * Math.PI / 360, c = Math.cos(beta), b = Math.sin(beta);
    const side = x < 0 ? -1 : 1, s = Math.abs(x), p = closedPoint(Math.min(s, halfCrease)), extra = Math.max(0, s - halfCrease),r=residualPoint(x,angle);
    const px = Math.min(s, halfCrease) * c + p.val[0] * b + extra * c;
    const pz = p.val[1] * b + extra * b+r.height;
    const dx = s > halfCrease ? c : c + p.derivative[0] * b, dz = side*(s > halfCrease ? b : p.derivative[1] * b)+r.derivative, length = Math.hypot(dx, dz);
    return { point: [side * px, y, pz], normal: [-dz / length, 0, dx / length], tangentU: [dx / length, 0, dz / length], tangentV: [0, 1, 0] };
  }
  function leafPose(side, angle) {
    const beta = (180-angle)*Math.PI/360, endpoint = closedPoint(halfCrease).val;
    return { rotation: -side*beta, position: [side*endpoint[0]*Math.sin(beta),0,(endpoint[1]-halfCrease)*Math.sin(beta)] };
  }
  function surfaceFrame(key, u, v, angle) {
    if (key === 'inner') return foldPoint((u-.5)*screens.inner.width, (v-.5)*screens.inner.height, angle);
    const d = screens.outer, p = leafPose(-1, angle), point = rotate([-40.92-(u-.5)*d.width,(v-.5)*d.height,-5.24], p.rotation);
    return { point: point.map((n,i)=>n+p.position[i]), normal:rotate([0,0,-1],p.rotation),tangentU:rotate([-1,0,0],p.rotation),tangentV:[0,1,0] };
  }
  function frame(angle, surface='inner') {
    return { origin: surface==='outer'?surfaceFrame('outer',.5,.5,angle).point:[0,0,0], rotation: surface==='outer'?Math.PI-(180-angle)*Math.PI/360:0 };
  }
  function orient(p, f, direction=false) { return rotate(direction?p:p.map((n,i)=>n-f.origin[i]),f.rotation); }
  function buildScreen(key, angle, surface='inner', backing=false) {
    const d = backing ? {width:159.76,height:113.03,corner:6.6} : screens[key], nx=128, ny=64;
    const mesh={pos:[],nor:[],uv:[],local:[],tangent:[],idx:[]}, f=frame(angle,surface);
    for(let j=0;j<=ny;j++) {
      const y=(j/ny-.5)*d.height, ry=Math.max(0,Math.abs(y)-(d.height/2-d.corner));
      const edge=d.width/2-d.corner+Math.sqrt(Math.max(0,d.corner*d.corner-ry*ry));
      for(let i=0;i<=nx;i++) {
        const x=i<=48?-edge+(edge-halfCrease)*i/48:i<=80?-halfCrease+2*halfCrease*(i-48)/32:halfCrease+(edge-halfCrease)*(i-80)/48;
        let p;
        if(key==='outer'&&!backing) p=surfaceFrame(key,x/d.width+.5,j/ny,angle);
        else p=foldPoint(x,y,angle);
        const offset=backing?-.025:.025;
        mesh.pos.push(...orient(p.point.map((n,k)=>n+offset*p.normal[k]),f));
        mesh.nor.push(...orient(p.normal,f,true));mesh.tangent.push(...orient(p.tangentU,f,true));
        mesh.local.push(x,y);mesh.uv.push(x/d.width+.5,j/ny);
      }
    }
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+nx+1;mesh.idx.push(a,a+1,b,a+1,b+1,b);}
    return {key,mesh,screenHalf:[d.width/2,d.height/2],corner:d.corner,cutout:backing?{y:0,half:0,r:0}:screens[key].cutout,holes:backing?[]:screens[key].holes};
  }
  root.DuoGeometry={screens,foldPoint,leafPose,surfaceFrame,frame,orient,rotate,buildScreen,halfCrease,residual,residualPoint};
})(window);
