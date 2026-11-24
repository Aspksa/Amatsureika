import {layout, valid, clamp, polar, TAU, type Mode, type Point} from "./geometry.js";
const NS="http://www.w3.org/2000/svg";
const byId=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const svg=document.getElementById("brain") as unknown as SVGSVGElement;
const group=(id:string)=>document.getElementById(id) as unknown as SVGGElement;
const world=group("world"), nodes=group("nodes"), links=group("links"), cells=group("cells"), labels=group("labels"), orbits=group("orbits");
function el<K extends keyof SVGElementTagNameMap>(tag:K, attrs:Record<string,string|number>={}, parent?:Element):SVGElementTagNameMap[K]{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent?.append(e);return e}
const names=Array.from({length:21},(_,i)=>"C"+(i+1));
const palette=["#77d9c7","#93b8ee","#9aa7f0","#c3a6e9","#8cdbb2","#e0ba88","#a8c8d9"];
type Item={e:SVGElement;cluster:number;index:number;outer:boolean;from:Point;to:Point;now:Point};
const items:Item[]=[];
const counts=names.map((_,i)=>i===16?176: i===0?88: 24+(i*17)%67);
let mode:Mode="radial", selected=-1, zoom=1, tx=0,ty=0, speed=1, density=.5, paused=matchMedia("(prefers-reduced-motion: reduce)").matches;
let frame=0, start=0, moving=false, quality=1, slowFrames=0, fastFrames=0, lastFrame=0;
let flight:{z:number;x:number;y:number;fromZ:number;fromX:number;fromY:number;begin:number}|null=null;
let cameraTimer:number|undefined,cameraRevision=0,cameraLoaded=false;
let cameraChain=Promise.resolve();
const edges:{a:number;b:number;combined:boolean}[]=[];
let previous=-1;
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
const defaults={speed:1,glow:65,density:50,depth:65,texture:35,motion:75,textMotion:60};
type Effects=typeof defaults;
let effects:Effects={...defaults};
let saveTimer:number|undefined, saveChain=Promise.resolve(), revision=0;
function motionOff(){return paused||reduced.matches||effects.motion===0}
const legend=byId("legend"), detail=byId("detail");
let geometry=layout(counts,mode);
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function position(item:Item){return geometry.point(item.cluster,item.index,item.outer)}
function transform(item:Item,p:Point){item.now=valid(p)?p:position(item);if(!valid(item.now))item.now={x:0,y:0}}
function fitZoom(){return Math.min(1,485/geometry.radius)}
function color(i:number){return palette[i%palette.length]}
const glyphs=["M0 -5 4 -2 4 2 0 5 -4 2 -4 -2Z M0 -2v4 M-2 0h4","M-4 -4h8v8h-8Z M-2 -1h4 M-2 2h3","M-4 3 -1 -3 1 1 4 -4 M-4 3h8","M0 -5 5 0 0 5 -5 0Z M0 -2v4","M0 4C-7 0 -4 -5 0 -2 4 -5 7 0 0 4Z","M-4 -3h8 M-4 0h8 M-4 3h5","M-5 -3 0 -5 5 -3 0 0Z M-5 0 0 3 5 0 M-5 3 0 5 5 3","M0 -5 4 3 0 1 -4 3Z","M-5 -2 0 -5 5 -2 0 1Z M-3 0v3l3 2 3-2V0","M-4 0 -1 3 4 -3","M-4 4V0 M0 4v-8 M4 4v-5","M-3 -5h4l3 3v7h-7Z M1 -5v3h3","M-3 -3 3 3 M-3 3 3 -3 M-4 -4h2v2h-2Z M2 2h2v2H2Z","M-4 -1 1 -5 5 -1 0 4 -4 4Z","M-5 0Q0 -6 5 0Q0 6 -5 0Z M0 -2v4","M-5 -4h10v7H0l-3 2V3h-2Z","M-4 4 0 0 4 -4 M0 -4h4v4","M-4 -4h3 M-4 -4v3 M4 4H1 M4 4V1 M0 -2v4","M-5 4 0 -1 M0 -1 2 -4 5 -5 4 -2 1 0Z","M-4 -4h8v8h-8Z M-4 0h8 M0 -4v8","M0 -5 4 -3 4 3 0 5 -4 3 -4 -3Z M-2 0h4"];
function add(i:number,outer:boolean,n:number){let e:SVGElement;if(outer){e=el("g",{class:"satellite",color:color(i)});el("circle",{class:"satellite-shell",r:9},e);el("path",{class:"satellite-glyph",d:glyphs[i]},e);const title=el("title",{},e);title.textContent=nodeId(i,n,outer)}else{const hot=(n*13+i*7)%23===0;e=el("circle",{r:hot?3.1:1.35,class:"dot"+(hot?" hot":""),color:color(i)});if(hot)e.style.animationDelay=-(n%9)*.38+"s";e.classList.add("depth-"+(n%3))}e.setAttribute("data-node",nodeId(i,n,outer));e.addEventListener("click",()=>select(i));e.addEventListener("dblclick",ev=>{ev.stopPropagation();focusCluster(i)});const item:Item={e,cluster:i,index:n,outer,from:{x:0,y:0},to:{x:0,y:0},now:{x:0,y:0}};item.to=position(item);item.from=item.to;transform(item,item.to);items.push(item)}
names.forEach((name,i)=>{for(let n=0;n<counts[i];n++){add(i,false,n)}for(let n=0;n<7+(i%4);n++)add(i,true,n);const b=document.createElement("button");b.className="legend-row";b.style.setProperty("--c",color(i));const sw=document.createElement("i"),title=document.createElement("span"),count=document.createElement("span");title.textContent=name;count.textContent=String(counts[i]);b.append(sw,title,count);b.onclick=()=>select(i);b.ondblclick=()=>focusCluster(i);legend.append(b)});
function refreshStats(){byId("stats").textContent=items.length+" УЗЛОВ · "+names.length+" КЛАСТЕРОВ";Array.from(legend.children).forEach((b,i)=>{const n=b.lastElementChild;if(n)n.textContent=String(counts[i])})}
refreshStats();
function polygon(c:Point,r:number){return Array.from({length:6},(_,j)=>{const p=polar(r,j*TAU/6);return (c.x+p.x)+","+(c.y+p.y)}).join(" ")}
function decorate(){
 svg.dataset.mode=mode;
 for(const g of [orbits,labels,links,cells])g.replaceChildren();
 for(const r of geometry.orbits)el("circle",{r,class:"orbit"},orbits);
 names.forEach((_,i)=>{
  const c=geometry.centers[i],r=geometry.radii[i];
  if(mode==="hex"){const h=el("polygon",{points:polygon(c,r),class:"hex-cell cluster-shape",color:color(i)},cells);h.onclick=()=>select(i)}
  const first=mode==="radial"?geometry.point(i,counts[i]-1,false):{x:0,y:0};
  const end=mode==="radial"?geometry.point(i,2,true):c;
  const path=`M${first.x} ${first.y} L${end.x} ${end.y}`;el("path",{d:path,class:"spoke",style:"opacity:"+density*(mode==="radial"?.24:.55)},links);
  if(i%2===0&&!motionOff()&&quality>=.5){const dot=el("circle",{r:1.8,class:"particle"},links);el("animateMotion",{path,dur:(4+i%5)/speed+"s",begin:-(i%7)+"s",repeatCount:"indefinite"},dot)}
 });
 if(selected>=0){const c=geometry.centers[selected];for(let i=0;i<names.length;i++)if(i!==selected){const p=geometry.centers[i];el("path",{d:`M${c.x} ${c.y} Q0 0 ${p.x} ${p.y}`,fill:"none",color:color(selected),class:"selected-link"},links)}}
 drawEdges();if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations();
}
function select(i:number){if(selected>=0&&selected!==i)previous=selected;selected=i===selected?-1:i;Array.from(legend.children).forEach((b,j)=>b.classList.toggle("selected",j===selected));for(const item of items){item.e.classList.toggle("chosen",item.cluster===selected);item.e.style.opacity=selected<0||item.cluster===selected?"":"0.22"}requestFrame();detail.textContent=selected<0?"Выберите кластер или точку на карте.":names[selected]+" · "+counts[selected]+" демонстрационных точек. Подсвечены связи к другим кластерам.";decorate()}
function requestFrame(){if(!frame)frame=requestAnimationFrame(renderFrame)}
function renderFrame(now:number){
 frame=0;
 if(lastFrame&&(moving||flight)){const dt=now-lastFrame;if(dt>24){slowFrames++;fastFrames=0}else{fastFrames++;slowFrames=0}if(slowFrames>=8){quality=Math.max(.25,quality-.25);slowFrames=0}if(fastFrames>=40){quality=Math.min(1,quality+.25);fastFrames=0}}
 lastFrame=now;
 if(moving){const p=motionOff()?1:Math.min(1,(now-start)/700),e=p*p*(3-2*p);for(const it of items)transform(it,mix(it.from,it.to,e));moving=p<1}
 if(flight){const f=flight,p=motionOff()?1:Math.min(1,(now-f.begin)/650),e=p*p*(3-2*p);zoom=Math.exp(Math.log(f.fromZ)+(Math.log(f.z)-Math.log(f.fromZ))*e);tx=f.fromX+(f.x-f.fromX)*e;ty=f.fromY+(f.y-f.fromY)*e;if(p===1){flight=null;saveCamera()}}
 zoom=clamp(zoom,.025,64,fitZoom());tx=clamp(tx,-1e6,1e6);ty=clamp(ty,-1e6,1e6);
 world.setAttribute("transform",`translate(${tx} ${ty}) scale(${zoom})`);byId("reset").textContent=Math.round(zoom*100)+"%";
 const level=zoom<.45?"overview":zoom<1.6?"normal":zoom<5?"near":"detail";svg.dataset.lod=level;svg.dataset.quality=String(quality);
 const stride=level==="overview"?Math.max(2,Math.ceil(4/quality)):Math.ceil(1/quality);
 const fragment=document.createDocumentFragment();
 const view=svg.viewBox.baseVal, margin=30;
 for(const it of items){
  if(!valid(it.now)){transform(it,position(it))}
  const x=it.now.x*zoom+tx,y=it.now.y*zoom+ty;
  const visible=x>=view.x-margin&&x<=view.x+view.width+margin&&y>=view.y-margin&&y<=view.y+view.height+margin&&(it.outer||it.cluster===selected||it.index%stride===0);
  if(visible){it.e.setAttribute("transform",`translate(${it.now.x.toFixed(2)} ${it.now.y.toFixed(2)})`);if(!it.e.isConnected)fragment.append(it.e);it.e.classList.toggle("fine-dot",!it.outer&&level==="detail")}else if(it.e.parentNode===nodes)it.e.remove();
 }
 nodes.append(fragment);
 if(moving||flight){requestFrame()}else lastFrame=0;
}
function relayout(){geometry=layout(counts,mode);for(const it of items){it.from=valid(it.now)?it.now:position(it);it.to=position(it)}start=performance.now();moving=true;decorate();requestFrame()}
function setMode(m:Mode){if(m===mode)return;mode=m;flight=null;document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===m));relayout();animateCamera(fitZoom(),0,0)}
function camera(){requestFrame()}
function zoomAt(factor:number,x=0,y=0){flight=null;const next=clamp(zoom*factor,.025,64,zoom);tx=x-(x-tx)*next/zoom;ty=y-(y-ty)*next/zoom;zoom=next;camera();saveCamera()}
function coords(x:number,y:number):Point{const matrix=svg.getScreenCTM();if(!matrix)return{x:0,y:0};const p=new DOMPoint(x,y).matrixTransform(matrix.inverse());return{x:p.x,y:p.y}}
svg.addEventListener("wheel",e=>{e.preventDefault();const p=coords(e.clientX,e.clientY);zoomAt(Math.exp(-e.deltaY*.0015),p.x,p.y)},{passive:false});
let drag:{id:number;point:Point;tx:number;ty:number;moved:boolean}|null=null;
svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;flight=null;cameraRevision++;drag={id:e.pointerId,point:coords(e.clientX,e.clientY),tx,ty,moved:false}});
svg.addEventListener("pointermove",e=>{if(!drag||drag.id!==e.pointerId)return;const p=coords(e.clientX,e.clientY),dx=p.x-drag.point.x,dy=p.y-drag.point.y;if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;svg.setPointerCapture(e.pointerId);svg.classList.add("dragging");tx=drag.tx+dx;ty=drag.ty+dy;camera()});
function stop(){if(drag?.moved)saveCamera();drag=null;svg.classList.remove("dragging")}svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);
const reset=()=>animateCamera(fitZoom(),0,0);byId("reset").onclick=reset;byId("minus").onclick=()=>zoomAt(.8);byId("plus").onclick=()=>zoomAt(1.25);group("core").addEventListener("click",()=>{reset();if(selected>=0)select(selected)});group("core").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();reset();if(selected>=0)select(selected)}});
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
function applyPause(){document.body.classList.toggle("paused",motionOff());byId("pause").textContent=paused?"Продолжить анимацию":"Пауза анимации";if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations();requestFrame()}
byId("pause").onclick=()=>{paused=!paused;decorate();applyPause()};
const panel=byId("panel"),toggle=byId("panelToggle");panel.hidden=true;toggle.setAttribute("aria-expanded","false");toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute("aria-expanded",String(!panel.hidden))};decorate();applyEffects(false);zoom=fitZoom();camera();void loadDesign();void loadCamera();

function animateCamera(z:number,x:number,y:number){cameraRevision++;flight={z:clamp(z,.025,64,fitZoom()),x:clamp(x,-1e6,1e6),y:clamp(y,-1e6,1e6),fromZ:zoom,fromX:tx,fromY:ty,begin:performance.now()};requestFrame()}
function anchor(i:number){return geometry.centers[i]}
function focusCluster(i:number){if(selected!==i)select(i);const p=anchor(i),z=Math.min(3,Math.max(.4,200/geometry.radii[i]));animateCamera(z,-p.x*z,-p.y*z)}
function grow(i:number){
 if(items.length>=10000||counts[i]>=1000){detail.textContent="Достигнут предел демонстрационной карты.";return false}
 const old=fitZoom();counts[i]++;geometry=layout(counts,mode);add(i,false,counts[i]-1);
 const it=items[items.length-1];transform(it,anchor(i));if(!motionOff()){it.e.classList.add("born");window.setTimeout(()=>it.e.classList.remove("born"),1400)}
 refreshStats();relayout();if(Math.abs(zoom-old)<.01)animateCamera(fitZoom(),0,0);return true
}
function nodeId(i:number,n:number,outer:boolean){return (outer?"S":"N")+(i+1)+"-"+(n+1)}
function saveCamera(){
 cameraRevision++;if(!cameraLoaded)return;window.clearTimeout(cameraTimer);
 cameraTimer=window.setTimeout(()=>{const value={zoom,tx,ty,mode};cameraChain=cameraChain.then(async()=>{try{const r=await fetch("/api/camera",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),keepalive:true});if(!r.ok)throw Error("camera")}catch{byId("cameraStatus").textContent="Камера: сохранение недоступно"}})},220);
}
async function loadCamera(){
 const rev=cameraRevision;
 try{const r=await fetch("/api/camera",{cache:"no-store"});if(!r.ok)throw Error("camera");const c=await r.json();if(rev!==cameraRevision)return;if(c.mode==="hex"||c.mode==="radial"||c.mode==="compact"){mode=c.mode;geometry=layout(counts,mode);for(const it of items){it.to=position(it);transform(it,it.to)}document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));zoom=clamp(c.zoom,.025,64,fitZoom());tx=clamp(c.tx,-1e6,1e6);ty=clamp(c.ty,-1e6,1e6);decorate();requestFrame()}}
 catch{byId("cameraStatus").textContent="Камера: стандартное положение"}
 finally{cameraLoaded=true;if(rev!==cameraRevision)saveCamera()}
}
function drawEdges(){
 for(const edge of edges){const a=anchor(edge.a),b=anchor(edge.b);const path="M"+a.x+" "+a.y+" Q0 0 "+b.x+" "+b.y;el("path",{d:path,class:"memory-edge"+(edge.combined?" combined":""),fill:"none",color:color(edge.a)},links);
 if(edge.combined&&!paused&&!reduced.matches&&effects.motion>0){const p=el("circle",{r:3,class:"particle"},links);el("animateMotion",{path,dur:"2.4s",repeatCount:"indefinite"},p)}
 }
}
function pair(combined:boolean){
 const a=previous,b=selected;if(a<0||b<0||a===b){detail.textContent="Выберите последовательно два разных кластера.";return false}
 const existing=edges.find(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a));
 if(existing&&(!combined||existing.combined)){detail.textContent="Эта связь уже существует.";return false}
 if(combined&&!grow(b))return false;
 if(existing)existing.combined=true;else edges.push({a,b,combined});
 decorate();detail.textContent=combined?"Создан производный демонстрационный узел; исходные узлы сохранены.":"Добавлена демонстрационная связь.";return true
}
byId("grow").onclick=()=>{if(selected<0){detail.textContent="Сначала выберите кластер.";return}if(grow(selected))detail.textContent=names[selected]+": добавлен демонстрационный узел."};
byId("connect").onclick=()=>pair(false);
byId("combine").onclick=()=>pair(true);
const chat=byId("chat"),chatToggle=byId("chatToggle"),messages=byId("messages"),chatPrompt=byId<HTMLInputElement>("prompt");
if(matchMedia("(max-width:720px)").matches){chat.hidden=true;chatToggle.setAttribute("aria-expanded","false")}
chatToggle.onclick=()=>{chat.hidden=!chat.hidden;chatToggle.setAttribute("aria-expanded",String(!chat.hidden));if(!chat.hidden)chatPrompt.focus()};
function message(text:string,kind:string){const p=document.createElement("p");p.className=kind;p.textContent=text;messages.append(p);while(messages.children.length>100)messages.firstElementChild?.remove();messages.scrollTop=messages.scrollHeight}
byId<HTMLFormElement>("chatForm").onsubmit=e=>{e.preventDefault();const raw=chatPrompt.value.trim();if(!raw)return;chatPrompt.value="";message(raw,"user-message");const cmd=raw.toLocaleLowerCase("ru").replace(/[.!?]+$/,"");let reply="Я пока работаю в локальном демонстрационном режиме. Доступны команды: кольца, соты, ядро, рост, связи, объединить.";
 if(cmd==="кольца"||cmd==="соты"||cmd==="ядро"){setMode(cmd==="кольца"?"radial":cmd==="соты"?"hex":"compact");reply="Режим карты изменён."}
 else if(cmd==="рост"){reply=selected>=0&&grow(selected)?"Добавлен демонстрационный узел.":"Выберите кластер или проверьте предел карты."}
 else if(cmd==="связи"||cmd==="объединить"){reply=pair(cmd==="объединить")?"Демонстрационная операция выполнена.":"Выберите два разных кластера без повторной операции."}
 message(reply,"reply");};

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
