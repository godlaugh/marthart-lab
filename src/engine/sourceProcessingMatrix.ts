/** Shared Processing PMatrix3D and default-camera arithmetic. Source scenes
 * own their camera policy; this module only implements parsed matrix operations. */
export interface SourceProcessingMatrix {readonly rowMajor:readonly number[];readonly columnMajor:Float32Array;}
type SourceCameraVec3=readonly[number,number,number];
const F=Math.fround,add=(a:number,b:number)=>F(a+b),sub=(a:number,b:number)=>F(a-b),mul=(a:number,b:number)=>F(a*b),div=(a:number,b:number)=>F(a/b);
const EPS=2**-23;
export class SourceProcessingMatrixError extends Error {constructor(){super('Singular Processing camera matrix.');this.name='SourceProcessingMatrixError';}}
export function packSourceProcessingMatrix(rowMajor: number[]): SourceProcessingMatrix {
  const columnMajor = new Float32Array(16);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) columnMajor[col * 4 + row] = rowMajor[row * 4 + col];
  return Object.freeze({ rowMajor: Object.freeze(rowMajor), columnMajor });
}
/** PMatrix3D.apply: four separately rounded products, then left-associated sums. */
export function applySourceProcessingMatrix(a: number[], b: readonly number[]): void {
  const out = new Array<number>(16);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const i = row * 4;
    out[i + col] = add(add(add(mul(a[i], b[col]), mul(a[i + 1], b[col + 4])), mul(a[i + 2], b[col + 8])), mul(a[i + 3], b[col + 12]));
  }
  a.splice(0, 16, ...out);
}
/** PMatrix3D.invert. Determinant expansion and cofactors deliberately use
 * different Float32 groupings, matching the source owner. A zero determinant
 * preserves the input; nonfinite results are not silently replaced by identity. */
export function invertSourceProcessingMatrix(a:number[]):boolean {
 const minor=(row:number,col:number)=>a.filter((_,index)=>Math.floor(index/4)!==row&&index%4!==col);
 const expanded=([a,b,c,d,e,f,g,h,i]:number[])=>sub(sub(sub(add(add(mul(mul(a,e),i),mul(mul(b,f),g)),mul(mul(c,d),h)),mul(mul(c,e),g)),mul(mul(a,f),h)),mul(mul(b,d),i));
 const det=sub(add(sub(mul(a[0],expanded(minor(0,0))),mul(a[1],expanded(minor(0,1)))),mul(a[2],expanded(minor(0,2)))),mul(a[3],expanded(minor(0,3))));
 if(det===0)return false;
 const det3=([a,b,c,d,e,f,g,h,i]:number[])=>add(add(mul(a,sub(mul(e,i),mul(f,h))),mul(b,sub(mul(f,g),mul(d,i)))),mul(c,sub(mul(d,h),mul(e,g))));
 const out=new Array<number>(16);
 for(let row=0;row<4;row++)for(let col=0;col<4;col++){
  const cofactor=det3(minor(row,col));out[col*4+row]=div((row+col)%2?-cofactor:cofactor,det);
 }
 a.splice(0,16,...out);return true;
}
/** translate's final addition is existing m03 + ((x*m00+y*m01)+z*m02). */
export function translateSourceProcessingMatrix(a: number[], x: number, y: number, z: number): void {
  for (let i = 0; i < 16; i += 4) a[i + 3] = add(a[i + 3], add(add(mul(x, a[i]), mul(y, a[i + 1])), mul(z, a[i + 2])));
}
export function sourceProcessingRotationMatrix(axis:'x'|'z',angle:number):number[] {
  // PGraphicsOpenGL.rotateX/Z route through rotateImpl -> PMatrix3D.rotate
  // (angle,axis), NOT the specialized PMatrix rotateX/Z methods. Rodrigues'
  // t+c on the axis must not be replaced with 1 (e.g. angle=1.58F differs).
  const c = F(Math.cos(angle)), s = F(Math.sin(angle)), t = sub(1, c);
  const x = axis === 'x' ? 1 : 0, y = 0, z = axis === 'z' ? 1 : 0;
  const product = (a: number, b: number) => mul(mul(t, a), b);
  return [add(product(x, x), c), sub(product(x, y), mul(s, z)), add(product(x, z), mul(s, y)), 0,
    add(product(x, y), mul(s, z)), add(product(y, y), c), sub(product(y, z), mul(s, x)), 0,
    sub(product(x, z), mul(s, y)), add(product(y, z), mul(s, x)), add(product(z, z), c), 0, 0, 0, 0, 1];
}
export function rotateSourceProcessingMatrix(a:number[],axis:'x'|'z',angle:number):void {applySourceProcessingMatrix(a,sourceProcessingRotationMatrix(axis,angle));}
export function scaleSourceProcessingMatrix(a:number[],x:number,y:number,z:number):void {for(let i=0;i<16;i+=4){a[i]=mul(a[i],x);a[i+1]=mul(a[i+1],y);a[i+2]=mul(a[i+2],z);}}
function length3(a: SourceCameraVec3): number { return F(Math.sqrt(add(add(mul(a[0], a[0]), mul(a[1], a[1])), mul(a[2], a[2])))); }
function normalize(a: SourceCameraVec3): SourceCameraVec3 {
  const length = length3(a);
  if (!Number.isFinite(length) || length === 0) throw new SourceProcessingMatrixError();
  return length >= EPS ? [div(a[0], length), div(a[1], length), div(a[2], length)] : a;
}
export function sourceProcessingCameraMatrix(width: number, height: number, cameraZ: number): number[] {
  // Complete retained camera(eye=(W/2,H/2,Z), target=(W/2,H/2,0), up=(0,1,0)).
  // Do not replace normalizations with identity: float sqrt(z*z) changes low bits.
  const z = normalize([0, 0, cameraZ]);
  const x0: SourceCameraVec3 = [sub(mul(1, z[2]), mul(0, z[1])), add(mul(-0, z[2]), mul(0, z[0])), sub(mul(0, z[1]), mul(1, z[0]))];
  const y0: SourceCameraVec3 = [sub(mul(z[1], x0[2]), mul(z[2], x0[1])), add(mul(-z[0], x0[2]), mul(z[2], x0[0])), sub(mul(z[0], x0[1]), mul(z[1], x0[0]))];
  const x = normalize(x0), y = normalize(y0);
  const result = [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1];
  translateSourceProcessingMatrix(result, -div(width, 2), -div(height, 2), -cameraZ);
  return result;
}
export function sourceProcessingPerspective(fov: number, aspect: number, near: number, far: number): number[] {
  const top = mul(near, F(Math.tan(div(fov, 2)))), bottom = -top;
  const left = mul(bottom, aspect), right = mul(top, aspect);
  const twiceNear = mul(2, near), w = sub(right, left), h = sub(top, bottom), d = sub(far, near);
  return [div(twiceNear, w), 0, div(add(right, left), w), 0, 0, div(-twiceNear, h), div(add(top, bottom), h), 0, 0, 0, div(-add(far, near), d), div(-mul(twiceNear, far), d), 0, 0, -1, 0];
}
export function sourceProcessingDefaultCameraZ(height:number):number {return div(div(height,2),F(Math.tan(div(F(Math.PI/3),2))));}
export function sourceProcessingOrthographic(width: number, height: number,eyeDistance?:number): { values: number[]; far: number } {
  // Wrapper camera() uses Processing's default PI/3 camera, then ortho().
  const far = mul(eyeDistance??length3([0,0,sourceProcessingDefaultCameraZ(height)]),10);
  const left = div(-width, 2), right = div(width, 2), bottom = div(-height, 2), top = div(height, 2);
  const w = sub(right, left), h = sub(top, bottom);
  return { far, values: [div(2, w), 0, 0, div(-add(right, left), w), 0, -div(2, h), 0, div(-add(top, bottom), h), 0, 0, div(-2, far), div(-far, far), 0, 0, 0, 1] };
}
