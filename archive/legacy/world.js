import * as THREE from '../../vendor/three/three.module.js';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import {ROAD_SURFACE as ROAD,RIVER_SURFACE as RIVER,smoothstep,streetDecorationSpans} from '../../src/rendering/terrain/road-surfaces.js';

export const CENTERS={aurora:[0,0],sever:[-70,-500],vega:[-480,100],gorny:[430,-330],mirny:[430,350],port:[-330,520],vesper:[1660,0],north:[1380,-480],argon:[1990,-350],tarn:[1220,330],delta:[1990,350],raven:[1600,620]};
const BUILD_SIZE={housing:22,commerce:26,industry:30,energy:29,lab:25,park:28,shelter:23,gun:23,sam:27,shield:30};
const ownIds=Object.keys(CENTERS).slice(0,6);
function rng(seed){let a=seed;return()=>{a=(Math.imul(a,1664525)+1013904223)>>>0;return a/4294967296;};}
function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}

export class CityWorld{
 constructor(options){
  this.options=options;this.state=null;this.tool=null;this.night=false;this.quality='high';this.battle=false;this.battleTime=0;this.animations=[];this.flights=[];this.particles=[];this.smokes=[];this.buildings=[];this.customGroups=new Map();this.cityGroups=new Map();this.roads=[];this.roadStart=null;this.pointerDown=null;this.pressed=new Set();this.frame=0;this.last=performance.now();
  this.root=document.createElement('div');this.root.className='world-root';
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;this.root.append(this.renderer.domElement);
  this.scene=new THREE.Scene();this.scene.fog=new THREE.FogExp2(0xb7cccf,.0004);
  this.camera=new THREE.PerspectiveCamera(48,1,2,6000);this.camera.position.set(375,300,390);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,14,0);this.controls.enableDamping=true;this.controls.dampingFactor=.07;this.controls.minDistance=40;this.controls.maxDistance=2100;this.controls.maxPolarAngle=Math.PI*.47;this.controls.minPolarAngle=.1;this.controls.panSpeed=.8;this.controls.rotateSpeed=.5;this.controls.screenSpacePanning=false;this.controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.ROTATE,RIGHT:THREE.MOUSE.ROTATE};
  this.materials={};this.geometry={box:new THREE.BoxGeometry(1,1,1),cylinder:new THREE.CylinderGeometry(1,1,1,10),sphere:new THREE.IcosahedronGeometry(1,1),cone:new THREE.ConeGeometry(1,1,7)};this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);this.intersection=new THREE.Vector3();
  this.ambient=new THREE.HemisphereLight(0xdbeaf1,0x73835b,2.1);this.scene.add(this.ambient);this.sun=new THREE.DirectionalLight(0xffe5bf,3.4);this.sun.position.set(-280,490,180);this.sun.castShadow=true;Object.assign(this.sun.shadow.camera,{left:-500,right:500,top:500,bottom:-500,near:5,far:1400});this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.0004;this.sun.shadow.normalBias=.7;this.sun.shadow.radius=2;this.scene.add(this.sun);this.scene.add(this.sun.target);
  this.createTextures();this.createTerrain();this.createTrees();this.createClouds();this.createGhost();
  this.labels=document.createElement('div');this.labels.className='world-labels';this.root.append(this.labels);for(const [id,pos]of Object.entries(CENTERS)){const el=document.createElement('button');el.className=`world-city-label ${ownIds.includes(id)?'own':'enemy'}`;el.dataset.city=id;el.innerHTML=`<i></i><span>${id}</span><small>100%</small>`;el.addEventListener('click',()=>this.options.onSelect(id));this.labels.append(el);}
  const canvas=this.renderer.domElement;canvas.addEventListener('pointerdown',e=>{this.pointerDown={x:e.clientX,y:e.clientY,time:performance.now(),button:e.button};});canvas.addEventListener('pointerup',e=>this.click(e));canvas.addEventListener('pointermove',e=>this.move(e));canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(this.tool){this.setTool(null);this.options.onCancelTool();}});canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.options.onError?.('Графический контекст потерян. Обновите страницу.');});
  window.addEventListener('keydown',e=>{if(!['INPUT','TEXTAREA'].includes(e.target.tagName))this.pressed.add(e.code);});window.addEventListener('keyup',e=>this.pressed.delete(e.code));window.addEventListener('blur',()=>this.pressed.clear());
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.root);this.resize();this.animate();
 }
 mat(color,roughness=.85,metalness=0){const key=`${color}-${roughness}-${metalness}`;return this.materials[key]??=new THREE.MeshStandardMaterial({color,roughness,metalness});}
 box(parent,x,y,z,w,h,d,color,shadow=true){const mesh=new THREE.Mesh(this.geometry.box,typeof color==='object'?color:this.mat(color));mesh.position.set(x,y+h/2,z);mesh.scale.set(w,h,d);mesh.castShadow=shadow;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
 cylinder(parent,x,y,z,r,h,color,rTop){const geo=rTop===undefined?this.geometry.cylinder:new THREE.CylinderGeometry(rTop,r,h,12);const m=new THREE.Mesh(geo,this.mat(color));m.position.set(x,y+h/2,z);if(rTop===undefined)m.scale.set(r,h,r);m.castShadow=true;parent.add(m);return m;}
 createTextures(){
  const sky=document.createElement('canvas');sky.width=1024;sky.height=512;const c=sky.getContext('2d'),g=c.createLinearGradient(0,0,0,512);g.addColorStop(0,'#8baec6');g.addColorStop(.4,'#bdd1d9');g.addColorStop(.54,'#dfd9c6');g.addColorStop(.7,'#8a9c8b');g.addColorStop(1,'#72856f');c.fillStyle=g;c.fillRect(0,0,1024,512);this.sky=new THREE.CanvasTexture(sky);this.sky.mapping=THREE.EquirectangularReflectionMapping;this.sky.colorSpace=THREE.SRGBColorSpace;this.scene.background=this.sky;this.scene.environment=this.sky;this.scene.environmentIntensity=.3;
  const random=rng(931);for(const [name,base,glass]of [['cream','#d8d0ba','#71828b'],['white','#d6dad6','#6d8a93'],['brick','#ab9782','#5d737d'],['glass','#779ba3','#476879'],['blue','#a9bcc0','#54727f']]){
   const can=document.createElement('canvas');can.width=128;can.height=256;const ctx=can.getContext('2d');ctx.fillStyle=base;ctx.fillRect(0,0,128,256);
   for(let row=0;row<16;row++)for(let col=0;col<6;col++){ctx.fillStyle=random()<.1?'#b2aa85':glass;ctx.fillRect(col*21+5,row*16+3,name==='glass'?18:10,name==='glass'?12:8);ctx.fillStyle='#ffffff16';ctx.fillRect(col*21+5,row*16+3,2,7);}
   const tex=new THREE.CanvasTexture(can);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());this.materials[name]=new THREE.MeshStandardMaterial({map:tex,color:0xffffff,roughness:name==='glass'?.28:.85,metalness:name==='glass'?.4:.05});
  }
  const terrain=document.createElement('canvas');terrain.width=512;terrain.height=512;const ctx=terrain.getContext('2d'),data=ctx.createImageData(512,512);for(let i=0;i<data.data.length;i+=4){const n=random()*24;data.data[i]=111+n;data.data[i+1]=135+n;data.data[i+2]=88+n*.7;data.data[i+3]=255;}ctx.putImageData(data,0,0);const t=new THREE.CanvasTexture(terrain);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(50,50);t.colorSpace=THREE.SRGBColorSpace;this.grassMaterial=new THREE.MeshStandardMaterial({map:t,roughness:1,color:0xbac6a8});
  const smoke=document.createElement('canvas');smoke.width=64;smoke.height=64;const sc=smoke.getContext('2d'),sg=sc.createRadialGradient(32,32,1,32,32,31);sg.addColorStop(0,'#ffffffbb');sg.addColorStop(.35,'#ffffff88');sg.addColorStop(1,'#ffffff00');sc.fillStyle=sg;sc.fillRect(0,0,64,64);this.smokeTexture=new THREE.CanvasTexture(smoke);
 }
 riverX(z){return 820+Math.sin(z*.0025)*70+Math.cos(z*.005)*18;}
 height(x,z){
  let cityDistance=99999;for(const p of Object.values(CENTERS))cityDistance=Math.min(cityDistance,Math.hypot(x-p[0],z-p[1]));
  const hills=Math.sin(x*.003)*Math.cos(z*.0034)*50+Math.sin(x*.009+z*.002)*13;let ground=Math.max(0,hills)*Math.min(1,Math.max(0,(cityDistance-210)/400));
  if(ground>0){let flatten=1;for(const road of [...(this.groundRoadLayout||[]),...(this.state?.roads||[])]){const margin=(road.width||9)/2+36;flatten=Math.min(flatten,smoothstep(margin,margin+50,segmentDistance({x,z},road.a,road.b)));if(flatten===0)break;}ground*=flatten;}
  const riverDistance=Math.abs(x-this.riverX(z)),bank=smoothstep(RIVER.bedHalfWidth,RIVER.bedHalfWidth+RIVER.bankWidth,riverDistance);
  return RIVER.bed*(1-bank)+ground*bank;
 }
 groundRoads(){
  const roads=[],link=(a,b,width=11)=>roads.push({a:{x:CENTERS[a][0],z:CENTERS[a][1]},b:{x:CENTERS[b][0],z:CENTERS[b][1]},width});
  for(const [a,b]of [['aurora','sever'],['aurora','vega'],['aurora','gorny'],['aurora','mirny'],['vega','port'],['port','mirny'],['vesper','north'],['vesper','argon'],['vesper','tarn'],['vesper','delta'],['raven','delta']])link(a,b);
  for(const [id,[cx,cz]]of Object.entries(CENTERS)){const capital=id==='aurora'||id==='vesper',count=capital?7:4,spacing=capital?44:43,offset=(count-1)*spacing/2;
   for(let i=0;i<=count;i++){const v=i*spacing-offset-spacing/2,width=i===Math.floor(count/2)?11:7;roads.push({a:{x:cx-offset-spacing/2,z:cz+v},b:{x:cx+offset+spacing/2,z:cz+v},width},{a:{x:cx+v,z:cz-offset-spacing/2},b:{x:cx+v,z:cz+offset+spacing/2},width});}}
  return roads;
 }
 updateTerrainGeometry(){const p=this.terrain.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,this.height(p.getX(i),p.getZ(i))-.1);p.needsUpdate=true;this.terrain.geometry.computeVertexNormals();this.terrain.geometry.computeBoundingSphere();}
 createTerrain(){
  this.groundRoadLayout=this.groundRoads();const geo=new THREE.PlaneGeometry(6500,5500,260,220);geo.rotateX(-Math.PI/2);this.terrain=new THREE.Mesh(geo,this.grassMaterial);this.updateTerrainGeometry();this.terrain.receiveShadow=true;this.scene.add(this.terrain);
  const vertices=[],indices=[];for(let i=0;i<=220;i++){const z=-2750+i*5500/220,x=this.riverX(z);vertices.push(x-RIVER.meshHalfWidth,RIVER.level,z,x+RIVER.meshHalfWidth,RIVER.level,z);if(i<220){const n=i*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}}
  const waterGeo=new THREE.BufferGeometry();waterGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));waterGeo.setIndex(indices);waterGeo.computeVertexNormals();this.water=new THREE.Mesh(waterGeo,new THREE.MeshStandardMaterial({color:0x5d9fa7,roughness:.35,metalness:.25}));this.water.name='river-water';this.scene.add(this.water);
  this.roadGroup=new THREE.Group();this.scene.add(this.roadGroup);this.nativeRoads=[];this.linkRoad('aurora','sever');this.linkRoad('aurora','vega');this.linkRoad('aurora','gorny');this.linkRoad('aurora','mirny');this.linkRoad('vega','port');this.linkRoad('port','mirny');this.linkRoad('vesper','north');this.linkRoad('vesper','argon');this.linkRoad('vesper','tarn');this.linkRoad('vesper','delta');this.linkRoad('raven','delta');
  this.road({x:575,z:40},{x:1150,z:40},12,true);for(let x=720;x<=960;x+=65){this.box(this.roadGroup,x,RIVER.bed,40,5,ROAD.bridgeElevation-RIVER.bed,4,0xb6b8ab);this.box(this.roadGroup,x,ROAD.bridgeElevation,40,3,21,3,0xb6b8ab);}
  this.cars=[];const random=rng(1734);for(let i=0;i<62;i++){const r=this.nativeRoads[i%this.nativeRoads.length],g=new THREE.Group();this.box(g,0,0,0,3,1.6,6,[0xd7dfd8,0x4b6877,0xcfa17b,0x878e8c][i%4],false);this.box(g,0,1.6,.2,2.5,.9,2.7,0x698087,false);this.scene.add(g);this.cars.push({g,r,t:random(),speed:.006+random()*.009});}
 }
 road(a,b,width=9,bridge=false,custom=false){
  if(!this.roadMaterials){this.roadMaterials={asphalt:new THREE.MeshStandardMaterial({color:0x586264,roughness:.95}),curb:new THREE.MeshStandardMaterial({color:0xb5b6a3,roughness:.9}),mark:new THREE.MeshStandardMaterial({color:0xdfdbb3,roughness:.9,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2})};for(const [name,material]of Object.entries(this.roadMaterials))material.name=`road-${name}`;}
  const length=Math.hypot(b.x-a.x,b.z-a.z),g=new THREE.Group();g.position.set((a.x+b.x)/2,bridge?ROAD.bridgeElevation:0,(a.z+b.z)/2);g.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);
  const deck=this.box(g,0,ROAD.asphaltBase,0,width,ROAD.asphaltThickness,length,this.roadMaterials.asphalt,false);deck.renderOrder=10;
  g.userData.road={a,b,width,elevation:g.position.y};this.roadGroup.add(g);if(!custom)this.nativeRoads.push({a,b,width,bridge});return g;
 }
 roadDetails(group,street,network){
  if(group.userData.details)group.remove(group.userData.details);const detail=new THREE.Group();group.add(detail);group.userData.details=detail;
  const length=Math.hypot(street.b.x-street.a.x,street.b.z-street.a.z);
  const strip=(lateral,width,base,height,material,order)=>{for(const [start,end]of streetDecorationSpans(street,network,lateral,1.4+width/2)){if(end-start<.2)continue;const mesh=this.box(detail,lateral,base,(start+end-length)/2,width,height,end-start,material,false);mesh.renderOrder=order;}};
  for(const side of [-1,1]){strip(side*(street.width/2+.7),1.4,ROAD.curbBase,ROAD.curbHeight,this.roadMaterials.curb,11);strip(side*street.width*.35,.25,ROAD.markBase,ROAD.markThickness,this.roadMaterials.mark,12);}
  const visible=streetDecorationSpans(street,network,0,1.7);for(let start=5;start<length;start+=12){const end=Math.min(length,start+4.5);if(!visible.some(([a,b])=>start>=a&&end<=b))continue;const mesh=this.box(detail,0,ROAD.markBase,(start+end-length)/2,.3,ROAD.markThickness,end-start,this.roadMaterials.mark,false);mesh.renderOrder=12;}
 }
 linkRoad(a,b){const aa=CENTERS[a],bb=CENTERS[b];this.road({x:aa[0],z:aa[1]},{x:bb[0],z:bb[1]},11);}
 createTrees(){
  const random=rng(9826),positions=[];for(let i=0;i<4200;i++){const x=random()*4700-1400,z=random()*3000-1500;if(Math.abs(x-this.riverX(z))<RIVER.exclusion)continue;let clear=true;for(const [id,p]of Object.entries(CENTERS)){if(Math.hypot(x-p[0],z-p[1])<(id==='aurora'||id==='vesper'?235:135)){clear=false;break;}}if(clear&&this.nativeRoads.every(r=>segmentDistance({x,z},r.a,r.b)>16))positions.push([x,this.height(x,z),z,4+random()*7]);}
  const trunk=new THREE.InstancedMesh(this.geometry.cylinder,this.mat(0x756b4c),positions.length),crown=new THREE.InstancedMesh(this.geometry.cone,this.mat(0x506e46),positions.length),crown2=new THREE.InstancedMesh(this.geometry.sphere,this.mat(0x6f894f),Math.floor(positions.length/3));const m=new THREE.Object3D();positions.forEach(([x,y,z,h],i)=>{m.position.set(x,y+h*.25,z);m.scale.set(.8,h*.5,.8);m.updateMatrix();trunk.setMatrixAt(i,m.matrix);m.position.set(x,y+h*.8,z);m.scale.set(h*.43,h*1.25,h*.43);m.updateMatrix();crown.setMatrixAt(i,m.matrix);if(i%3===0&&Math.floor(i/3)<crown2.count){m.position.set(x,y+h*.7,z);m.scale.set(h*.55,h*.64,h*.55);m.updateMatrix();crown2.setMatrixAt(Math.floor(i/3),m.matrix);}});trunk.castShadow=false;crown.castShadow=true;crown2.castShadow=true;this.scene.add(trunk,crown,crown2);this.trees=[trunk,crown,crown2];
 }
 createClouds(){this.clouds=[];const random=rng(81);for(let i=0;i<16;i++){const g=new THREE.Group();g.position.set(random()*4000-1000,400+random()*180,random()*2600-1300);for(let k=0;k<5;k++){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:this.smokeTexture,color:0xf6f8f4,transparent:true,opacity:.18,depthWrite:false}));s.position.set(k*40-70,random()*15,random()*35);s.scale.set(150,65,1);g.add(s);}this.scene.add(g);this.clouds.push(g);}}
 createGhost(){this.ghost=new THREE.Group();this.ghostMaterial=new THREE.MeshBasicMaterial({color:0x91e4b0,transparent:true,opacity:.35,depthWrite:false});this.box(this.ghost,0,0,0,26,16,26,this.ghostMaterial,false);const border=new THREE.EdgesGeometry(new THREE.BoxGeometry(26,16,26));const lines=new THREE.LineSegments(border,new THREE.LineBasicMaterial({color:0xccffe1,transparent:true,opacity:.9}));lines.position.y=8;this.ghost.add(lines);this.ghost.visible=false;this.scene.add(this.ghost);this.grid=new THREE.GridHelper(800,40,0x94bdaa,0x9ab7a3);this.grid.material.transparent=true;this.grid.material.opacity=.16;this.grid.position.y=.22;this.grid.visible=false;this.scene.add(this.grid);this.roadPreview=null;}
 createCity(id,index){
  const [cx,cz]=CENTERS[id],capital=id==='aurora'||id==='vesper',enemy=!ownIds.includes(id),random=rng(index*823+33),group=new THREE.Group();group.position.set(cx,0,cz);this.scene.add(group);const base=[],count=capital?7:4,spacing=capital?44:43,offset=(count-1)*spacing/2;
  for(let row=0;row<count;row++)for(let col=0;col<count;col++){
   const x=col*spacing-offset,z=row*spacing-offset;
   for(let k=0;k<4;k++){
    const xx=x+(k%2?9:-9),zz=z+(k>1?9:-9);if(random()<.12)continue;let height=capital?12+random()*30:6+random()*20;const center=Math.hypot(x,z);if(capital&&center<85)height+=35+random()*45;if(capital&&center<30)height+=20;
    const w=10+random()*5,d=10+random()*5,body=new THREE.Group();body.position.set(xx,0,zz);const name=['cream','white','brick','glass','blue'][height>65?3:Math.floor(random()*5)];this.box(body,0,0,0,w,height,d,this.materials[name]);this.box(body,0,height,0,w+.7,1,d+.7,[0x9a9e94,0x889999,0xb6b7a9][k%3]);if(height>60){this.box(body,0,height+1,0,w*.55,5,d*.5,0x75909a);if(random()<.3)this.cylinder(body,0,height+6,0,.3,15,0xabb9b5);}else if(random()<.45)this.box(body,2,height+1,2,2.8,2,3.5,0xb1b8ae);
    group.add(body);const record={mesh:body,id:`base-${id}-${row}-${col}-${k}`,cityId:id,threshold:random()*92+4,x:xx+cx,z:zz+cz,height,originalY:0,dead:false,base:true};body.traverse(o=>{if(o.isMesh)o.userData.building=record;});base.push(record);this.buildings.push(record);
   }
  }
  for(let i=0;i<=count;i++){const v=i*spacing-offset-spacing/2;this.road({x:cx-offset-spacing/2,z:cz+v},{x:cx+offset+spacing/2,z:cz+v},i===Math.floor(count/2)?11:7);this.road({x:cx+v,z:cz-offset-spacing/2},{x:cx+v,z:cz+offset+spacing/2},i===Math.floor(count/2)?11:7);}
  const plaza=new THREE.Group();plaza.position.set(capital?-178:-110,.12,capital?45:0);this.box(plaza,0,0,0,27,.15,50,0xb8b99e,false);this.cylinder(plaza,0,0,0,7,1.5,0xbfcac0);this.cylinder(plaza,0,1.5,0,4,.2,0x77adb5);this.cylinder(plaza,0,2,0,.25,8,0xdee2d5);group.add(plaza);
  this.cityGroups.set(id,{group,base,capital,enemy,signature:'',extras:[]});
  const treePositions=[];for(let row=0;row<=count;row++)for(let col=0;col<count;col++){if((row+col)%2===0)treePositions.push([col*spacing-offset+15,row*spacing-offset-spacing/2+6]);}
  const trunks=new THREE.InstancedMesh(this.geometry.cylinder,this.mat(0x7c7052),treePositions.length),leaves=new THREE.InstancedMesh(this.geometry.sphere,this.mat(0x728e50),treePositions.length),o=new THREE.Object3D();treePositions.forEach(([x,z],i)=>{o.position.set(x,2,z);o.scale.set(.4,4,.4);o.updateMatrix();trunks.setMatrixAt(i,o.matrix);o.position.y=6;o.scale.set(2.8,3.3,2.8);o.updateMatrix();leaves.setMatrixAt(i,o.matrix);});leaves.castShadow=true;group.add(trunks,leaves);
 }
 batchCityBuildings(id){
  const city=this.cityGroups.get(id),batches=new Map();for(const b of city.base){b.mesh.updateMatrix();for(const child of b.mesh.children){if(!child.isMesh)continue;child.updateMatrix();const key=child.material.uuid;if(!batches.has(key))batches.set(key,{material:child.material,parts:[]});batches.get(key).parts.push({b,child,local:child.matrix.clone()});}b.mesh.visible=false;}
  for(const batch of batches.values()){const im=new THREE.InstancedMesh(this.geometry.box,batch.material,batch.parts.length);im.castShadow=true;im.receiveShadow=true;im.userData.records=[];batch.parts.forEach(({b,child,local},index)=>{const m=b.mesh.matrix.clone().multiply(local);im.setMatrixAt(index,m);im.userData.records[index]=b;b.instances??=[];b.instances.push({mesh:im,index,local});});im.computeBoundingSphere();city.group.add(im);}
 }
 batchRoads(){
  if(this.roadBatch){this.scene.remove(this.roadBatch);for(const mesh of this.roadBatch.children)mesh.dispose();}
  const streets=this.roadGroup.children.filter(g=>g.userData.road),network=streets.map((g,index)=>({...g.userData.road,index}));streets.forEach((g,index)=>this.roadDetails(g,network[index],network));
  this.roadBatch=new THREE.Group();this.scene.add(this.roadBatch);this.scene.updateMatrixWorld(true);const batches=new Map();this.roadGroup.traverse(o=>{if(!o.isMesh)return;const key=o.material.uuid;if(!batches.has(key))batches.set(key,{material:o.material,matrices:[],order:o.renderOrder});batches.get(key).matrices.push(o.matrixWorld.clone());});for(const b of batches.values()){const im=new THREE.InstancedMesh(this.geometry.box,b.material,b.matrices.length);b.matrices.forEach((m,i)=>im.setMatrixAt(i,m));im.receiveShadow=true;im.renderOrder=b.order;im.computeBoundingSphere();this.roadBatch.add(im);}this.roadGroup.visible=false;
 }
 updateInstances(b){if(!b.instances)return;b.mesh.updateMatrix();for(const i of b.instances){i.mesh.setMatrixAt(i.index,b.mesh.matrix.clone().multiply(i.local));i.mesh.instanceMatrix.needsUpdate=true;}}
 model(key,x=0,z=0,rotation=0){
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=rotation;const s=BUILD_SIZE[key]||24;
  this.box(g,0,.02,0,s+5,.15,s+5,key==='park'?0x7e9d61:0xb8bba9,false);
  if(key==='housing'){
   this.box(g,-5,0,0,11,27,18,this.materials.white);this.box(g,7,0,2,9,19,14,this.materials.brick);this.box(g,-5,27,0,12,1,19,0xb5bfb7);this.box(g,7,19,2,10,1,15,0x9fada5);
  }else if(key==='commerce'){
   this.box(g,0,0,0,25,9,23,this.materials.glass);this.box(g,0,9,0,27,1.2,25,0xd6d9cc);this.box(g,0,10,0,19,3,13,0xb7c0bd);this.box(g,0,3,12.2,20,3,.6,0x658f9e);for(let i=-8;i<=8;i+=4)this.box(g,i,.1,-15,2,.03,5,0xe2dfcc,false);
  }else if(key==='industry'){
   this.box(g,0,0,0,29,12,26,0xa69f8d);this.box(g,0,12,0,30,1,27,0x758a8a);for(let i=-7;i<=7;i+=7)this.box(g,i,13,0,3,2,14,0x9aaca7);for(let i=0;i<2;i++){this.cylinder(g,8-i*5,0,-9,1.8,29,0xc4bd9e);this.cylinder(g,8-i*5,25,-9,1.86,2,0xa87963);}this.box(g,0,4,13.1,25,2,.1,0x647c82,false);
  }else if(key==='energy'){
   this.box(g,-5,0,2,18,9,25,0xa5b6ad);for(let i=0;i<2;i++)this.cylinder(g,9,0,i*12-6,5.5,20,0xd5d6bd,3.8);this.box(g,-5,9,2,19,.8,26,0x6b878c);for(let i=-9;i<=2;i+=5){this.box(g,i,0,18,3,3,4,0x7197aa);}
  }else if(key==='lab'){
   this.box(g,-5,0,0,15,12,24,this.materials.white);this.box(g,7,0,2,9,18,18,this.materials.glass);this.box(g,-5,12,0,17,.6,26,0xd6ded4);this.cylinder(g,-5,13,0,5,1.7,0x698c9a);this.box(g,0,0,-12,24,2,3,0xdce5d6);
  }else if(key==='park'){
   this.box(g,0,.16,0,3,.08,28,0xd8cfac,false);this.box(g,0,.17,0,28,.08,3,0xd8cfac,false);for(let i=0;i<6;i++){const xx=(i%2?8:-8),zz=(Math.floor(i/2)-1)*9;this.cylinder(g,xx,0,zz,.45,3,0x7b7154);const crown=new THREE.Mesh(this.geometry.sphere,this.mat(0x668b4e));crown.position.set(xx,5,zz);crown.scale.set(3.7,4.7,3.7);g.add(crown);}this.cylinder(g,0,.3,0,3.7,.5,0xc5d1c0);this.cylinder(g,0,.8,0,2.8,.1,0x76aab4);
  }else if(key==='shelter'){
   this.box(g,0,0,0,22,5,21,0x9aa99a);this.box(g,0,5,0,23,1,22,0x79927a);this.box(g,0,0,11,5,4,.3,0x4e6667);this.box(g,0,3,11.3,2.5,.4,.2,0xbdd9bd);
  }else {
   this.box(g,0,0,0,22,1,22,0x899a81);this.cylinder(g,0,1,0,7,1,0x697f6c);const turret=new THREE.Group();turret.position.y=2;g.add(turret);g.userData.turret=turret;this.box(turret,0,0,0,8,4,10,0x758975);
   if(key==='gun'){for(const xx of [-2,2]){const barrel=this.box(turret,xx,4,-6,1,1,12,0x56695b);barrel.rotation.x=-.5;}this.box(turret,0,4,2,4,2,3,0x91a68e);}
   if(key==='sam'){const rack=new THREE.Group();rack.position.set(0,5,0);rack.rotation.x=-.65;turret.add(rack);for(const xx of [-3,0,3])this.box(rack,xx,0,0,2,2,15,0x879a78);}
   if(key==='shield'){this.cylinder(turret,0,4,0,.8,13,0xb7c1a9);const dish=new THREE.Mesh(new THREE.SphereGeometry(6,16,10,0,Math.PI*2,0,Math.PI*.4),this.mat(0xc3cdb8,.4));dish.position.set(0,16,0);dish.rotation.x=Math.PI*.3;turret.add(dish);}
  }
  return g;
 }
 sync(state){
  const first=!this.state;this.state=state;state.placements??=[];state.roads??=[];
  if(first){Object.keys(CENTERS).forEach((id,i)=>this.createCity(id,i));for(const id of Object.keys(CENTERS))this.batchCityBuildings(id);this.batchRoads();}
  for(const c of [...state.cities,...state.enemies]){
   const city=this.cityGroups.get(c.id);if(!city)continue;
   const el=this.labels.querySelector(`[data-city="${c.id}"]`);el.querySelector('span').textContent=c.name;el.querySelector('small').textContent=`${Math.round(c.hp)}%`;el.classList.toggle('dead',c.hp<=0);
   if(!this.battle)this.updateDamage(c.id,c.hp,false);
   if(!c.buildings)continue;
   const signature=JSON.stringify(c.buildings);if(city.signature!==signature){city.signature=signature;for(const g of city.extras){city.group.remove(g);g.traverse(o=>{if(o.userData.extraRecord){const i=this.buildings.indexOf(o.userData.extraRecord);if(i>=0)this.buildings.splice(i,1);}});}city.extras=[];let slot=0;const capital=c.id==='aurora';
    for(const [key,n]of Object.entries(c.buildings)){
     const customCount=state.placements.filter(p=>p.cityId===c.id&&p.key===key).length;
     for(let i=0;i<n-customCount;i++){
      const side=slot%2?1:-1,offset=capital?205:132,xx=side*offset,zz=(Math.floor(slot/2)-3)*39;slot++;const g=this.model(key,xx,zz);city.group.add(g);city.extras.push(g);const record={mesh:g,id:`extra-${c.id}-${key}-${i}`,cityId:c.id,threshold:15+(slot*13)%80,x:CENTERS[c.id][0]+xx,z:CENTERS[c.id][1]+zz,height:20,dead:false,base:true,key};g.userData.extraRecord=record;g.traverse(o=>{if(o.isMesh)o.userData.building=record;});this.buildings.push(record);
     }
    }
   }
  }
  const desired=new Set();for(const p of state.placements){desired.add(p.id);if(!this.customGroups.has(p.id)){const g=this.model(p.key,p.x,p.z);this.scene.add(g);this.customGroups.set(p.id,g);const record={mesh:g,id:p.id,cityId:p.cityId,key:p.key,threshold:30+(p.id*19)%60,x:p.x,z:p.z,height:p.key==='housing'?27:20,dead:false,base:false};g.traverse(o=>{if(o.isMesh)o.userData.building=record;});this.buildings.push(record);}}
  for(const [id,g]of this.customGroups)if(!desired.has(id)){this.scene.remove(g);this.customGroups.delete(id);this.buildings=this.buildings.filter(b=>b.id!==id);}
  for(const g of this.scaffolds||[])this.scene.remove(g);this.scaffolds=[];for(const q of state.queue)if(q.position){const g=new THREE.Group();g.position.set(q.position.x,0,q.position.z);const size=BUILD_SIZE[q.key]||25;this.box(g,0,.1,0,size+3,.2,size+3,0xc6b584,false);for(let x=-size/2;x<=size/2;x+=size)for(let z=-size/2;z<=size/2;z+=size)this.box(g,x,0,z,.55,16,.55,0xd4ae65);for(let y=4;y<=16;y+=6){this.box(g,0,y,-size/2,size,.4,.4,0xd4ae65);this.box(g,0,y,size/2,size,.4,.4,0xd4ae65);}this.box(g,size/2+4,0,0,1.3,40,1.3,0xe6b661);this.box(g,size/2+4,38,8,1,1,38,0xe6b661);this.scene.add(g);this.scaffolds.push(g);}
  const roadSig=JSON.stringify(state.roads);if(this.roadSig!==roadSig){for(const g of this.playerRoads||[])this.roadGroup.remove(g);this.playerRoads=state.roads.map(r=>this.road(r.a,r.b,9,false,true));this.roadSig=roadSig;this.batchRoads();this.updateTerrainGeometry();}
  if(!this.battle)for(const c of state.cities)this.updateDamage(c.id,c.hp,false);this.renderer.shadowMap.needsUpdate=true;this.needsRender=true;
 }
 updateDamage(cityId,hp,animate=true){let bursts=0,changed=false;for(const b of this.buildings.filter(b=>b.cityId===cityId)){const dead=hp<b.threshold;if(dead===b.dead)continue;changed=true;b.dead=dead;if(dead){if(animate){this.animations.push({type:'collapse',b,t:0,duration:1.2,originalScale:b.mesh.scale.clone()});if(bursts++<3)this.explosion(b.x,5,b.z,6);}else {b.mesh.scale.y=.08;b.mesh.rotation.z=.1;b.mesh.position.y=-.1;}}else {b.mesh.scale.y=1;b.mesh.rotation.z=0;b.mesh.position.y=0;}this.updateInstances(b);}if(changed)this.renderer.shadowMap.needsUpdate=true;}
 mount(parent){parent.append(this.root);this.resize();}
 resize(){const w=this.root.clientWidth||innerWidth,h=this.root.clientHeight||innerHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);this.needsRender=true;}
 focus(id,far=false){const pos=CENTERS[id];if(!pos)return;const capital=id==='aurora'||id==='vesper',dist=far?700:capital?420:290;this.cameraMove={from:this.camera.position.clone(),to:new THREE.Vector3(pos[0]+dist*.72,dist*.6,pos[1]+dist*.86),targetFrom:this.controls.target.clone(),targetTo:new THREE.Vector3(pos[0],12,pos[1]),t:0};this.selected=id;for(const e of this.labels.children)e.classList.toggle('selected',e.dataset.city===id);}
 setTool(key){this.tool=key;this.roadStart=null;this.ghost.visible=false;this.grid.visible=!!key&&key!=='bulldoze';this.controls.mouseButtons.LEFT=key?null:THREE.MOUSE.PAN;if(this.roadPreview){this.scene.remove(this.roadPreview);this.roadPreview=null;}this.renderer.domElement.style.cursor=key==='bulldoze'?'crosshair':key?'copy':'grab';}
 groundPoint(e){const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);const p=new THREE.Vector3();return this.raycaster.ray.intersectPlane(this.groundPlane,p)?p:null;}
 nearest(x,z,own=true){const ids=own?ownIds:Object.keys(CENTERS);let best=null,d=Infinity;for(const id of ids){const p=CENTERS[id],dd=Math.hypot(p[0]-x,p[1]-z);if(dd<d){d=dd;best=id;}}return {id:best,distance:d};}
 placementValid(x,z){
  const near=this.nearest(x,z);if(near.distance>450)return {ok:false,reason:'Слишком далеко от городов Альты'};if(Math.abs(x-this.riverX(z))<RIVER.exclusion||this.height(x,z)>2)return {ok:false,reason:'Нужен ровный участок суши'};
  if(this.buildings.some(b=>Math.hypot(b.x-x,b.z-z)<(b.base?18:26)))return {ok:false,reason:'Участок занят зданием'};
  if(this.nativeRoads.some(r=>segmentDistance({x,z},r.a,r.b)<9)||this.state.roads.some(r=>segmentDistance({x,z},r.a,r.b)<9))return {ok:false,reason:'Оставьте проезд свободным'};
  const roadDistance=Math.min(...this.nativeRoads.map(r=>segmentDistance({x,z},r.a,r.b)),...this.state.roads.map(r=>segmentDistance({x,z},r.a,r.b)));
  if(roadDistance>70)return {ok:false,reason:'Подведите дорогу: не дальше 70 ед.'};
  return {ok:true,cityId:near.id};
 }
 roadValid(a,b){
  const length=Math.hypot(b.x-a.x,b.z-a.z);if(length<12||length>700)return {ok:false,reason:'Длина участка дороги: от 12 до 700 ед.'};
  for(let t=0;t<=1;t+=1/Math.ceil(length/15)){const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;if(Math.abs(x-this.riverX(z))<RIVER.exclusion||this.height(x,z)>3||this.nearest(x,z).distance>650)return {ok:false,reason:'Выберите ровный участок на территории Альты.'};}
  if(this.buildings.some(c=>segmentDistance({x:c.x,z:c.z},a,b)<14))return {ok:false,reason:'Дорога проходит через здание. Выберите свободный коридор.'};return {ok:true};
 }
 move(e){
  if(!this.tool||this.tool==='bulldoze')return;const p=this.groundPoint(e);if(!p)return;const x=Math.round(p.x/20)*20,z=Math.round(p.z/20)*20;this.hover={x,z};
  this.grid.position.set(x,.23,z);this.ghost.visible=true;this.ghost.position.set(x,.5,z);const valid=this.tool==='road'?(Math.abs(x-this.riverX(z))>RIVER.exclusion&&this.height(x,z)<3):this.placementValid(x,z).ok;this.ghostMaterial.color.setHex(valid?0x8ee2b0:0xf29b7d);this.ghost.scale.set(this.tool==='road'?.45:1,this.tool==='road'?.05:1,this.tool==='road'?.45:1);
  if(this.tool==='road'&&this.roadStart){if(this.roadPreview)this.scene.remove(this.roadPreview);const pts=[new THREE.Vector3(this.roadStart.x,.6,this.roadStart.z),new THREE.Vector3(x,.6,z)];this.roadPreview=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xd8edb8}));this.scene.add(this.roadPreview);}
 }
 click(e){
  const d=this.pointerDown;if(!d||d.button!==0||Math.hypot(e.clientX-d.x,e.clientY-d.y)>5)return;const p=this.groundPoint(e);if(!p)return;
  if(this.tool==='road'){const point={x:Math.round(p.x/20)*20,z:Math.round(p.z/20)*20};if(Math.abs(point.x-this.riverX(point.z))<RIVER.exclusion||this.height(point.x,point.z)>3){this.options.onError('Дороги строятся на ровной суше.');return;}if(!this.roadStart){this.roadStart=point;this.options.onHint?.('Выберите конец дороги. Правый клик — отмена.');}else {const valid=this.roadValid(this.roadStart,point);if(!valid.ok){this.options.onError(valid.reason);return;}if(this.options.onRoad(this.roadStart,point))this.roadStart=point;}return;}
  if(this.tool&&this.tool!=='bulldoze'){const x=Math.round(p.x/20)*20,z=Math.round(p.z/20)*20,valid=this.placementValid(x,z);if(!valid.ok){this.options.onError(valid.reason);return;}this.options.onBuild(this.tool,valid.cityId,x,z);return;}
  const hit=this.raycaster.intersectObjects([...this.cityGroups.values()].map(c=>c.group).concat([...this.customGroups.values()]),true).find(h=>h.object.userData.building||h.object.userData.records?.[h.instanceId]);
  if(hit){const b=hit.object.userData.building||hit.object.userData.records[hit.instanceId];if(this.tool==='bulldoze'){this.options.onDemolish(b.id);return;}this.options.onSelect(b.cityId,b);return;}
  if(this.tool==='bulldoze')return;const near=this.nearest(p.x,p.z,false);if(near.distance<230)this.options.onSelect(near.id);
 }
 setLayer(key){this.layer=key;this.coverageGroup&&this.scene.remove(this.coverageGroup);this.coverageGroup=new THREE.Group();this.scene.add(this.coverageGroup);if(key==='defense'){for(const c of this.state.cities){const p=CENTERS[c.id],radius=80+c.buildings.gun*20+c.buildings.sam*45+c.buildings.shield*50;const m=new THREE.Mesh(new THREE.RingGeometry(radius-1,radius,80),new THREE.MeshBasicMaterial({color:0x95e2bf,transparent:true,opacity:.6,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.position.set(p[0],.5,p[1]);this.coverageGroup.add(m);const sphere=new THREE.Mesh(new THREE.SphereGeometry(radius,32,16,0,Math.PI*2,0,Math.PI/2),new THREE.MeshBasicMaterial({color:0x87d4c4,transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false}));sphere.position.set(p[0],0,p[1]);this.coverageGroup.add(sphere);}}}
 setNight(night){this.night=night;this.scene.background=night?new THREE.Color(0x132b42):this.sky;this.scene.fog.color.set(night?0x1a3345:0xb7cccf);this.ambient.intensity=night?.6:2.1;this.sun.intensity=night?.35:3.4;this.sun.color.set(night?0xadcdf7:0xffe5bf);this.renderer.toneMappingExposure=night?1.3:1.15;for(const name of ['cream','white','brick','glass','blue']){this.materials[name].emissive.set(night?0xb7ac79:0x000000);this.materials[name].emissiveIntensity=night?.13:0;}this.water.material.color.set(night?0x24495e:0x5d9fa7);this.renderer.shadowMap.needsUpdate=true;}
 setQuality(low){this.quality=low?'low':'high';this.renderer.setPixelRatio(low?1:Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=!low;this.clouds.forEach(g=>g.visible=!low);this.resize();}
 makeAircraft(key,side){const g=new THREE.Group(),col=side==='enemy'?0x4c5c5c:0xe2dfcb;if(key==='scout'){this.box(g,0,0,0,2,.65,3,col,false);for(const x of [-2.7,2.7])for(const z of [-2.5,2.5]){this.box(g,x/2,.1,z/2,Math.abs(x),.18,.25,col,false);const rotor=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.5,.08,12),new THREE.MeshBasicMaterial({color:0xcbd6cc,transparent:true,opacity:.45}));rotor.position.set(x,.3,z);g.add(rotor);}}else if(key==='bomber'){this.box(g,0,0,0,2,1,9,col,false);this.box(g,0,.2,0,12,.3,2.3,col,false);}else {this.box(g,0,0,0,1.3,1.3,12,0xd9dcc9,false);this.box(g,0,0,3,5,.25,2,col,false);}const light=new THREE.Mesh(this.geometry.sphere,new THREE.MeshBasicMaterial({color:side==='enemy'?0xff7f51:0x7affb8}));light.scale.set(.45,.45,.45);light.position.z=-2;g.add(light);return g;}
 playReport(report,state){
  if(!report.flights.length){this.sync(state);return;}
  this.battle=true;this.battleTime=0;this.battleStart=performance.now();this.battleReport=report;this.battleState=state;this.flights=[];
  report.flights.forEach((f,wave)=>{const target=CENTERS[f.to],source=CENTERS[f.from],random=rng(report.day*178+wave*271),keys=f.units?Object.entries(f.units).flatMap(([k,n])=>Array(n).fill(k)):Array(f.count).fill(f.key||'scout');for(let i=0;i<Math.min(f.count,16);i++){
   const key=keys[i]||'scout',destination=new THREE.Vector3(target[0]+(random()-.5)*100,8,target[1]+(random()-.5)*100),origin=new THREE.Vector3(source[0]+(random()-.5)*100,180+random()*85,source[1]+(random()-.5)*100),mid=origin.clone().lerp(destination,.5);mid.y=key==='ballistic'?520:key==='cruise'?130:230;
   const curve=new THREE.QuadraticBezierCurve3(origin,mid,destination),g=this.makeAircraft(key,f.side);g.position.copy(origin);this.scene.add(g);const path=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(50)),new THREE.LineBasicMaterial({color:f.side==='enemy'?0xff9d6e:0xa4f2d1,transparent:true,opacity:.14}));this.scene.add(path);this.flights.push({g,path,curve,f,delay:wave*1+i*.14,duration:5.4+random()*1.2,intercept:i>=f.hits,done:false,fired:false,target:destination});
  }});
  const danger=report.flights.find(f=>f.side==='enemy');if(danger)this.focus(danger.to,true);this.options.onBattle?.(true);
 }
 explosion(x,y,z,size=10){
  if(this.particles.length>110)return;
  const flash=new THREE.Mesh(this.geometry.sphere,new THREE.MeshBasicMaterial({color:0xffcc75,transparent:true,opacity:.95}));flash.position.set(x,y,z);this.scene.add(flash);this.particles.push({mesh:flash,life:.5,max:.5,flash:true,size});
  const random=rng(Math.floor(x*100+z*43+this.frame));for(let i=0;i<12;i++){const mat=this.mat([0x626257,0xa9987b,0xdbac69,0xff9e49][i%4]),m=new THREE.Mesh(this.geometry.box,mat);m.position.set(x,y,z);const scale=1+random()*2.8;m.scale.set(scale,scale,scale);this.scene.add(m);this.particles.push({mesh:m,life:1+random()*1.2,max:2,velocity:new THREE.Vector3((random()-.5)*size*3,random()*size*2+8,(random()-.5)*size*3)});}
  this.addSmoke(x,y,z,size*1.7,8);
 }
 addSmoke(x,y,z,size=15,duration=5){if(this.smokes.length>20)return;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:this.smokeTexture,color:0x5e615e,transparent:true,opacity:.55,depthWrite:false}));s.position.set(x,y,z);s.scale.set(size,size,1);this.scene.add(s);this.smokes.push({sprite:s,life:duration,max:duration,size});}
 fireInterceptor(f){const target=f.curve.getPoint(.55),[x,z]=CENTERS[f.f.to],battery=this.buildings.find(b=>b.cityId===f.f.to&&!b.dead&&['gun','sam','shield'].includes(b.key)),from=new THREE.Vector3(battery?.x??x+35,5,battery?.z??z-25),g=new THREE.Mesh(new THREE.ConeGeometry(.7,5,6),new THREE.MeshBasicMaterial({color:0xeaffdc}));g.position.copy(from);this.scene.add(g);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([from,target]),new THREE.LineBasicMaterial({color:0xb9ffbc,transparent:true,opacity:.65}));this.scene.add(line);this.animations.push({type:'interceptor',mesh:g,line,from,to:target,t:0,duration:.7});}
 resetEffects(){for(const f of this.flights)this.scene.remove(f.g,f.path);for(const a of this.animations){if(a.mesh)this.scene.remove(a.mesh);if(a.line)this.scene.remove(a.line);}for(const p of this.particles)this.scene.remove(p.mesh);for(const s of this.smokes)this.scene.remove(s.sprite);this.flights=[];this.animations=[];this.particles=[];this.smokes=[];this.battle=false;this.battleReport=null;this.roadStart=null;}
 animate(){
  requestAnimationFrame(()=>this.animate());const now=performance.now(),elapsed=(now-this.last)/1000,dt=Math.min(.2,elapsed);this.last=now;this.frame++;
  if(!this.root.isConnected||document.hidden){if(this.battle)this.battleStart+=elapsed*1000;return;}
  if((this.overlay||document.querySelector('dialog[open]'))&&!this.battle&&!this.cameraMove){if(this.needsRender){this.updateLabels();this.renderer.render(this.scene,this.camera);this.needsRender=false;}return;}
  if(this.cameraMove){const m=this.cameraMove;m.t+=dt;const t=Math.min(1,m.t/1.3),v=1-Math.pow(1-t,3);this.camera.position.lerpVectors(m.from,m.to,v);this.controls.target.lerpVectors(m.targetFrom,m.targetTo,v);if(t>=1)this.cameraMove=null;}
  const motion=new THREE.Vector3();if(!document.querySelector('dialog[open]')){if(this.pressed.has('KeyW')||this.pressed.has('ArrowUp'))motion.z-=1;if(this.pressed.has('KeyS')||this.pressed.has('ArrowDown'))motion.z+=1;if(this.pressed.has('KeyA')||this.pressed.has('ArrowLeft'))motion.x-=1;if(this.pressed.has('KeyD')||this.pressed.has('ArrowRight'))motion.x+=1;}
  if(motion.lengthSq()){const angle=Math.atan2(this.camera.position.x-this.controls.target.x,this.camera.position.z-this.controls.target.z);motion.applyAxisAngle(new THREE.Vector3(0,1,0),angle).multiplyScalar(dt*this.camera.position.distanceTo(this.controls.target)*.5);this.controls.target.add(motion);this.camera.position.add(motion);}
  this.controls.update();
  for(const car of this.cars){car.t=(car.t+dt*car.speed)%1;const {a,b,bridge}=car.r;car.g.position.set(a.x+(b.x-a.x)*car.t+2,(bridge?ROAD.bridgeElevation:0)+ROAD.asphaltBase+ROAD.asphaltThickness+.08,a.z+(b.z-a.z)*car.t+2);car.g.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);}
  if(this.frame%3===0){for(const cloud of this.clouds)cloud.position.x+=dt*1.2;for(const b of this.buildings)if(b.mesh.userData.turret&&!b.dead)b.mesh.userData.turret.rotation.y=now*.00012;}
  if(this.battle){this.battleTime=(now-this.battleStart)/1000;for(const f of this.flights){const t=(this.battleTime-f.delay)/f.duration;if(t<0||f.done)continue;if(f.intercept&&t>.42&&!f.fired){this.fireInterceptor(f);f.fired=true;}if(t>=(f.intercept?.58:1)){f.done=true;const p=f.curve.getPoint(Math.min(1,t));this.explosion(p.x,f.intercept?p.y:5,p.z,f.intercept?4:11);this.scene.remove(f.g,f.path);if(!f.intercept){const city=this.battleState.cities.find(c=>c.id===f.f.to)||this.battleState.enemies.find(c=>c.id===f.f.to);this.updateDamage(city.id,city.hp,true);}continue;}const p=f.curve.getPoint(t);f.g.position.copy(p);f.g.lookAt(f.curve.getPoint(Math.min(1,t+.01)));}
   if(this.flights.every(f=>f.done)&&this.battleTime>7){this.battle=false;this.sync(this.battleState);this.options.onBattle?.(false);}
  }
  this.animations=this.animations.filter(a=>{a.t+=dt;const t=Math.min(1,a.t/a.duration);if(a.type==='collapse'){a.b.mesh.scale.y=Math.max(.08,1-t*t);a.b.mesh.rotation.z=Math.sin(t*2)*.12;a.b.mesh.position.y=-t*.2;this.updateInstances(a.b);if(t>=1){a.b.mesh.rotation.z=.1;this.renderer.shadowMap.needsUpdate=true;return false;}}else {a.mesh.position.lerpVectors(a.from,a.to,t);a.mesh.lookAt(a.to);a.mesh.rotateX(Math.PI/2);if(t>=1){this.scene.remove(a.mesh,a.line);a.line.geometry.dispose();return false;}}return true;});
  this.particles=this.particles.filter(p=>{p.life-=dt;if(p.flash){const t=1-p.life/p.max;p.mesh.scale.setScalar(p.size*(.3+t));p.mesh.material.opacity=Math.max(0,(1-t)*.9);}else{p.velocity.y-=30*dt;p.mesh.position.addScaledVector(p.velocity,dt);p.mesh.rotation.x+=dt*2;p.mesh.rotation.z+=dt*1.3;if(p.mesh.position.y<.5){p.mesh.position.y=.5;p.velocity.set(0,0,0);}}if(p.life<=0){this.scene.remove(p.mesh);if(p.flash)p.mesh.material.dispose();return false;}return true;});
  this.smokes=this.smokes.filter(s=>{s.life-=dt;s.sprite.position.y+=dt*5;s.sprite.position.x+=dt*1.8;const t=1-s.life/s.max;s.sprite.scale.setScalar(s.size*(1+t*2));s.sprite.material.opacity=Math.max(0,.6*(1-t));if(s.life<=0){this.scene.remove(s.sprite);s.sprite.material.dispose();return false;}return true;});
  if(this.frame%3===0)this.updateLabels();this.renderer.render(this.scene,this.camera);
 }
 updateLabels(){const w=this.root.clientWidth,h=this.root.clientHeight;for(const el of this.labels.children){const [x,z]=CENTERS[el.dataset.city],p=new THREE.Vector3(x,el.dataset.city==='aurora'?120:70,z).project(this.camera),distance=this.camera.position.distanceTo(new THREE.Vector3(x,0,z));const visible=p.z<1&&p.z>-1&&Math.abs(p.x)<1.2&&Math.abs(p.y)<1.2&&distance<1700;el.style.display=visible?'flex':'none';if(visible)el.style.transform=`translate(${(p.x+1)*w/2}px,${(-p.y+1)*h/2}px) translate(-50%,-100%)`;}}
 diagnostics(){return {webgl:this.renderer.capabilities.isWebGL2,buildings:this.buildings.length,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,battle:this.battle,custom:this.customGroups.size,roads:this.state?.roads.length,quality:this.quality,camera:this.camera.position.toArray()};}
}
