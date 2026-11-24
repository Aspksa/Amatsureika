import {setupWorkspace} from "./workspace.js";
import {runQuietFlow, particleAt, PARTICLES, type Leg} from "./flow.js";
import {ClusterIndex, directedBlockLayout, functionalOrbit, documentPoint, valid, clamp, polar, TAU, type Mode, type Point} from "./geometry.js";
const NS="http://www.w3.org/2000/svg";
const byId=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const svg=document.getElementById("brain") as unknown as SVGSVGElement;
const group=(id:string)=>document.getElementById(id) as unknown as SVGGElement;
const world=group("world"), nodes=group("nodes"), links=group("links"), cells=group("cells"), labels=group("labels"), orbits=group("orbits");
function el<K extends keyof SVGElementTagNameMap>(tag:K, attrs:Record<string,string|number>={}, parent?:Element):SVGElementTagNameMap[K]{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent?.append(e);return e}
const names:string[]=[];
const palette=["#77d9c7","#93b8ee","#9aa7f0","#c3a6e9","#8cdbb2","#e0ba88","#a8c8d9"];
type Item={e:SVGElement;cluster:number;index:number;outer:boolean;from:Point;to:Point;now:Point};
const items:Item[]=[];
const visibleItems=new Map<string,Item>();
const summaries=new Map<number,SVGPathElement>();
const pendingClusters=new Set<number>();
let renderKey="",mapRevision=0;
const key=(i:number,n:number,outer:boolean)=>i+":"+n+":"+outer;
const counts:number[]=[];
type ChatCluster={id:number;previous_id:number|null;count:number};
type ChatMessage={id:number;cluster_id:number;position:number;role:"user"|"assistant";text:string};
type Snapshot={clusters:ChatCluster[];messages:ChatMessage[];duplicate?:boolean};
let clusters:ChatCluster[]=[];
type Endpoint=()=>Point;
type FlowLeg={from:Endpoint;to:Endpoint;begin:number;speed:number;dots:SVGCircleElement[];line:SVGLineElement;resolve:()=>void};
const flowLegs=new Set<FlowLeg>();
const arrivalTimers=new Map<SVGElement,number>();
let mode:Mode="radial", selected=-1, zoom=1, tx=0,ty=0, speed=1, density=.5, paused=matchMedia("(prefers-reduced-motion: reduce)").matches;
let frame=0, start=0, moving=false, quality=1, slowFrames=0, fastFrames=0, lastFrame=0;
let flight:{z:number;x:number;y:number;fromZ:number;fromX:number;fromY:number;begin:number}|null=null;
let cameraTimer:number|undefined,cameraRevision=0,cameraLoaded=false;
let cameraChain=Promise.resolve();


const reduced=matchMedia("(prefers-reduced-motion: reduce)");
const defaults={speed:1,glow:65,density:50,depth:65,texture:35,motion:75,textMotion:60};
type Effects=typeof defaults;
let effects:Effects={...defaults};
let saveTimer:number|undefined, saveChain=Promise.resolve(), revision=0;
function motionOff(){return paused||reduced.matches||effects.motion===0}
const legend=byId("legend"), detail=byId("detail");
let geometry=directedBlockLayout(counts.length,mode),spatial=new ClusterIndex(geometry.centers);
function reindex(){spatial=new ClusterIndex(geometry.centers);mapRevision++;renderKey=""}
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function position(item:Item){return geometry.point(item.cluster,item.index,item.outer)}
function transform(item:Item,p:Point){item.now=valid(p)?p:position(item);if(!valid(item.now))item.now={x:0,y:0}}
type MapFile={id:number;name:string;size:number};
type WorkspaceMap={files:MapFile[];work:Record<string,number>};
let workspaceMap:WorkspaceMap={files:[],work:{}},filePoints:Point[]=[],fileSpatial=new ClusterIndex([]),fileNodes=new Map<number,SVGCircleElement>();
let mapOuter=geometry.outer,orbitPoints:Point[]=[],oldCenters:Point[]|null=null,oldOrbit:Point[]|null=null,oldSpatial:ClusterIndex|null=null,oldFilePoints:Point[]|null=null;
let transition=1,workspaceRevision=0,hoverTarget:{kind:"memory"|"file"|"module";index:number;id?:string}|null=null;
const moduleList=()=>Array.from(group("functional-orbit").querySelectorAll<SVGGElement>(".functional-icon"));
function prepareLayout(animate=false){
 if(animate&&!motionOff()){
  oldCenters=geometry.centers.map((p,i)=>oldCenters?.[i]?mix(oldCenters[i],p,transition):p);
  oldSpatial=new ClusterIndex(oldCenters);
  oldOrbit=orbitPoints.map((p,i)=>oldOrbit?.[i]?mix(oldOrbit[i],p,transition):p);
  oldFilePoints=filePoints.map((p,i)=>oldFilePoints?.[i]?mix(oldFilePoints[i],p,transition):p);
  transition=0;moving=true;start=performance.now();
 }else{oldCenters=null;oldOrbit=null;oldSpatial=null;oldFilePoints=null;transition=1;moving=false}
 geometry=directedBlockLayout(counts.length,mode);reindex();
 filePoints=workspaceMap.files.map((_,i)=>documentPoint(i,geometry.edge??180));
 fileSpatial=new ClusterIndex(filePoints);
 const edge=filePoints.reduce((r,p)=>Math.max(r,Math.hypot(p.x,p.y)+14),geometry.edge??180);
 mapOuter=Math.max(geometry.outer,edge+72);orbitPoints=functionalOrbit(moduleList().length,mapOuter);
}
function fitZoom(){
 const radius=orbitPoints.reduce((r,p)=>Math.max(r,Math.hypot(p.x,p.y)+45),mapOuter+58);
 return Math.max(.025,Math.min(1,490/radius))
}
function fitOffset(){return 0}
function memoryPoint(i:number):Point{const p=geometry.centers[i];return oldCenters?.[i]?mix(oldCenters[i],p,transition):p}
function filePoint(i:number):Point{const p=filePoints[i];return oldFilePoints?.[i]?mix(oldFilePoints[i],p,transition):p}
function updateOrbit(){
 moduleList().forEach((icon,i)=>{const dest=orbitPoints[i];if(!dest)return;const p=oldOrbit?.[i]?mix(oldOrbit[i],dest,transition):dest;icon.setAttribute("transform",`translate(${p.x} ${p.y})`)});
}
function hover(kind:"memory"|"file"|"module",index:number,id?:string){hoverTarget={kind,index,id};requestFrame()}
function unhover(){hoverTarget=null;requestFrame()}
function highlightFrame(){
 links.replaceChildren();labels.replaceChildren();
 if(zoom>=1.6){for(const item of items){const p=item.now;const label=el("text",{x:p.x+9,y:p.y+3,class:"detail-label","font-size":Math.max(2,10/zoom)},labels);label.textContent=String(counts[item.cluster])+"/500"}}
 const h=hoverTarget;if(!h)return;
 let p:Point|undefined;
 if(h.kind==="memory"&&geometry.centers[h.index])p=memoryPoint(h.index);
 if(h.kind==="file"&&filePoints[h.index])p=filePoint(h.index);
 if(h.kind==="module"){const icon=moduleList().find(x=>x.id===h.id);if(icon){const m=icon.transform.baseVal.consolidate()?.matrix;if(m)p={x:m.e,y:m.f}}}
 if(!p)return;
 const color=h.kind==="memory"?"#77d9c7":h.kind==="file"?"#b8a5e6":"#8db8d8";
 el("line",{x1:0,y1:0,x2:p.x,y2:p.y,class:"hover-link",stroke:color},links);
 if(h.kind==="memory"&&h.index>0){const prev=memoryPoint(h.index-1);el("line",{x1:prev.x,y1:prev.y,x2:p.x,y2:p.y,class:"hover-link",stroke:color},links)}
 if(h.kind==="file"){const icon=moduleList().find(x=>x.id==="docsIcon"),m=icon?.transform.baseVal.consolidate()?.matrix;if(m)el("line",{x1:m.e,y1:m.f,x2:p.x,y2:p.y,class:"hover-link",stroke:color},links)}
}
async function refreshWorkspaceMap(){
 const rev=++workspaceRevision;
 try{
  const response=await fetch("/api/workspace/map",{cache:"no-store"});if(!response.ok)throw Error("map");
  const data:WorkspaceMap=await response.json();if(rev!==workspaceRevision)return;
  const priorFit=fitZoom(),changed=JSON.stringify(workspaceMap.files)!==JSON.stringify(data.files);
  workspaceMap=data;byId("documentCount").textContent=data.files.length+" файлов";byId("workCount").textContent=Object.values(data.work).reduce((a,b)=>a+b,0)+" записей";
  if(changed){hoverTarget=null;prepareLayout();decorate();if(Math.abs(zoom-priorFit)<.03){zoom=fitZoom();tx=0;ty=0}}
  requestFrame();
 }catch{if(rev===workspaceRevision){byId("documentCount").textContent="Данные недоступны";byId("workCount").textContent="Данные недоступны"}}
}
function color(i:number){return palette[Math.floor(i/4)%palette.length]}
const glyphs=["M0 -5 4 -2 4 2 0 5 -4 2 -4 -2Z M0 -2v4 M-2 0h4","M-4 -4h8v8h-8Z M-2 -1h4 M-2 2h3","M-4 3 -1 -3 1 1 4 -4 M-4 3h8","M0 -5 5 0 0 5 -5 0Z M0 -2v4","M0 4C-7 0 -4 -5 0 -2 4 -5 7 0 0 4Z","M-4 -3h8 M-4 0h8 M-4 3h5","M-5 -3 0 -5 5 -3 0 0Z M-5 0 0 3 5 0 M-5 3 0 5 5 3","M0 -5 4 3 0 1 -4 3Z","M-5 -2 0 -5 5 -2 0 1Z M-3 0v3l3 2 3-2V0","M-4 0 -1 3 4 -3","M-4 4V0 M0 4v-8 M4 4v-5","M-3 -5h4l3 3v7h-7Z M1 -5v3h3","M-3 -3 3 3 M-3 3 3 -3 M-4 -4h2v2h-2Z M2 2h2v2H2Z","M-4 -1 1 -5 5 -1 0 4 -4 4Z","M-5 0Q0 -6 5 0Q0 6 -5 0Z M0 -2v4","M-5 -4h10v7H0l-3 2V3h-2Z","M-4 4 0 0 4 -4 M0 -4h4v4","M-4 -4h3 M-4 -4v3 M4 4H1 M4 4V1 M0 -2v4","M-5 4 0 -1 M0 -1 2 -4 5 -5 4 -2 1 0Z","M-4 -4h8v8h-8Z M-4 0h8 M0 -4v8","M0 -5 4 -3 4 3 0 5 -4 3 -4 -3Z M-2 0h4"];
function add(i:number,outer:boolean,n:number){
 const e=el("circle",{r:5,class:"memory-block",color:color(i),tabindex:0,role:"button","aria-label":"Блок памяти "+(i+1)});
 e.setAttribute("data-node",nodeId(i,n,outer));e.addEventListener("pointerenter",()=>hover("memory",i));e.addEventListener("pointerleave",unhover);e.addEventListener("focus",()=>hover("memory",i));e.addEventListener("blur",unhover);e.addEventListener("click",()=>select(i));e.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();select(i)}});e.addEventListener("dblclick",ev=>{ev.stopPropagation();focusCluster(i)});
 const item:Item={e,cluster:i,index:n,outer,from:{x:0,y:0},to:{x:0,y:0},now:{x:0,y:0}};item.to=position(item);item.from=item.to;transform(item,item.to);items.push(item);visibleItems.set(key(i,n,outer),item);return item
}
function refreshStats(){byId("stats").textContent=counts.reduce((a,b)=>a+b,0)+" СООБЩЕНИЙ · "+names.length+" БЛОКОВ";Array.from(legend.children).forEach((b,i)=>{const n=b.lastElementChild;if(n)n.textContent=counts[i]+" / 500"})}
refreshStats();
function polygon(c:Point,r:number){return Array.from({length:6},(_,j)=>{const p=polar(r,j*TAU/6);return (c.x+p.x)+","+(c.y+p.y)}).join(" ")}
function decorate(){
 svg.dataset.mode=mode;
 for(const g of [orbits,labels,links,cells])g.replaceChildren();
 for(const r of [116,148,mapOuter-28,mapOuter])el("circle",{r,class:"orbit"},orbits);
 updateOrbit();
 if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations();
}
function select(i:number){
 renderKey="";
 if(busy||!ready)return;
 selected=i===selected?-1:i;Array.from(legend.children).forEach((b,j)=>b.classList.toggle("selected",j===selected));
 for(const item of items){item.e.classList.toggle("chosen",item.cluster===selected);item.e.style.opacity=selected<0||item.cluster===selected?"":"0.22"}
 detail.textContent=selected<0?"Выберите кластер или точку.":names[selected]+" · "+counts[selected]+" / 500 сообщений";
 requestFrame();void openHistory(selected);
}
function requestFrame(){if(!frame)frame=requestAnimationFrame(renderFrame)}
function renderFrame(now:number){
 frame=0;
 if(lastFrame&&(moving||flight)){const dt=now-lastFrame;if(dt>24){slowFrames++;fastFrames=0}else{fastFrames++;slowFrames=0}if(slowFrames>=8){quality=Math.max(.25,quality-.25);slowFrames=0}if(fastFrames>=40){quality=Math.min(1,quality+.25);fastFrames=0}}
 lastFrame=now;
 if(moving){const p=motionOff()?1:Math.min(1,(now-start)/700);transition=p*p*(3-2*p);moving=p<1;if(!moving){oldCenters=null;oldOrbit=null;oldSpatial=null;oldFilePoints=null}}
 if(flight){const f=flight,p=motionOff()?1:Math.min(1,(now-f.begin)/650),e=p*p*(3-2*p);zoom=Math.exp(Math.log(f.fromZ)+(Math.log(f.z)-Math.log(f.fromZ))*e);tx=f.fromX+(f.x-f.fromX)*e;ty=f.fromY+(f.y-f.fromY)*e;if(p===1){flight=null;saveCamera()}}
 zoom=clamp(zoom,.025,64,fitZoom());tx=clamp(tx,-1e6,1e6);ty=clamp(ty,-1e6,1e6);
 world.setAttribute("transform",`translate(${tx} ${ty}) scale(${zoom})`);byId("reset").textContent=Math.round(zoom*100)+"%";
 const level=zoom<.45?"overview":zoom<1.6?"normal":zoom<5?"near":"detail";svg.dataset.lod=level;svg.dataset.quality=String(quality);
 renderVisible(level);renderFiles(level);updateOrbit();highlightFrame();
 updateFlow(now);
 if(moving||flight||flowLegs.size){requestFrame()}else lastFrame=0;
}
function renderVisible(level:string){
 const view=svg.viewBox.baseVal, margin=50;
 const signature=[mapRevision,zoom,tx,ty,view.width,view.height,level,quality,selected,transition].join(":");
 if(signature===renderKey)return;renderKey=signature;
 const bounds:[number,number,number,number]=[(view.x-margin-tx)/zoom,(view.y-margin-ty)/zoom,(view.x+view.width+margin-tx)/zoom,(view.y+view.height+margin-ty)/zoom];
 const candidates=Array.from(new Set([...spatial.query(...bounds),...(oldSpatial?.query(...bounds)??[])]));
 const wanted=new Set<string>(),fragment=document.createDocumentFragment();
 for(const i of candidates){
  const k=key(i,0,false);wanted.add(k);const it=visibleItems.get(k)||add(i,false,0),p=memoryPoint(i);
  it.now=p;it.e.setAttribute("transform",`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
  it.e.setAttribute("r",String(Math.min(12,Math.max(3.5,2.4/zoom))));
  it.e.classList.toggle("near-detail",level==="near"||level==="detail");
  it.e.setAttribute("aria-label","Блок "+(i+1)+": "+counts[i]+" из 500 сообщений");
  it.e.classList.toggle("archive",counts[i]===500);it.e.classList.toggle("chosen",selected===i);
  it.e.classList.toggle("pending-memory",pendingClusters.has(i));it.e.classList.toggle("active-block",i===counts.length-1&&counts[i]<500);
  it.e.style.setProperty("--fill-level",String(counts[i]/500));it.e.style.opacity=selected>=0&&selected!==i?".26":"";
  it.e.setAttribute("aria-label","Блок "+(i+1)+": "+counts[i]+" из 500 сообщений");
  if(!it.e.firstElementChild)el("title",{},it.e);it.e.firstElementChild!.textContent="Блок "+(i+1)+" · "+counts[i]+"/500";
  if(!it.e.isConnected)fragment.append(it.e);
 }
 for(const [k,it] of visibleItems)if(!wanted.has(k)){it.e.remove();visibleItems.delete(k)}
 items.splice(0,items.length,...visibleItems.values());nodes.append(fragment);
 svg.dataset.visibleNodes=String(visibleItems.size);
}
let fileRenderKey="";
function renderFiles(level:string){
 const view=svg.viewBox.baseVal,sig=[mapRevision,zoom,tx,ty,view.width,view.height,transition,level].join(":");
 if(sig===fileRenderKey)return;fileRenderKey=sig;
 const candidates=fileSpatial.query((view.x-70-tx)/zoom,(view.y-70-ty)/zoom,(view.x+view.width+70-tx)/zoom,(view.y+view.height+70-ty)/zoom);
 const wanted=new Set<number>(),layer=group("fileNodes"),fragment=document.createDocumentFragment();
 for(const i of candidates){
  const file=workspaceMap.files[i],p=filePoint(i);wanted.add(file.id);let dot=fileNodes.get(file.id);
  if(!dot){
   dot=el("circle",{class:"document-dot",r:5,tabindex:0,role:"button"});fileNodes.set(file.id,dot);
   const focus=()=>{const at=workspaceMap.files.findIndex(f=>f.id===file.id);if(at>=0)hover("file",at)};
   const open=()=>{const f=workspaceMap.files.find(x=>x.id===file.id);if(f)byId<HTMLAnchorElement>("fileDownload").href="/api/disk/download?id="+f.id;if(f){byId("fileDetailName").textContent=f.name;byId("fileDetailSize").textContent=(f.size/1024).toLocaleString("ru",{maximumFractionDigits:1})+" КБ";byId<HTMLDialogElement>("fileDetail").showModal()}};
   dot.addEventListener("pointerenter",focus);dot.addEventListener("pointerleave",unhover);dot.addEventListener("focus",focus);dot.addEventListener("blur",unhover);
   dot.addEventListener("click",open);dot.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
   el("title",{},dot);fragment.append(dot);
  }
  dot.setAttribute("transform",`translate(${p.x} ${p.y})`);dot.setAttribute("r",String(Math.min(10,Math.max(3.5,2.1/zoom))));
  dot.setAttribute("aria-label",file.name);dot.firstElementChild!.textContent=file.name;
 }
 for(const [id,dot] of fileNodes)if(!wanted.has(id)){dot.remove();fileNodes.delete(id)}
 layer.append(fragment);
}
function relayout(){prepareLayout(true);decorate();requestFrame()}
function setMode(m:Mode){if(m===mode)return;mode=m;flight=null;document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===m));relayout();animateCamera(fitZoom(),0,fitOffset())}
function camera(){requestFrame()}
function zoomAt(factor:number,x=0,y=0){flight=null;const next=clamp(zoom*factor,.025,64,zoom);tx=x-(x-tx)*next/zoom;ty=y-(y-ty)*next/zoom;zoom=next;camera();saveCamera()}
function coords(x:number,y:number):Point{const matrix=svg.getScreenCTM();if(!matrix)return{x:0,y:0};const p=new DOMPoint(x,y).matrixTransform(matrix.inverse());return{x:p.x,y:p.y}}
svg.addEventListener("wheel",e=>{e.preventDefault();const p=coords(e.clientX,e.clientY);zoomAt(Math.exp(-e.deltaY*.0015),p.x,p.y)},{passive:false});
let drag:{id:number;point:Point;tx:number;ty:number;moved:boolean}|null=null;
svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;flight=null;cameraRevision++;drag={id:e.pointerId,point:coords(e.clientX,e.clientY),tx,ty,moved:false}});
svg.addEventListener("pointermove",e=>{if(!drag||drag.id!==e.pointerId)return;const p=coords(e.clientX,e.clientY),dx=p.x-drag.point.x,dy=p.y-drag.point.y;if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;svg.setPointerCapture(e.pointerId);svg.classList.add("dragging");tx=drag.tx+dx;ty=drag.ty+dy;camera()});
function stop(){if(drag?.moved)saveCamera();drag=null;svg.classList.remove("dragging")}svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);
const reset=()=>animateCamera(fitZoom(),0,fitOffset());byId("reset").onclick=reset;byId("minus").onclick=()=>zoomAt(.8);byId("plus").onclick=()=>zoomAt(1.25);group("core").addEventListener("click",()=>{reset();if(selected>=0)select(selected)});group("core").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();reset();if(selected>=0)select(selected)}});
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.onclick=()=>setMode(b.dataset.mode as Mode));
function applyEffects(redraw=true){
 const root=document.documentElement.style;speed=effects.speed;density=effects.density/100;
 root.setProperty("--duration",4/speed+"s");
 for(const key of ["glow","depth","texture","motion"] as const)root.setProperty("--"+key,String(effects[key]/100));
 root.setProperty("--text-duration",Math.round(effects.textMotion*6)+"ms");
 for(const key of Object.keys(defaults) as (keyof Effects)[]){byId<HTMLInputElement>(key).value=String(effects[key]);const out=document.getElementById(key+"Out");if(out)out.textContent=key==="speed"?effects.speed.toFixed(2)+"×":effects[key]+"%";}
 if(redraw)decorate();applyPause();
}
function scheduleSave(){
 revision++;const current=revision;
 byId("saveState").textContent="Сохранение…";window.clearTimeout(saveTimer);
 saveTimer=window.setTimeout(()=>{const snapshot={...effects};saveChain=saveChain.then(async()=>{
 try{const response=await fetch("/api/design",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(snapshot),keepalive:true});if(!response.ok)throw Error("save failed");if(current===revision)byId("saveState").textContent="Сохранено на диске";}
 catch{if(current===revision)byId("saveState").textContent="Не удалось сохранить. Проверьте локальный сервер.";}
 });},180);
}
for(const key of Object.keys(defaults) as (keyof Effects)[]){byId<HTMLInputElement>(key).oninput=e=>{effects[key]=Number((e.target as HTMLInputElement).value);applyEffects(key==="speed"||key==="density"||key==="motion");scheduleSave();};}
byId("restoreDesign").onclick=()=>{effects={...defaults};applyEffects();scheduleSave();};
async function loadDesign(){
 const initial=revision;
 try{const r=await fetch("/api/design",{cache:"no-store"});if(!r.ok)throw Error("load failed");const data=await r.json();if(revision!==initial)return;
 for(const key of Object.keys(defaults) as (keyof Effects)[]){const n=data[key];if(typeof n==="number"&&Number.isFinite(n))effects[key]=key==="speed"?Math.max(.25,Math.min(2,n)):Math.max(0,Math.min(100,n));}
 applyEffects();byId("saveState").textContent="Настройки восстановлены";}
 catch{if(revision===initial)byId("saveState").textContent="Настройки недоступны; используются стандартные.";}
}
reduced.addEventListener("change",()=>{decorate();applyPause()});
function applyPause(){if(motionOff())clearFlow();document.body.classList.toggle("paused",motionOff());byId("pause").textContent=paused?"Продолжить анимацию":"Пауза анимации";if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations();requestFrame()}
byId("pause").onclick=()=>{paused=!paused;decorate();applyPause()};
const panel=byId("panel"),toggle=byId("panelToggle");panel.hidden=true;toggle.setAttribute("aria-expanded","false");toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute("aria-expanded",String(!panel.hidden))};decorate();applyEffects(false);zoom=fitZoom();camera();void loadDesign();

function animateCamera(z:number,x:number,y:number){cameraRevision++;flight={z:clamp(z,.025,64,fitZoom()),x:clamp(x,-1e6,1e6),y:clamp(y,-1e6,1e6),fromZ:zoom,fromX:tx,fromY:ty,begin:performance.now()};requestFrame()}
function anchor(i:number){return geometry.centers[i]}
function focusCluster(i:number){if(selected!==i)select(i);const p=anchor(i),z=Math.min(3,Math.max(.4,200/geometry.radii[i]));animateCamera(z,-p.x*z,-p.y*z)}
function nodeId(i:number,n:number,outer:boolean){return "B"+(i+1)}
function saveCamera(){
 cameraRevision++;if(!cameraLoaded)return;window.clearTimeout(cameraTimer);
 cameraTimer=window.setTimeout(()=>{const value={zoom,tx,ty,mode};cameraChain=cameraChain.then(async()=>{try{const r=await fetch("/api/camera",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),keepalive:true});if(!r.ok)throw Error("camera")}catch{byId("cameraStatus").textContent="Камера: сохранение недоступно"}})},220);
}
async function loadCamera(){
 const rev=cameraRevision;
 try{const r=await fetch("/api/camera",{cache:"no-store"});if(!r.ok)throw Error("camera");const c=await r.json();if(rev!==cameraRevision)return;if(c.mode==="hex"||c.mode==="radial"||c.mode==="compact"){mode=c.mode;prepareLayout();for(const it of items){it.to=position(it);transform(it,it.to)}document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));zoom=clamp(c.zoom,.025,64,fitZoom());tx=clamp(c.tx,-1e6,1e6);ty=clamp(c.ty,-1e6,1e6);decorate();requestFrame()}}
 catch{byId("cameraStatus").textContent="Камера: стандартное положение"}
 finally{cameraLoaded=true;if(rev!==cameraRevision)saveCamera()}
}
function drawEdges(){
 for(let i=1;i<clusters.length;i++){const j=i-1;const a=geometry.point(j,0,true),b=geometry.point(i,0,true);el("path",{d:`M${a.x} ${a.y} L${b.x} ${b.y}`,class:"continuation-link",fill:"none",color:color(j)},links)}
}
const chat=byId("chat"),chatToggle=byId("chatToggle"),messages=byId("messages"),chatPrompt=byId<HTMLInputElement>("prompt"),chatStatus=byId("chatStatus"),historyTitle=byId("historyTitle"),liveButton=byId("liveChat"),form=byId<HTMLFormElement>("chatForm"),sendButton=form.querySelector("button") as HTMLButtonElement;
let busy=false,historyRevision=0,ready=false;
let pending:{text:string;request_id:string;cloud:boolean}|null=null;
chatToggle.onclick=()=>{chat.hidden=!chat.hidden;chatToggle.setAttribute("aria-expanded",String(!chat.hidden));if(!chat.hidden)chatPrompt.focus();requestFrame()};
function syncMap(next:ChatCluster[]){
 if(next.some((c,i)=>!Number.isSafeInteger(c.id)||!Number.isInteger(c.count)||c.count<1||c.count>500||c.previous_id!==(i?next[i-1].id:null)||i<next.length-1&&c.count!==500))throw Error("Invalid cluster state");
 if(next.length<clusters.length||clusters.some((c,i)=>next[i].id!==c.id||next[i].count<c.count))return;
 const oldFit=fitZoom(),oldLength=clusters.length,changed=next.length!==oldLength||next.some((c,i)=>c.count!==counts[i]);
 if(!changed)return;
 clusters=next;names.splice(0,names.length,...next.map(c=>"B"+c.id));counts.splice(0,counts.length,...next.map(c=>c.count));prepareLayout();
 for(let i=0;i<clusters.length;i++){
  const c=clusters[i];let b=legend.children[i] as HTMLButtonElement|undefined;
  if(!b){b=document.createElement("button");b.className="legend-row";b.style.setProperty("--c",color(i));const sw=document.createElement("i"),title=document.createElement("span"),count=document.createElement("span");title.textContent="Блок "+c.id;b.append(sw,title,count);b.onclick=()=>select(i);b.ondblclick=()=>focusCluster(i);legend.append(b)}
  b.classList.toggle("selected",selected===i);b.lastElementChild!.textContent=c.count+" / 500";
 }
 refreshStats();if(oldLength!==clusters.length)decorate();
 if(oldLength!==clusters.length&&Math.abs(zoom-oldFit)<.03){zoom=fitZoom();tx=0;ty=fitOffset()}requestFrame();
}
function appendMessage(m:ChatMessage){
 if(messages.querySelector('[data-message="'+m.id+'"]'))return;
 const p=document.createElement("p");p.className=m.role==="user"?"user-message":"reply";p.dataset.message=String(m.id);p.textContent=m.text;messages.append(p);while(messages.children.length>500)messages.firstElementChild?.remove();messages.scrollTop=messages.scrollHeight;
}
async function snapshot(cluster?:number):Promise<Snapshot>{const r=await fetch("/api/memory"+(cluster===undefined?"":"?cluster="+cluster),{cache:"no-store"});if(!r.ok)throw Error("history");return r.json()}
async function openHistory(i:number){
 const revision=++historyRevision;chat.hidden=false;chatToggle.setAttribute("aria-expanded","true");
 historyTitle.textContent=i<0?"ТЕКУЩИЙ ДИАЛОГ":"АРХИВ · БЛОК "+clusters[i].id+" · "+counts[i]+"/500";
 liveButton.hidden=i<0;sendButton.disabled=i>=0||busy||!ready;chatPrompt.disabled=i>=0||!ready;
 try{const s=await snapshot(i<0?undefined:clusters[i].id);if(revision!==historyRevision)return;messages.replaceChildren();s.messages.forEach(appendMessage);syncMap(s.clusters);chatStatus.textContent=i<0?"Локальная память · Cloud.ru по запросу":"Архив · для отправки вернитесь в диалог"}
 catch{if(revision===historyRevision)chatStatus.textContent="Не удалось загрузить переписку."}
}
liveButton.onclick=()=>{if(selected>=0)select(selected);else void openHistory(-1)};
function screenPoint(p:Point):Point{const m=world.getScreenCTM();if(!m)return{x:0,y:0};const s=new DOMPoint(p.x,p.y).matrixTransform(m);return{x:s.x,y:s.y}}
function corePoint(){return screenPoint({x:0,y:0})}
function modulePoint(id:string):Point{
 const m=group(id).getScreenCTM();if(!m)return corePoint();
 const p=new DOMPoint(0,0).matrixTransform(m);return{x:p.x,y:p.y};
}
function cloudPoint(){return modulePoint("cloudIcon")}
function chatPoint():Point{const r=chatPrompt.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width*.5,y:r.top+r.height*.5}:corePoint()}
function replyPoint():Point{
 const r=messages.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width*.5,y:r.bottom-18}:chatPoint();
}
function arrival(target:SVGElement|undefined,kind:"request"|"reply"|"memory"|"error"){
 if(!target||motionOff()||document.hidden)return;
 const old=arrivalTimers.get(target);if(old!==undefined)window.clearTimeout(old);
 target.classList.remove("arrived-request","arrived-reply","arrived-memory","arrived-error");
 target.classList.add("arrived-"+kind);
 arrivalTimers.set(target,window.setTimeout(()=>{target.classList.remove("arrived-"+kind);arrivalTimers.delete(target)},550));
}
function finishLeg(leg:FlowLeg){
 if(!flowLegs.delete(leg))return;
 leg.line.remove();leg.dots.forEach(d=>d.remove());leg.resolve();
}
function clearFlow(){
 for(const leg of Array.from(flowLegs))finishLeg(leg);
 for(const [target,timer] of arrivalTimers){window.clearTimeout(timer);target.classList.remove("arrived-request","arrived-reply","arrived-memory","arrived-error")}
 arrivalTimers.clear();pendingClusters.clear();renderKey="";
}
function playLeg(from:Endpoint,to:Endpoint,kind:"request"|"reply"|"memory"|"work"|"docs"):Promise<void>{
 if(motionOff()||document.hidden||flowLegs.size>=12)return Promise.resolve();
 return new Promise(resolve=>{
  const layer=byId("traffic"),cls="quiet-"+kind;
  const line=el("line",{class:"quiet-route "+cls},layer);
  const dots=Array.from({length:PARTICLES},(_,i)=>el("circle",{r:particleAt(0,i,speed).radius,class:"quiet-particle "+cls,opacity:0},layer));
  flowLegs.add({from,to,begin:performance.now(),speed,dots,line,resolve});requestFrame();
 });
}
function updateFlow(now:number){
 if(motionOff()||document.hidden){if(flowLegs.size||pendingClusters.size){clearFlow();requestFrame()}return}
 for(const leg of flowLegs){
  const a=leg.from(),b=leg.to();
  if(![a.x,a.y,b.x,b.y].every(Number.isFinite)){finishLeg(leg);continue}
  leg.line.setAttribute("x1",String(a.x));leg.line.setAttribute("y1",String(a.y));leg.line.setAttribute("x2",String(b.x));leg.line.setAttribute("y2",String(b.y));
  let done=true;
  leg.dots.forEach((dot,i)=>{
   const sample=particleAt(now-leg.begin,i,leg.speed),p=mix(a,b,sample.progress);
   dot.setAttribute("cx",String(p.x));dot.setAttribute("cy",String(p.y));dot.setAttribute("opacity",String(sample.opacity));if(!sample.done)done=false;
  });
  if(done)finishLeg(leg);
 }
}
async function routeLeg(leg:Leg){
 switch(leg){
  case "chat-core":await playLeg(chatPoint,corePoint,"request");arrival(group("core"),"request");break;
  case "core-cloud":await playLeg(corePoint,cloudPoint,"request");arrival(group("cloudIcon"),"request");break;
  case "cloud-core":await playLeg(cloudPoint,corePoint,"reply");arrival(group("core"),"reply");break;
  case "core-chat":await playLeg(corePoint,replyPoint,"reply");break;
 }
}
async function remember(s:Snapshot){
 const ids=Array.from(new Set(s.messages.map(m=>m.cluster_id)));
 await Promise.all(ids.map(async id=>{
  const i=clusters.findIndex(c=>c.id===id);if(i<0)return;
  await playLeg(corePoint,()=>screenPoint(geometry.centers[i]),"memory");
  pendingClusters.delete(i);const item=visibleItems.get(key(i,0,false));
  item?.e.classList.remove("pending-memory");arrival(item?.e,"memory");renderKey="";requestFrame();
 }));
}
form.onsubmit=async e=>{
 e.preventDefault();const raw=chatPrompt.value.trim();if(!raw||busy||!ready||selected>=0)return;
 const paid=byId<HTMLInputElement>("cloudSend").checked;
 if(paid&&!window.confirm("Отправить это сообщение в Cloud.ru? Возможна оплата до 512 выходных токенов плюс входные."))return;
 busy=true;sendButton.disabled=true;chatPrompt.disabled=true;chatStatus.textContent=paid?"Cloud.ru: запрос…":"Сохранение…";
 if(!pending||pending.text!==raw||pending.cloud!==paid)pending={text:raw,request_id:crypto.randomUUID(),cloud:paid};
 const request=pending;
 try{
  await runQuietFlow<Snapshot>(paid,{
   leg:routeLeg,
   waiting:active=>{group("cloudIcon").classList.toggle("cloud-waiting",active);if(active)chatStatus.textContent="Cloud.ru: ожидание ответа…"},
   send:async()=>{
    const r=await fetch("/api/memory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)});
    if(!r.ok){const error=await r.json().catch(()=>({error:"Ошибка сохранения"}));throw Error(error.error||"Ошибка сохранения")}
    return r.json();
   },
   committed:s=>{
    const previousCount=clusters.length;syncMap(s.clusters);pending=null;chatPrompt.value="";byId<HTMLInputElement>("cloudSend").checked=false;
    if(selected<0)s.messages.filter(m=>m.role==="user").forEach(appendMessage);
    if(!s.duplicate&&!motionOff()&&!document.hidden)for(let i=previousCount;i<clusters.length;i++)pendingClusters.add(i);
    renderKey="";requestFrame();
   },
   duplicate:s=>!!s.duplicate,
   deliver:s=>{if(selected<0)s.messages.filter(m=>m.role==="assistant").forEach(appendMessage)},
   remember
  });
  chatStatus.textContent="Сохранено · "+counts.reduce((a,b)=>a+b,0)+" сообщений";
 }catch(error){clearFlow();arrival(group(request.cloud?"cloudIcon":"core"),"error");requestFrame();chatStatus.textContent=request.cloud?"Cloud.ru: "+(error instanceof Error?error.message:"ошибка")+". Автоповтора нет; проверьте расход перед повтором.":"Связь прервана. Повторите отправку — дубликата не будет.";try{const recovered=await snapshot();syncMap(recovered.clusters);if(recovered.messages.some(m=>(m as ChatMessage & {request_id?:string}).request_id===request.request_id)){pending=null;chatPrompt.value="";messages.replaceChildren();recovered.messages.forEach(appendMessage);chatStatus.textContent="Сохранение восстановлено из SQLite"}}catch{/* preserve pending request for retry */}}
 finally{busy=false;sendButton.disabled=selected>=0||!ready;chatPrompt.disabled=selected>=0||!ready;if(!chatPrompt.disabled)chatPrompt.focus()}
};
async function initChat(){
 sendButton.disabled=true;chatPrompt.disabled=true;
 try{const s=await snapshot();syncMap(s.clusters);messages.replaceChildren();s.messages.forEach(appendMessage);ready=true;chatStatus.textContent="Локальная память · Cloud.ru по запросу";await loadCamera()}
 catch{chatStatus.textContent="Не удалось загрузить локальную память. Обновите страницу."}
 finally{sendButton.disabled=!ready;chatPrompt.disabled=!ready}
}
document.addEventListener("visibilitychange",()=>{if(document.hidden)clearFlow();else{renderKey="";requestFrame();void refreshWorkspaceMap();if(ready&&!busy)void snapshot().then(s=>{syncMap(s.clusters);if(selected<0)s.messages.forEach(appendMessage)}).catch(()=>{})}});
void initChat();
async function checkHealth(){try{const r=await fetch("/api/chat/health",{cache:"no-store"});if(!r.ok)throw Error("health");const h=await r.json();byId("memoryHealth").textContent=h.ok?"SQLite: целостность подтверждена · "+h.messages+" сообщений":"SQLite: обнаружена аномалия · "+h.issues.join(", ")}catch{byId("memoryHealth").textContent="Диагностика памяти недоступна"}}
byId("checkMemory").onclick=()=>void checkHealth();void checkHealth();
const searchInput=byId<HTMLInputElement>("mapSearch"),results=byId("searchResults");
function searchMap(){
 const q=searchInput.value.trim().toLocaleLowerCase("ru");results.replaceChildren();if(!q)return;
 const hits:{title:string;cluster:number;item?:Item}[]=names.map((title,cluster)=>({title,cluster})).filter(x=>x.title.toLocaleLowerCase("ru").includes(q));
 for(const item of items){const id=nodeId(item.cluster,item.index,item.outer);if(id.toLowerCase()===q)hits.unshift({title:id+" · "+names[item.cluster],cluster:item.cluster,item});if(hits.length>=12)break}
 for(const hit of hits.slice(0,12)){const b=document.createElement("button");b.textContent=hit.title;b.onclick=()=>{if(hit.item){if(selected!==hit.cluster)select(hit.cluster);const p=position(hit.item);animateCamera(5,-p.x*5,-p.y*5)}else focusCluster(hit.cluster);results.replaceChildren();searchInput.value=hit.title};results.append(b)}
 if(!hits.length)results.textContent="Ничего не найдено";
}
searchInput.addEventListener("input",searchMap);
searchInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();results.querySelector("button")?.click()}if(e.key==="Escape")results.replaceChildren()});
new ResizeObserver(()=>requestFrame()).observe(svg);

type CloudState={has_key:boolean;saved_key:boolean;model:string;verified:boolean;models:string[]};
const cloudDialog=byId<HTMLDialogElement>("cloudDialog"),cloudIcon=group("cloudIcon"),cloudKey=byId<HTMLInputElement>("cloudKey"),cloudModels=byId<HTMLSelectElement>("cloudModels"),cloudStatus=byId("cloudStatus"),cloudSend=byId<HTMLInputElement>("cloudSend");
let cloudBusy=false,cloudState:CloudState|null=null;
function showCloud(s:CloudState){
 cloudState=s;cloudModels.replaceChildren();
 for(const model of s.models){const opt=document.createElement("option");opt.value=model;opt.textContent=model;cloudModels.append(opt)}
 if(s.models.includes(s.model))cloudModels.value=s.model;
 const connected=s.verified&&s.models.includes(s.model);
 cloudIcon.classList.toggle("cloud-connected",connected);cloudSend.disabled=!connected;if(!connected)cloudSend.checked=false;
 byId("cloudSelected").textContent=s.model||"Модель не выбрана";
 cloudStatus.textContent=connected?"Каталог проверен · модель выбрана":s.has_key?"Ключ сохранён локально · загрузите каталог":"Введите API-ключ";
 byId<HTMLButtonElement>("cloudConnect").disabled=!s.verified||!s.models.length||cloudBusy;
 byId<HTMLInputElement>("cloudPersist").checked=s.saved_key;
}
async function cloudAction(path:string,body?:object){
 if(cloudBusy)return;cloudBusy=true;
 for(const id of ["cloudSave","cloudLoad","cloudConnect","cloudRemove"])byId<HTMLButtonElement>(id).disabled=true;
 cloudStatus.textContent="Выполняется…";
 try{const r=await fetch("/api/cloud/"+path,body===undefined?{cache:"no-store"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const s=await r.json();if(!r.ok)throw Error(s.error||"Ошибка Cloud.ru");showCloud(s);if(path==="key")cloudKey.value=""}
 catch(e){cloudStatus.textContent=e instanceof Error?e.message:"Cloud.ru недоступен";if(path==="models"||path==="key"){cloudSend.checked=false;cloudSend.disabled=true;cloudIcon.classList.remove("cloud-connected")}}
 finally{cloudBusy=false;for(const id of ["cloudSave","cloudLoad","cloudRemove"])byId<HTMLButtonElement>(id).disabled=false;byId<HTMLButtonElement>("cloudConnect").disabled=!cloudState?.verified||!cloudState.models.length}
}
function openCloud(){if(!cloudDialog.open)cloudDialog.showModal();void cloudAction("status")}
cloudIcon.addEventListener("click",openCloud);cloudIcon.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openCloud()}});
byId("cloudClose").onclick=()=>cloudDialog.close();
byId("cloudSave").onclick=()=>{if(!cloudKey.value.trim()){cloudStatus.textContent="Введите ключ или используйте кнопку удаления";return}void cloudAction("key",{key:cloudKey.value.trim(),persist:byId<HTMLInputElement>("cloudPersist").checked})};
byId("cloudRemove").onclick=()=>void cloudAction("key",{key:"",persist:false});
byId("cloudLoad").onclick=()=>void cloudAction("models",{});
byId("cloudConnect").onclick=()=>void cloudAction("connect",{model:cloudModels.value});
void cloudAction("status");

function bindOrbit(id:string,open:()=>void){
 const icon=group(id);icon.addEventListener("click",open);icon.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
}
const activityCounts=new Map<string,number>();
async function moduleRequest<T>(id:"workIcon"|"docsIcon",operation:()=>Promise<T>):Promise<T>{
 const icon=group(id),kind=id==="workIcon"?"work":"docs";
 activityCounts.set(id,(activityCounts.get(id)??0)+1);icon.classList.add("module-working");
 try{
  await playLeg(corePoint,()=>modulePoint(id),kind);arrival(icon,"request");
  const result=await operation();
  await playLeg(()=>modulePoint(id),corePoint,kind);arrival(group("core"),"reply");
  void refreshWorkspaceMap();return result;
 }catch(e){arrival(icon,"error");throw e}
 finally{const n=(activityCounts.get(id)??1)-1;activityCounts.set(id,n);if(n===0)icon.classList.remove("module-working")}
}
setupWorkspace(bindOrbit,moduleRequest);
for(const icon of moduleList()){
 const show=()=>hover("module",0,icon.id);
 icon.addEventListener("pointerenter",show);icon.addEventListener("pointerleave",unhover);icon.addEventListener("focus",show);icon.addEventListener("blur",unhover);
}
byId("fileDetailClose").onclick=()=>byId<HTMLDialogElement>("fileDetail").close();
const full=byId("fullMap");
function setFull(on:boolean){document.body.classList.toggle("full-map",on);full.textContent=on?"Выйти из полноэкранного режима":"На весь экран";full.setAttribute("aria-pressed",String(on));requestFrame()}
full.onclick=async()=>{
 const on=!document.body.classList.contains("full-map");setFull(on);
 if(on&&!document.fullscreenElement&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen()}catch{/* map-only fallback */}}
 else if(!on&&document.fullscreenElement){try{await document.exitFullscreen()}catch{/* map-only fallback */}}
};
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement)setFull(false)});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.body.classList.contains("full-map")&&!document.fullscreenElement)setFull(false)});
prepareLayout();decorate();zoom=fitZoom();requestFrame();void refreshWorkspaceMap();
bindOrbit("settingsIcon",()=>{if(panel.hidden)toggle.click();byId("settingsClose").focus()});
byId("settingsClose").onclick=()=>{if(!panel.hidden)toggle.click()};
