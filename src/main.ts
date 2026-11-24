const NS="http://www.w3.org/2000/svg";
const byId=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const svg=document.getElementById("brain") as unknown as SVGSVGElement;
const group=(id:string)=>document.getElementById(id) as unknown as SVGGElement;
const world=group("world"), nodes=group("nodes"), links=group("links"), cells=group("cells"), labels=group("labels"), orbits=group("orbits");
function el<K extends keyof SVGElementTagNameMap>(tag:K, attrs:Record<string,string|number>={}, parent?:Element):SVGElementTagNameMap[K]{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent?.append(e);return e}
const names=["ЯДРО ЛИЧНОСТИ","ДОЛГОВРЕМЕННАЯ ПАМЯТЬ","МЫШЛЕНИЕ","САМОСТЬ","ЭМОЦИИ","БИОГРАФИЯ","ЗНАНИЯ","ЦЕЛИ","ОБУЧЕНИЕ","РЕШЕНИЯ","ОПЫТ","ДОКУМЕНТЫ","СВЯЗИ","НАВЫКИ","РЕФЛЕКСИЯ","ДИАЛОГ","САМОРАЗВИТИЕ","ВНИМАНИЕ","ИНСТРУМЕНТЫ","КОНТЕКСТ","СИСТЕМА"];
const palette=["#4ebfb0","#79a9de","#6c86cf","#a58ad6","#65c4a8","#dda775","#8faebe"];
type Mode="compact"|"radial"|"hex";
type Point={x:number;y:number};
type Item={e:SVGElement;cluster:number;row:number;col:number;outer:boolean;from:Point;to:Point;now:Point};
const items:Item[]=[];
const counts=names.map((_,i)=>i===16?176: i===0?88: 24+(i*17)%67);
let mode:Mode="radial", selected=-1, zoom=1, tx=0,ty=0, speed=1, density=.5, paused=matchMedia("(prefers-reduced-motion: reduce)").matches;
let raf=0, start=0;
const legend=byId("legend"), detail=byId("detail");
const TAU=Math.PI*2;
const angle=(i:number)=>-Math.PI/2+i*TAU/names.length;
const polar=(r:number,a:number):Point=>({x:r*Math.cos(a),y:r*Math.sin(a)});
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const hexCenter=(i:number):Point=>{const ring=i<6?1:2;const j=i<6?i:i-6;return polar(ring*205,-Math.PI/2+j*TAU/(ring===1?6:15))};
function position(item:Item,m:Mode):Point{const {cluster:i,row,col,outer}=item;const a=angle(i);if(m==="hex"){const c=hexCenter(i);return {x:c.x+(col-4)*9+(row%2)*4.5,y:c.y+(row-5)*9}}if(m==="compact"){return outer?polar(180+row*15,a+(col-2)*.045):polar(55+row*8,a+(col-4)*.027)}if(outer)return polar(474+row*22,a+(col-2)*.042);return polar(156+row*8.6,a+(col-4)*.025)}
function transform(item:Item,p:Point){item.now=p;item.e.setAttribute("transform","translate("+p.x.toFixed(2)+" "+p.y.toFixed(2)+")")}
function color(i:number){return palette[i%palette.length]}
const glyphs=["M-4 -3h8v6h-8z M-2 0h4","M-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M0 -2v4","M-4 4v-8h8v8 M-2 -1h4","M-4 3v-5 M0 3v-8 M4 3v-3","M-4 -3l4 4 4 -4 M0 1v4"];
function add(i:number,row:number,col:number,outer:boolean,n:number){let e:SVGElement;if(outer){e=el("g",{class:"satellite",color:color(i)},nodes);el("circle",{r:9},e);el("path",{d:glyphs[n%glyphs.length]},e)}else{const hot=(n*13+i*7)%23===0;e=el("circle",{r:hot?3.5:1.8,class:"dot"+(hot?" hot":""),color:color(i)},nodes);if(hot)e.style.animationDelay=-(n%9)*.38+"s"}e.addEventListener("click",()=>select(i));const item:Item={e,cluster:i,row,col,outer,from:{x:0,y:0},to:{x:0,y:0},now:{x:0,y:0}};item.to=position(item,mode);item.from=item.to;transform(item,item.to);items.push(item)}
names.forEach((name,i)=>{for(let n=0;n<counts[i];n++){const width=i===16?9:5;const col=n%width+Math.floor((9-width)/2);add(i,Math.floor(n/width),col,false,n)}for(let n=0;n<7+(i%4);n++)add(i,Math.floor(n/5),n%5,true,n);const b=document.createElement("button");b.className="legend-row";b.style.setProperty("--c",color(i));const sw=document.createElement("i"),title=document.createElement("span"),count=document.createElement("span");title.textContent=name;count.textContent=String(counts[i]);b.append(sw,title,count);b.onclick=()=>select(i);legend.append(b)});
byId("stats").textContent=items.length+" УЗЛОВ · "+names.length+" КЛАСТЕРОВ";
function polygon(c:Point,r:number){return Array.from({length:6},(_,j)=>{const p=polar(r,j*TAU/6);return (c.x+p.x)+","+(c.y+p.y)}).join(" ")}
function decorate(){orbits.replaceChildren();labels.replaceChildren();links.replaceChildren();cells.replaceChildren();if(mode!=="hex"){for(const r of mode==="compact"?[180,198,225]:[450,500,530])el("circle",{r,class:"orbit"},orbits)}names.forEach((name,i)=>{const a=angle(i),c=mode==="hex"?hexCenter(i):polar(mode==="compact"?145:310,a);if(mode==="hex"){const h=el("polygon",{points:polygon(c,90),class:"hex-cell",color:color(i)},cells);h.onclick=()=>select(i)}const p=mode==="hex"?c:polar(mode==="compact"?190:485,a);const from=mode==="hex"?{x:0,y:0}:polar(mode==="compact"?100:160,a);const end=mode==="hex"?c:polar(mode==="compact"?180:475,a);for(let j=0;j<3;j++){const dst=mode==="hex"?{x:end.x+j*5,y:end.y+j*3}:polar(mode==="compact"?180:475,a+(j-1)*.04);el("path",{d:"M"+from.x+" "+from.y+" L"+dst.x+" "+dst.y,class:"spoke",opacity:density,style:"opacity:"+density*.55},links)}const t=el("text",{x:c.x,y:c.y+(mode==="hex"?-52:0),class:"cluster-label",color:color(i),"text-anchor":mode==="hex"||Math.abs(Math.cos(a))<.18?"middle":Math.cos(a)>0?"start":"end"},labels);t.textContent=name;t.onclick=()=>select(i);if(i%2===0&&!paused){const dot=el("circle",{r:1.8,class:"particle"},links);el("animateMotion",{path:"M"+from.x+" "+from.y+" L"+p.x+" "+p.y,dur:(4+i%5)/speed+"s",begin:-(i%7)+"s",repeatCount:"indefinite"},dot)}});if(selected>=0){const a=angle(selected), target=mode==="hex"?hexCenter(selected):polar(mode==="compact"?125:235,a);for(let i=0;i<names.length;i++){if(i===selected)continue;const p=mode==="hex"?hexCenter(i):polar(mode==="compact"?160:470,angle(i));el("path",{d:"M"+target.x+" "+target.y+" Q0 0 "+p.x+" "+p.y,fill:"none",color:color(selected),class:"selected-link"},links)}}if(paused)svg.pauseAnimations();else svg.unpauseAnimations()}
function select(i:number){selected=i===selected?-1:i;Array.from(legend.children).forEach((b,j)=>b.classList.toggle("selected",j===selected));for(const item of items){item.e.classList.toggle("chosen",item.cluster===selected);item.e.style.opacity=selected<0||item.cluster===selected?"":"0.22"}detail.textContent=selected<0?"Выберите кластер или точку на карте.":names[selected]+" · "+counts[selected]+" демонстрационных точек. Подсвечены связи к другим кластерам.";decorate()}
function setMode(m:Mode){if(m===mode)return;mode=m;cancelAnimationFrame(raf);for(const it of items){it.from=it.now;it.to=position(it,m)}document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===m));decorate();start=performance.now();function tick(t:number){const p=paused?1:Math.min(1,(t-start)/750), eased=1-Math.pow(1-p,3);for(const it of items)transform(it,mix(it.from,it.to,eased));if(p<1)raf=requestAnimationFrame(tick)}raf=requestAnimationFrame(tick)}
function camera(){world.setAttribute("transform","translate("+tx+" "+ty+") scale("+zoom+")");byId("reset").textContent=Math.round(zoom*100)+"%"}
function zoomAt(factor:number,x=0,y=0){const next=Math.max(.3,Math.min(4,zoom*factor));tx=x-(x-tx)*next/zoom;ty=y-(y-ty)*next/zoom;zoom=next;camera()}
function coords(x:number,y:number):Point{const matrix=svg.getScreenCTM();if(!matrix)return{x:0,y:0};const p=new DOMPoint(x,y).matrixTransform(matrix.inverse());return{x:p.x,y:p.y}}
svg.addEventListener("wheel",e=>{e.preventDefault();const p=coords(e.clientX,e.clientY);zoomAt(Math.exp(-e.deltaY*.0015),p.x,p.y)},{passive:false});
let drag:{id:number;point:Point;tx:number;ty:number;moved:boolean}|null=null;
svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;drag={id:e.pointerId,point:coords(e.clientX,e.clientY),tx,ty,moved:false}});
svg.addEventListener("pointermove",e=>{if(!drag||drag.id!==e.pointerId)return;const p=coords(e.clientX,e.clientY),dx=p.x-drag.point.x,dy=p.y-drag.point.y;if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;svg.setPointerCapture(e.pointerId);svg.classList.add("dragging");tx=drag.tx+dx;ty=drag.ty+dy;camera()});
function stop(){drag=null;svg.classList.remove("dragging")}svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);
const reset=()=>{zoom=1;tx=ty=0;camera()};byId("reset").onclick=reset;byId("minus").onclick=()=>zoomAt(.8);byId("plus").onclick=()=>zoomAt(1.25);group("core").addEventListener("click",()=>{reset();if(selected>=0)select(selected)});group("core").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();reset();if(selected>=0)select(selected)}});
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.onclick=()=>setMode(b.dataset.mode as Mode));
byId<HTMLInputElement>("speed").oninput=e=>{speed=Number((e.target as HTMLInputElement).value);byId("speedOut").textContent=speed.toFixed(2)+"×";document.documentElement.style.setProperty("--duration",4/speed+"s");decorate()};
byId<HTMLInputElement>("glow").oninput=e=>document.documentElement.style.setProperty("--glow",String(Number((e.target as HTMLInputElement).value)/100));
byId<HTMLInputElement>("density").oninput=e=>{density=Number((e.target as HTMLInputElement).value)/100;decorate()};
function applyPause(){document.body.classList.toggle("paused",paused);byId("pause").textContent=paused?"Продолжить анимацию":"Пауза анимации";if(paused)svg.pauseAnimations();else svg.unpauseAnimations()}
byId("pause").onclick=()=>{paused=!paused;decorate();applyPause()};
const panel=byId("panel"),toggle=byId("panelToggle");if(matchMedia("(max-width:720px)").matches){panel.hidden=true;toggle.setAttribute("aria-expanded","false")}toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute("aria-expanded",String(!panel.hidden))};decorate();applyPause();camera();
