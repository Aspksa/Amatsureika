export type Point={x:number;y:number};
export type Mode="compact"|"radial"|"hex";
export const TAU=2*Math.PI;
export const polar=(r:number,a:number):Point=>({x:r*Math.cos(a),y:r*Math.sin(a)});
export const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export const valid=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1e6&&Math.abs(p.y)<=1e6;
export const clamp=(n:number,a:number,b:number,fallback=0)=>Number.isFinite(n)?Math.max(a,Math.min(b,n)):fallback;
export function axial(index:number):[number,number]{
 if(index===0)return [0,0];
 let ring=1;while(index>3*ring*(ring+1))ring++;
 let offset=index-1-3*(ring-1)*ring,q=ring,r=0;
 const dirs=[[-1,1],[-1,0],[0,-1],[1,-1],[1,0],[0,1]];
 for(const [dq,dr] of dirs){const steps=Math.min(offset,ring);q+=dq*steps;r+=dr*steps;offset-=steps;if(!offset)break}
 return [q,r];
}
const axialPoint=(index:number,pitch:number):Point=>{const [q,r]=axial(index);return {x:pitch*(q+r/2),y:pitch*Math.sqrt(3)*r/2}};
export type Sector={start:number;span:number;angle:number;columns:number;rows:number};
export type Layout={sectors?:Sector[];inner?:number;edge?:number;mode:Mode;radius:number;outer:number;centers:Point[];radii:number[];orbits:number[];point:(i:number,n:number,outer:boolean)=>Point;label:(i:number)=>Point};
export function layout(raw:readonly number[],mode:Mode):Layout{
 const counts=raw.map(n=>Math.floor(clamp(n,1,10000,1))),k=counts.length||1;
 if(mode==="radial")return radialLayout(counts);
 const pitch=10,cols=7,arc=pitch*(cols+1),inner=Math.max( mode==="compact"?145:190,arc*k/TAU+15);
 const angle=(i:number)=>-Math.PI/2+i*TAU/k;
 const max=Math.max(1,...counts),rows=Math.ceil(max/cols),edge=inner+(rows-1)*pitch;
 const outer=Math.max(edge+45, (5*24)*k/TAU+20);
 const radii=counts.map(n=>{const ring=Math.ceil((Math.sqrt(12*Math.max(0,n-1)+9)-3)/6);return Math.max(62,ring*pitch+42)});
 const spacing=2*Math.max(62,...radii)+24;
 const centers=counts.map((n,i)=>mode==="hex"?axialPoint(i+1,spacing):polar(inner+(Math.ceil(n/cols)-1)*pitch/2,angle(i)));
 const radius=mode==="hex"?Math.max(100,...centers.map((p,i)=>Math.hypot(p.x,p.y)+radii[i]+50)):outer+110;
 function point(i:number,n:number,satellite:boolean):Point{
  if(mode==="hex"){
   const c=centers[i],local=satellite?polar(radii[i]-12,n*TAU/(7+i%4)):axialPoint(n,pitch);
   return {x:c.x+local.x,y:c.y+local.y};
  }
  if(satellite){const r=outer+Math.floor(n/5)*30;return polar(r,angle(i)+(n%5-2)*24/r)}
  const r=inner+Math.floor(n/cols)*pitch;return polar(r,angle(i)+(n%cols-3)*pitch/r);
 }
 return {mode,radius,outer,centers,radii,orbits:mode==="hex"?[spacing/2,spacing,spacing*2]:[inner-22,inner,edge+22,outer,outer+30],point,label:i=>mode==="hex"?{x:centers[i].x,y:centers[i].y-radii[i]-13}:polar(outer+65,angle(i))};
}
/** Data-weighted, disjoint angular sectors. The reserved arc length at the
 * smallest radius bounds node spacing on every subsequent row. */
function radialLayout(counts:readonly number[]):Layout{
 const pitch=10, iconPitch=24, columns=counts.map(n=>Math.max(2,Math.min(24,Math.ceil(Math.sqrt(n*.65)))));
 const weights=columns.map(c=>c+2.5),sum=weights.reduce((a,b)=>a+b,0)||1;
 // Minimum arc clearance; increase radius rather than compressing dense sectors.
 const inner=Math.max(185,pitch*sum/TAU+12);
 let cursor=-Math.PI/2;
 const sectors=columns.map((c,i)=>{const span=TAU*weights[i]/sum,start=cursor;cursor+=span;return{start,span,angle:start+span/2,columns:c,rows:Math.ceil(counts[i]/c)}});
 const edge=inner+Math.max(0,...sectors.map(s=>s.rows-1))*pitch;
 // A generous empty annulus, with enough room even for the narrowest group.
 const outer=Math.max(edge*1.78,edge+160,...sectors.map(s=>130/s.span));
 const radius=outer+65;
 const centers=sectors.map(s=>polar(inner+(s.rows-1)*pitch/2,s.angle));
 const radii=sectors.map(s=>Math.max(35,Math.hypot((s.columns-1)*pitch,(s.rows-1)*pitch)/2+12));
 function point(i:number,n:number,satellite:boolean):Point{
  const s=sectors[i];
  if(satellite){const r=outer+Math.floor(n/5)*30;return polar(r,s.angle+(n%5-2)*iconPitch/r)}
  const row=Math.floor(n/s.columns),r=inner+row*pitch;
  return polar(r,s.angle+(n%s.columns-(s.columns-1)/2)*pitch/r);
 }
 return{mode:"radial",radius,outer,inner,edge,sectors,centers,radii,orbits:[outer,outer+52],point,label:i=>polar(outer+55,sectors[i].angle)};
}
export type Box={x:number;y:number;w:number;h:number};
export const overlaps=(a:Box,b:Box)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export function labelMask(boxes:readonly Box[],priority=-1):boolean[]{
 const accepted:Box[]=[],mask=boxes.map(()=>false);
 const order=boxes.map((_,i)=>i).sort((a,b)=>Number(b===priority)-Number(a===priority)||a-b);
 for(const i of order){const b=boxes[i];if(!accepted.some(a=>overlaps(a,b))){accepted.push(b);mask[i]=true}}
 return mask;
}
export function collisions(points:readonly {p:Point;r:number}[]):number{
 const buckets=new Map<string,{p:Point;r:number}[]>();let count=0;
 const step=points.reduce((m,x)=>Math.max(m,x.r*2),1);
 for(const item of points){const x=Math.floor(item.p.x/step),y=Math.floor(item.p.y/step);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const other of buckets.get((x+dx)+":"+(y+dy))||[])if(distance(item.p,other.p)+1e-6<item.r+other.r)count++;const key=x+":"+y;const bucket=buckets.get(key)||[];bucket.push(item);buckets.set(key,bucket)}
 return count;
}

/** Stable adjacent slots for chronological conversation segments.
 * New clusters do not relocate previously saved messages. */
export function conversationLayout(raw:readonly number[],mode:Mode):Layout{
 const counts=raw.map(n=>Math.floor(clamp(n,0,200,0))),pitch=10,slots=mode==="compact"?10:12;
 const ring=(i:number)=>Math.floor(i/slots);
 const angle=(i:number)=>-Math.PI/2+(ring(i)%2===0?i%slots:slots-1-i%slots)*TAU/slots;
 const base=(i:number)=>(mode==="compact"?220:260)+ring(i)*310;
 const centers=counts.map((_,i)=>mode==="hex"?axialPoint(i+1,390):polar(base(i)+75,angle(i)));
 const radii=counts.map(()=>mode==="hex"?150:105);
 const radius=mode==="hex"?Math.max(360,...centers.map(p=>Math.hypot(p.x,p.y)+190)):Math.max(570,...counts.map((_,i)=>base(i)+270));
 const outer=radius-35;
 function point(i:number,n:number,satellite:boolean):Point{
  if(mode==="hex"){const c=centers[i],p=satellite?{x:0,y:-142}:axialPoint(n,pitch);return{x:c.x+p.x,y:c.y+p.y}}
  const r=satellite?base(i)+215:base(i)+Math.floor(n/12)*pitch;
  return polar(r,angle(i)+(satellite?0:(n%12-5.5)*pitch/r));
 }
 const orbits=mode==="hex"?[outer]:[outer,outer+22];
 return{mode,radius,outer,centers,radii,orbits,point,label:i=>centers[i]};
}

/** Cluster-level spatial index; no allocation per stored message. */
export class ClusterIndex{
 private buckets=new Map<string,number[]>();
 private size=400;
 constructor(private centers:readonly Point[],private padding=190){
  centers.forEach((p,i)=>{const key=Math.floor(p.x/this.size)+":"+Math.floor(p.y/this.size);const list=this.buckets.get(key)||[];list.push(i);this.buckets.set(key,list)});
 }
 query(left:number,top:number,right:number,bottom:number):number[]{
  const a=Math.floor((left-this.padding)/this.size),b=Math.floor((right+this.padding)/this.size),c=Math.floor((top-this.padding)/this.size),d=Math.floor((bottom+this.padding)/this.size);
  const candidates:number[]=[];
  if((b-a+1)*(d-c+1)>this.buckets.size*4){for(const list of this.buckets.values())candidates.push(...list)}
  else for(let x=a;x<=b;x++)for(let y=c;y<=d;y++)candidates.push(...(this.buckets.get(x+":"+y)||[]));
  return candidates.filter(i=>{const p=this.centers[i],r=this.padding;return p.x+r>=left&&p.x-r<=right&&p.y+r>=top&&p.y-r<=bottom}).sort((x,y)=>x-y);
 }
}
export function curvedPoint(a:Point,b:Point,t:number,bend=.18):Point{
 const p=clamp(t,0,1),v=1-p,dx=b.x-a.x,dy=b.y-a.y;
 const c={x:(a.x+b.x)/2-dy*bend,y:(a.y+b.y)/2+dx*bend};
 return{x:v*v*a.x+2*v*p*c.x+p*p*b.x,y:v*v*a.y+2*v*p*c.y+p*p*b.y};
}

/** One real point per 500 messages. Stable slots, exact chord clearance. */
export function directedBlockLayout(count:number,mode:Mode):Layout{
 const centers:Point[]=[],pitch=28;
 if(mode==="radial"){
  for(let row=0;centers.length<count;row++){
   const r=220+row*pitch,step=2*Math.asin(pitch/(2*r)),half=Math.floor(.34/step);
   for(let col=0;col<=2*half&&centers.length<count;col++){
    const offset=col===0?0:Math.ceil(col/2)*(col%2===1?1:-1);
    centers.push(polar(r,-Math.PI/2+offset*step));
   }
  }
 }else if(mode==="compact"){
  const center={x:0,y:-220};
  if(count)centers.push(center);
  for(let row=1;centers.length<count;row++){
   const r=row*pitch,n=Math.floor(Math.PI/Math.asin(pitch/(2*r)));
   for(let j=0;j<n&&centers.length<count;j++){
    const p=polar(r,-Math.PI/2+j*TAU/n),q={x:center.x+p.x,y:center.y+p.y};
    if(Math.hypot(q.x,q.y)>=170)centers.push(q)
   }
  }
 }else{
  for(let i=0;centers.length<count;i++){
   const p=axialPoint(i,pitch),q={x:p.x,y:p.y-220};
   if(Math.hypot(q.x,q.y)>=170)centers.push(q)
  }
 }
 const edge=centers.reduce((r,p)=>Math.max(r,Math.hypot(p.x,p.y)+14),180);
 const outer=Math.max(300,edge+72),radius=outer+58;
 return{mode,radius,outer,edge,centers,radii:centers.map(()=>12),orbits:[116,148,outer-28,outer],point:i=>centers[i],label:i=>centers[i]};
}
/** Allocate only real registered modules, with disjoint 38-unit hit areas. */
export function functionalOrbit(count:number,radius:number):Point[]{
 const r=Math.max(220,radius+22),step=2*Math.asin(46/(2*r)),capacity=Math.max(1,Math.floor((Math.PI/2-.24)/step)+1);
 return Array.from({length:count},(_,i)=>{
  const row=Math.floor(i/capacity),rr=r+row*46,ss=2*Math.asin(46/(2*rr));
  return polar(rr,-Math.PI/2+.12+(i%capacity)*ss)
 });
}
/** Separate downward file sector, outside the occupied memory disk. */
export function documentPoint(i:number,edge:number):Point{
 const row=Math.floor((Math.sqrt(8*i+1)-1)/2),col=i-row*(row+1)/2;
 return{x:(col-row/2)*28,y:Math.max(220,edge+42)+row*28};
}

export const WORK_KINDS=["staff","timesheet","cards","vehicles","fuel"] as const;
export type WorkKind=typeof WORK_KINDS[number];
/** Independent angular sectors with exact chord clearance. Every sector
 * grows outward on the same inner ring. Compact/hex memory can extend
 * beyond its own sector, so reserve its occupied radius in those modes. */
export function sectorPoints(count:number,angle:number,halfSpan:number,base=220):Point[]{
 const points:Point[]=[],pitch=28;
 for(let row=0;points.length<count;row++){
  const r=base+row*pitch,step=2*Math.asin(pitch/(2*r)),half=Math.floor(halfSpan/step);
  for(let col=0;col<=2*half&&points.length<count;col++){
   const offset=col===0?0:Math.ceil(col/2)*(col%2===1?1:-1);
   points.push(polar(r,angle+offset*step));
  }
 }
 return points;
}
export function workspaceSectors(mode:Mode,memoryEdge:number,fileCount:number,work:readonly {kind:WorkKind}[]){
 const base=mode==="radial"?220:Math.max(220,memoryEdge+42);
 const files=sectorPoints(fileCount,Math.PI/6,.34,base);
 const workPoints:Point[]=Array(work.length);
 WORK_KINDS.forEach((kind,k)=>{
  const ids:number[]=[];work.forEach((r,i)=>{if(r.kind===kind)ids.push(i)});
  const points=sectorPoints(ids.length,(120+k*26)*Math.PI/180,.17,base);
  ids.forEach((i,j)=>workPoints[i]=points[j]);
 });
 const edge=[...files,...workPoints].reduce((r,p)=>Math.max(r,Math.hypot(p.x,p.y)+14),memoryEdge);
 return{files,work:workPoints,edge};
}
/** Five real modules, with chat, work and documents facing their data sectors. */
export function dataOrbit(radius:number):Point[]{
 const r=Math.max(300,radius+22);
 return [-65,180,30,-17,-90,90].map(deg=>polar(r,deg*Math.PI/180));
}
