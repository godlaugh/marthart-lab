/** Unevaluated high+low IEEE-754 pairs (about 31 decimal digits). No BigInt or
 * decimal serialization enters the hot iteration loop. Finite arithmetic only. */
export type DD = readonly [number, number];
export const dd = (high: number, low = 0): DD => {
 const sum=high+low, e=sum-high;return [sum,(high-(sum-e))+(low-e)];
};
export function ddAdd(a:DD,b:DD):DD {
 const s=a[0]+b[0],v=s-a[0],e=(a[0]-(s-v))+(b[0]-v)+a[1]+b[1];return dd(s,e);
}
export const ddNeg=(a:DD):DD=>[-a[0],-a[1]];
export const ddSub=(a:DD,b:DD):DD=>ddAdd(a,ddNeg(b));
function splitNumber(value:number):[number,number] {
 const scale=Math.abs(value)>1e300?2**-28:1,scaled=value*scale;
 const part=134217729*scaled,high=part-(part-scaled);
 return [high/scale,(scaled-high)/scale];
}
export function ddMul(a:DD,b:DD):DD {
 const p=a[0]*b[0];
 if(!Number.isFinite(p))return [p,0];
 const [ah,al]=splitNumber(a[0]),[bh,bl]=splitNumber(b[0]);
 return dd(p,((ah*bh-p)+ah*bl+al*bh)+al*bl+a[0]*b[1]+a[1]*b[0]+a[1]*b[1]);
}
export function ddDiv(a:DD,b:DD):DD {
 const q=a[0]/b[0];if(!Number.isFinite(q))return [q,0];
 const r=ddSub(a,ddMul(b,[q,0])),q2=(r[0]+r[1])/b[0];
 const first=ddAdd([q,0],[q2,0]),r2=ddSub(a,ddMul(b,first));
 return ddAdd(first,[(r2[0]+r2[1])/b[0],0]);
}
export const ddNumber=(a:DD)=>a[0]+a[1];
export type DDComplex=readonly [DD,DD];
export const dc=(x:number,y:number,xLow=0,yLow=0):DDComplex=>[dd(x,xLow),dd(y,yLow)];
export const dcAdd=(a:DDComplex,b:DDComplex):DDComplex=>[ddAdd(a[0],b[0]),ddAdd(a[1],b[1])];
export const dcSub=(a:DDComplex,b:DDComplex):DDComplex=>[ddSub(a[0],b[0]),ddSub(a[1],b[1])];
export const dcMul=(a:DDComplex,b:DDComplex):DDComplex=>[ddSub(ddMul(a[0],b[0]),ddMul(a[1],b[1])),ddAdd(ddMul(a[0],b[1]),ddMul(a[1],b[0]))];
export const dcScale=(a:DDComplex,k:number):DDComplex=>[ddMul(a[0],[k,0]),ddMul(a[1],[k,0])];
export function dcDiv(a:DDComplex,b:DDComplex):DDComplex {
 const denominator=ddAdd(ddMul(b[0],b[0]),ddMul(b[1],b[1]));
 return [ddDiv(ddAdd(ddMul(a[0],b[0]),ddMul(a[1],b[1])),denominator),ddDiv(ddSub(ddMul(a[1],b[0]),ddMul(a[0],b[1])),denominator)];
}
export function dcPow(z:DDComplex,n:number):DDComplex {
 if(!Number.isInteger(n)||n<0||n>32)throw new Error('DD integer power must be in 0–32');
 let a=dc(1,0),b=z;
 while(n){if(n%2)a=dcMul(a,b);n=Math.floor(n/2);if(n)b=dcMul(b,b);}return a;
}
export const dcNumbers=(z:DDComplex):[number,number]=>[ddNumber(z[0]),ddNumber(z[1])];
