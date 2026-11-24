import assert from "node:assert/strict";
import {layout, collisions, valid, distance, labelMask, overlaps, axial} from "../public/geometry.js";
for (const total of [1000,5000,10000]){
 const counts=Array.from({length:21},(_,i)=>Math.floor(total/21)+(i<total%21?1:0));
 for(const mode of ["compact","radial","hex"]){
  const g=layout(counts,mode),points=[];
  counts.forEach((n,i)=>{for(let j=0;j<n;j++)points.push({p:g.point(i,j,false),r:3.5});for(let j=0;j<7+i%4;j++)points.push({p:g.point(i,j,true),r:10})});
  assert(points.every(x=>valid(x.p)));assert.equal(collisions(points),0,`${mode}: ${total}`);
  if(mode==="hex")for(let i=0;i<21;i++)for(let j=i+1;j<21;j++)assert(distance(g.centers[i],g.centers[j])>=g.radii[i]+g.radii[j]);
  const grown=layout(counts.map((n,i)=>n+(i===0?1:0)),mode);
  if(mode==="compact")assert.deepEqual(g.point(0,0,false),grown.point(0,0,false));
  if(mode==="radial"){assert.deepEqual(g.point(0,0,false),layout(counts,mode).point(0,0,false));assert(grown.sectors[0].span>0);}
  console.log(mode,total,"points:",points.length,"radius:",Math.round(g.radius));
 }
}
const keys=new Set(Array.from({length:10000},(_,i)=>axial(i).join(",")));assert.equal(keys.size,10000);
const boxes=[{x:0,y:0,w:40,h:12},{x:20,y:0,w:40,h:12},{x:80,y:0,w:40,h:12}];
assert.deepEqual(labelMask(boxes,1),[false,true,true]);assert(overlaps(boxes[0],boxes[1]));
assert(!valid({x:NaN,y:0}));assert(!valid({x:Infinity,y:0}));
console.log("Geometry stress and collision tests passed");

for(const counts of [
 [88,...Array.from({length:15},(_,i)=>24+(i*17)%67),176,41,58,75,25],
 [1,2,3,20,200,1000,...Array(15).fill(12)],
 [10000,...Array(20).fill(1)],
 Array.from({length:21},(_,i)=>1+i*i)
]){
 const g=layout(counts,"radial"),points=[];
 assert(g.inner>=185);assert(g.outer>=g.edge+160);assert(g.outer>=g.edge*1.78);
 assert(Math.abs(g.sectors.reduce((s,v)=>s+v.span,0)-Math.PI*2)<1e-9);
 assert.equal(g.orbits.length,2);
 for(let i=0;i<counts.length;i++){
  const s=g.sectors[i];if(i>0)assert(Math.abs(s.start-g.sectors[i-1].start-g.sectors[i-1].span)<1e-9);
  for(let j=0;j<counts[i];j++){const p=g.point(i,j,false);assert(valid(p));assert(Math.hypot(p.x,p.y)>=g.inner-1e-6);const delta=Math.atan2(Math.sin(Math.atan2(p.y,p.x)-s.angle),Math.cos(Math.atan2(p.y,p.x)-s.angle));assert(Math.abs(delta)<s.span/2);points.push({p,r:3.5})}
  for(let j=0;j<7+i%4;j++)points.push({p:g.point(i,j,true),r:10});
 }
 assert.equal(collisions(points),0,"skewed radial layout");
 const largest=counts.indexOf(Math.max(...counts)),smallest=counts.indexOf(Math.min(...counts));
 assert(g.sectors[largest].span>g.sectors[smallest].span);
 const grown=layout(counts.map((n,i)=>i===smallest?n+1:n),"radial");assert(grown.sectors.every((s,i)=>s.span>0&&(i===0||s.angle>grown.sectors[i-1].angle)));
}
console.log("Organic radial sectors and clearance tests passed");

const {conversationLayout}=await import("../public/geometry.js");
for(const mode of ["radial","compact","hex"]){
 const empty=conversationLayout([],mode);assert.equal(empty.centers.length,0);
 const a=conversationLayout([200],mode),b=conversationLayout([200,0],mode);
 assert.deepEqual(a.point(0,199,false),b.point(0,199,false));
 for(const n of [2,13,50]){
  const counts=Array.from({length:n},(_,i)=>i===n-1?0:200),g=conversationLayout(counts,mode),points=[];
  counts.forEach((count,i)=>{for(let j=0;j<count;j++)points.push({p:g.point(i,j,false),r:3.5});points.push({p:g.point(i,0,true),r:10})});
  assert(points.every(x=>valid(x.p)));assert.equal(collisions(points),0,`chat ${mode} ${n}`);
 }
}
console.log("Chat cluster stable geometry passed");

const {ClusterIndex,curvedPoint}=await import("../public/geometry.js");
for(const total of [10000,50000,100000]){
 const counts=Array(Math.ceil(total/200)).fill(200),g=conversationLayout(counts,"radial"),points=[];
 const index=new ClusterIndex(g.centers);
 assert.equal(index.query(-g.radius,-g.radius,g.radius,g.radius).length,counts.length);
 assert(index.query(-600,-600,600,600).length<=counts.length);
 const grown=conversationLayout([...counts,0],"radial");
 for(let i=0;i<counts.length;i++){for(let j=0;j<200;j++)points.push({p:g.point(i,j,false),r:3.5});points.push({p:g.point(i,0,true),r:10});assert.deepEqual(g.point(i,199,false),grown.point(i,199,false));}
 assert(points.every(x=>valid(x.p)));assert.equal(collisions(points),0);
 console.log("Large map geometry",total,"passed");
}
assert.deepEqual(curvedPoint({x:0,y:0},{x:10,y:0},0),{x:0,y:0});
assert.deepEqual(curvedPoint({x:0,y:0},{x:10,y:0},1),{x:10,y:0});
assert(curvedPoint({x:0,y:0},{x:10,y:0},.5).y>0);

const {directedBlockLayout}=await import("../public/geometry.js");
for(const count of [1,100,200,2000,20000]){
 const a=directedBlockLayout(count,"radial"),b=directedBlockLayout(count+1,"radial");
 assert(a.centers.every(p=>valid(p)&&p.y<0));assert.deepEqual(a.centers,b.centers.slice(0,count));
 assert.equal(collisions(a.centers.map(p=>({p,r:8}))),0);
}
