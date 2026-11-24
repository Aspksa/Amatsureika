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
export type Layout={mode:Mode;radius:number;outer:number;centers:Point[];radii:number[];orbits:number[];point:(i:number,n:number,outer:boolean)=>Point;label:(i:number)=>Point};
export function layout(raw:readonly number[],mode:Mode):Layout{
 const counts=raw.map(n=>Math.floor(clamp(n,1,10000,1))),k=counts.length||1;
 const pitch=mode==="radial"?12:10,cols=7,arc=pitch*(cols+1),inner=Math.max( mode==="compact"?145:190,arc*k/TAU+15);
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
 const step=Math.max(1,...points.map(x=>x.r*2));
 for(const item of points){const x=Math.floor(item.p.x/step),y=Math.floor(item.p.y/step);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const other of buckets.get((x+dx)+":"+(y+dy))||[])if(distance(item.p,other.p)+1e-6<item.r+other.r)count++;const key=x+":"+y;const bucket=buckets.get(key)||[];bucket.push(item);buckets.set(key,bucket)}
 return count;
}
