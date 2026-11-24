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
  if(mode!=="hex")assert.deepEqual(g.point(0,0,false),grown.point(0,0,false));
  console.log(mode,total,"points:",points.length,"radius:",Math.round(g.radius));
 }
}
const keys=new Set(Array.from({length:10000},(_,i)=>axial(i).join(",")));assert.equal(keys.size,10000);
const boxes=[{x:0,y:0,w:40,h:12},{x:20,y:0,w:40,h:12},{x:80,y:0,w:40,h:12}];
assert.deepEqual(labelMask(boxes,1),[false,true,true]);assert(overlaps(boxes[0],boxes[1]));
assert(!valid({x:NaN,y:0}));assert(!valid({x:Infinity,y:0}));
console.log("Geometry stress and collision tests passed");
