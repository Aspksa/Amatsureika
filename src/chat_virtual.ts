/** Variable-height message window, with estimated heights until measured. */
export function visibleRange(heights:number[],offset:number,viewport:number,overscan=600){
 const prefix=[0];for(const h of heights)prefix.push(prefix[prefix.length-1]+Math.max(1,h));
 const lo=Math.max(0,offset-overscan),hi=Math.max(lo,offset+viewport+overscan);
 let start=0,end=heights.length;
 while(start<heights.length&&prefix[start+1]<=lo)start++;
 end=start;while(end<heights.length&&prefix[end]<hi)end++;
 return {start,end,top:prefix[start],bottom:prefix[heights.length]-prefix[end],total:prefix[heights.length],prefix};
}
