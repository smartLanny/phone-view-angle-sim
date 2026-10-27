import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import '../../../web/duo-geometry.js';
import type { DeviceSpec } from './devices';
import type { PhoneModel } from './model';
import type { Profile } from '../optics/model';
import { createScreenMaterial } from '../optics/screen';

export interface ReflectionData {
  sci:unknown|null;sce:unknown|null;geometry:unknown|null;instrument:unknown|null;wavelengthNm:number[]|null;unit:string|null;angularScatter:unknown|null;
}
export interface DuoData {inner:Profile|null;outer:Profile|null;reflection?:{inner:ReflectionData;outer:ReflectionData}}
export type DuoSurface='inner'|'outer';
declare global {interface Window {DuoGeometry:any}}

/**
 * 外屏前摄下面那块长方形安装座（左半机身 x −75.06…−68.59、y 45.18…51.85、z −5.14…−4.30 mm）是机身内部结构，
 * 实物被外屏的黑色印刷挡住；三维画面里它左右两面竖墙会在开孔两侧透出两条细线，加载时去掉这 10 个三角形。
 * 只去掉三个顶点都在这个盒子里、且离镜头圆心 (−71.799, 48.452) 超过 3.1 mm 的三角形：镜头各零件半径不超过 3.05 mm，不受影响。
 */
function stripCameraHousing(leaf:THREE.Object3D) {
  const inBox=(p:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,i:number)=>{const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    return x>-0.0751&&x<-0.0685&&y>0.0451&&y<0.0519&&z>-0.00515&&z<-0.00429&&Math.hypot(x+0.071799,y-0.048452)>0.0031;};
  leaf.traverse(o=>{
    const g=(o as THREE.Mesh).geometry as THREE.BufferGeometry|undefined;
    if(!(o as THREE.Mesh).isMesh||!g?.index)return;
    const p=g.attributes.position,ix=g.index.array,keep:number[]=[];
    for(let t=0;t<ix.length;t+=3)if(!(inBox(p,ix[t])&&inBox(p,ix[t+1])&&inBox(p,ix[t+2])))keep.push(ix[t],ix[t+1],ix[t+2]);
    if(keep.length<ix.length)g.setIndex(keep);
  });
}

export async function buildDuoPhone(spec:DeviceSpec,buffer:ArrayBuffer,angle:number,surface:DuoSurface):Promise<PhoneModel> {
  const D=window.DuoGeometry, native=(await new GLTFLoader().parseAsync(buffer,'')).scene;
  const left=native.getObjectByName('left-leaf')!,right=native.getObjectByName('right-leaf')!;
  native.traverse(o=>{if((o as THREE.Mesh).isMesh){o.castShadow=true;o.receiveShadow=true;}});
  stripCameraHousing(left);
  const group=new THREE.Group(),display=new THREE.Group();display.add(native);group.add(display);
  const geometry=(raw:any)=>{
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(raw.pos.map((n:number)=>n/1000),3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(raw.nor,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(raw.uv,2));
    g.setAttribute('screenLocal',new THREE.Float32BufferAttribute(raw.local.map((n:number)=>n/1000),2));
    g.setAttribute('screenTangent',new THREE.Float32BufferAttribute(raw.tangent,3));
    g.setIndex(raw.idx);return g;
  };
  const surfaces=(['inner','outer'] as DuoSurface[]).map(key=>{
    const d=D.screens[key],material=createScreenMaterial();material.uniforms.uCurved.value=true;material.uniforms.uModelHoles.value=!!d.modelHoles;material.uniforms.uHasData.value=false;
    material.uniforms.uHalf.value.set(d.width/2000,d.height/2000);material.uniforms.uCorner.value=d.corner/1000;
    material.uniforms.uCut.value.set(d.cutout.y/1000,d.cutout.half/1000,d.cutout.r/1000);
    (material.uniforms.uHoles.value as THREE.Vector3[]).forEach((v,i)=>{const h=d.holes[i];v.set(h?h[0]/1000:0,h?h[1]/1000:0,h?h[2]/1000:0);});
    const screen=new THREE.Mesh(new THREE.BufferGeometry(),material);screen.name='screen:'+key;screen.frustumCulled=false;group.add(screen);
    return {key,screen,half:new THREE.Vector2(d.width/2000,d.height/2000),spec:{diag:key==='inner'?7.58:5.36,resW:d.resW,resH:d.resH,corner:d.corner,cutout:d.cutout,holes:d.holes}};
  });
  const black=new THREE.MeshBasicMaterial({color:'#020304',side:THREE.DoubleSide});
  const backing=new THREE.Mesh(new THREE.BufferGeometry(),black);backing.frustumCulled=false;group.add(backing);
  let fold=angle,selected=surface,frameMix=surface==='outer'?1:0;
  const phone:PhoneModel={group,screen:surfaces.find(s=>s.key===surface)!.screen,spec,half:new THREE.Vector2(),source:'apple',screens:surfaces,setColor(){},
    setFold(a,s,mix=s==='outer'?1:0){
      fold=a;selected=s;frameMix=mix;
      for(const [leaf,side] of [[left,-1],[right,1]] as const){const p=D.leafPose(side,a);leaf.rotation.y=p.rotation;leaf.position.set(...p.position.map((n:number)=>n/1000) as [number,number,number]);}
      const f=D.frame(a,s,mix),origin=new THREE.Vector3(...f.origin as [number,number,number]).multiplyScalar(.001).applyAxisAngle(new THREE.Vector3(0,1,0),f.rotation);
      display.rotation.y=f.rotation;display.position.copy(origin).negate();
      for(const item of surfaces){item.screen.geometry.dispose();item.screen.geometry=geometry(D.buildScreen(item.key,a,s,false,mix).mesh);}
      backing.geometry.dispose();backing.geometry=geometry(D.buildScreen('inner',a,s,true,mix).mesh);
      const active=surfaces.find(item=>item.key===s)!;phone.screen=active.screen;phone.half.copy(active.half);
    },
    surfaceFrame(s,u,v){const p=D.surfaceFrame(s,u,v,fold),f=D.frame(fold,selected,frameMix);return {point:D.orient(p.point,f).map((n:number)=>n/1000),normal:D.orient(p.normal,f,true),tangentU:D.orient(p.tangentU,f,true),tangentV:D.orient(p.tangentV,f,true)};},
    dispose(){group.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh)return;m.geometry.dispose();for(const mat of ([] as THREE.Material[]).concat(m.material)){for(const v of Object.values(mat))if(v&&(v as THREE.Texture).isTexture)(v as THREE.Texture).dispose();mat.dispose();}});},
  };
  phone.setFold!(angle,surface);return phone;
}
