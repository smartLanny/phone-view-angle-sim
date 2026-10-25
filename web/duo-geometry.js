(function (root) {
  'use strict';
  const screens = {
    // 内屏：防眩光磨砂膜；右上角屏下摄像头（与 holes 相同约定：离中心的横向距离、离上边的距离、半径，毫米）
    inner: { width: 157.53, height: 110.80, resW: 2670, resH: 1878, corner: 0, cutout: { y: 0, half: 0, r: 0 }, holes: [], matte: true, udc: [70.8, 4.6, 1.8] },
    outer: { width: 77.17, height: 112.28, resW: 1398, resH: 2034, corner: 0, cutout: { y: 0, half: 0, r: 0 }, holes: [[30.67, 7.91, 3.045]] },
  };
  const outlines = {
    inner: makeCorner([[12.61949,0],[11.40581,.00306],[10.67767,.01004],[9.95664,.02549],[9.25412,.05493],[8.5708,.1036],[7.90694,.17599],[7.26129,.27746],[6.63583,.41123],[6.02914,.57978],[5.44405,.78441],[4.87664,1.02842],[4.3148,1.32173],[3.79925,1.64259],[3.30911,2.00127],[2.84081,2.40211],[2.40396,2.8388],[2.0027,3.30728],[1.63708,3.80738],[1.31052,4.33445],[1.02779,4.87871],[.78459,5.44355],[.57972,6.02917],[.41131,6.63539],[.27749,7.26103],[.17607,7.90621],[.10363,8.57042],[.05493,9.25405],[.0255,9.95601],[.01005,10.677],[.00308,11.40404],[0,12.60999]]),
    outerLeft: makeCorner([[1.75738,0],[1.32,.00975],[1.1838,.02277],[1.04884,.04489],[.91608,.07839],[.78743,.12465],[.66436,.18422],[.54852,.25691],[.4415,.34203],[.34466,.43855],[.25919,.54531],[.18613,.66091],[.12619,.7838],[.07953,.91231],[.04567,1.04499],[.02328,1.1799],[.00997,1.31609],[0,1.75614]]),
    outerRight: makeCorner([[13.33465,0],[12.09456,.0035],[11.34238,.01146],[10.59893,.02903],[9.87064,.06151],[9.15814,.11512],[8.46225,.19518],[7.78336,.30644],[7.12138,.45246],[6.47704,.63628],[5.85332,.85973],[5.25024,1.1236],[4.66838,1.42996],[4.10714,1.78118],[3.57398,2.17323],[3.07101,2.60494],[2.60548,3.07071],[2.17365,3.57347],[1.78006,4.10856],[1.42848,4.67114],[1.12356,5.25046],[.8594,5.85358],[.63636,6.47722],[.45261,7.12141],[.30642,7.78294],[.19537,8.46196],[.11511,9.15798],[.06175,9.87057],[.02916,10.59843],[.01142,11.34185],[.0036,12.09452],[0,13.33443]]),
  };
  function makeCorner(points) {
    const arc=[0];
    for(let i=1;i<points.length;i++)arc.push(arc[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    const tangent=points.map((p,i)=>i===0?[-1,0]:i===points.length-1?[0,1]:p.map((_,k)=>(points[i+1][k]-points[i-1][k])/(arc[i+1]-arc[i-1])));
    return {points,arc,tangent,height:points[points.length-1][1]};
  }
  function cornerInset(outline,depth) {
    const {points,arc,tangent}=outline;
    if(depth<=0)return points[0][0];
    if(depth>=outline.height)return 0;
    let i=0;while(points[i+1][1]<depth)i++;
    const a=points[i],b=points[i+1],ds=arc[i+1]-arc[i];
    const at=(k,t)=>(2*t*t*t-3*t*t+1)*a[k]+(t*t*t-2*t*t+t)*tangent[i][k]*ds+(-2*t*t*t+3*t*t)*b[k]+(t*t*t-t*t)*tangent[i+1][k]*ds;
    let lo=0,hi=1;
    for(let n=0;n<24;n++){const t=(lo+hi)/2;if(at(1,t)<depth)lo=t;else hi=t;}
    return at(0,(lo+hi)/2);
  }
  // 闭合时折痕处屏幕的截面（单侧，按弧长 u·内屏宽 取样）：泪滴形，底部是半径 1.925 mm 的圆弧，最宽 3.85 mm（CT 实测），
  // 往上收窄到两侧直段的 0.52 mm 间隙；弧长与原来相同（7.263 mm），屏幕长度不变。
  const closed = [[0.0,0.0,0.0],[0.0011526,0.18131,0.00856],[0.0023053,0.361,0.03415],[0.0034579,0.53748,0.07656],[0.0046105,0.70919,0.1354],[0.0057632,0.87459,0.21015],[0.0069158,1.03222,0.30014],[0.0080685,1.18066,0.40459],[0.0092211,1.31862,0.52255],[0.0103737,1.44484,0.65297],[0.0115264,1.55823,0.79471],[0.012679,1.65776,0.9465],[0.0138316,1.74255,1.10698],[0.0149843,1.81185,1.27474],[0.0161369,1.86504,1.44828],[0.0172896,1.90165,1.62606],[0.0184422,1.92135,1.80649],[0.0195948,1.92389,1.98798],[0.0207475,1.90837,2.16881],[0.0219001,1.87545,2.34731],[0.0230527,1.8269,2.52222],[0.0242054,1.76495,2.69286],[0.025358,1.69193,2.85908],[0.0265107,1.61001,3.0211],[0.0276633,1.52112,3.17942],[0.0288159,1.42694,3.33465],[0.0299686,1.3289,3.48748],[0.0311212,1.22828,3.63862],[0.0322738,1.12624,3.78881],[0.0334265,1.02385,3.93876],[0.0345791,0.92217,4.0892],[0.0357318,0.82232,4.24085],[0.0368844,0.72546,4.39443],[0.038037,0.63294,4.55066],[0.0391897,0.54627,4.7102],[0.0403423,0.4672,4.87363],[0.0414949,0.39776,5.04137],[0.0426476,0.3402,5.21353],[0.0438002,0.29683,5.38979],[0.0449529,0.26978,5.56927],[0.0461055,0.26058,5.75054]].map(([u, x, z]) => [u * screens.inner.width, x, z]);
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
  // 内屏的“屏幕中心”取整块屏（沿屏幕弧长均匀取样）的形心，而不是折痕：
  // 这样改变展开角度时，观看距离始终量到屏幕中央，屏幕不会随着折起越靠越近。
  const centroidCache={};
  function innerCentroid(angle) {
    const key=Math.round(angle*100);
    if(centroidCache[key])return centroidCache[key];
    let z=0;const n=96,w=screens.inner.width;
    for(let i=0;i<n;i++)z+=foldPoint(((i+.5)/n-.5)*w,0,angle).point[2]/n;
    return (centroidCache[key]=[0,0,z]);
  }
  function frame(angle, surface='inner', mix=surface==='outer'?1:0) {
    const inner=innerCentroid(angle);
    const origin=mix?surfaceFrame('outer',.5,.5,angle).point.map((n,i)=>inner[i]*(1-mix)+n*mix):inner;
    return { origin, rotation: (Math.PI-(180-angle)*Math.PI/360)*mix };
  }
  function orient(p, f, direction=false) { return rotate(direction?p:p.map((n,i)=>n-f.origin[i]),f.rotation); }
  function buildScreen(key, angle, surface='inner', backing=false, mix) {
    const d = backing ? {width:159.76,height:113.03,corner:6.6} : screens[key], nx=128;
    const mesh={pos:[],nor:[],uv:[],local:[],tangent:[],idx:[]}, f=frame(angle,surface,mix);
    const left=outlines[key==='inner'?'inner':'outerLeft'],right=outlines[key==='inner'?'inner':'outerRight'];
    const band=backing?d.corner:Math.max(left.height,right.height),rows=[];
    for(let j=0;j<=32;j++)rows.push(-d.height/2+band*(1-Math.cos(j*Math.PI/64)));
    for(let j=1;j<=16;j++)rows.push(-d.height/2+band+(d.height-2*band)*j/16);
    for(let j=31;j>=0;j--)rows.push(d.height/2-band*(1-Math.cos(j*Math.PI/64)));
    const ny=rows.length-1;
    for(let j=0;j<=ny;j++) {
      const y=rows[j],v=y/d.height+.5,depth=d.height/2-Math.abs(y);
      const inset=backing?d.corner-Math.sqrt(Math.max(0,d.corner*d.corner-Math.max(0,d.corner-depth)**2)):0;
      const x0=-d.width/2+(backing?inset:cornerInset(left,depth)),x1=d.width/2-(backing?inset:cornerInset(right,depth));
      for(let i=0;i<=nx;i++) {
        const x=i<=48?x0+(-halfCrease-x0)*i/48:i<=80?-halfCrease+2*halfCrease*(i-48)/32:halfCrease+(x1-halfCrease)*(i-80)/48;
        let p;
        if(key==='outer'&&!backing) p=surfaceFrame(key,x/d.width+.5,v,angle);
        else p=foldPoint(x,y,angle);
        // 显示面抬高 0.2 mm：模型自带黑色面板顶面约 0.115 mm，残余折痕最深下凹约 0.057 mm，抬高后显示面始终在面板之上
        const offset=backing?-.025:.2;
        mesh.pos.push(...orient(p.point.map((n,k)=>n+offset*p.normal[k]),f));
        mesh.nor.push(...orient(p.normal,f,true));mesh.tangent.push(...orient(p.tangentU,f,true));
        mesh.local.push(x,y);mesh.uv.push(x/d.width+.5,v);
      }
    }
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+nx+1;mesh.idx.push(a,a+1,b,a+1,b+1,b);}
    return {key,mesh,screenHalf:[d.width/2,d.height/2],corner:d.corner,cutout:backing?{y:0,half:0,r:0}:screens[key].cutout,holes:backing?[]:screens[key].holes,
      matte:!backing&&!!d.matte,udc:backing?null:d.udc||null};
  }
  root.DuoGeometry={screens,foldPoint,leafPose,surfaceFrame,frame,orient,rotate,buildScreen,halfCrease,residual,residualPoint};
})(window);
