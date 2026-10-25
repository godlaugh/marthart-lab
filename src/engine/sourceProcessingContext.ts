import {applySourceProcessingMatrix as apply,invertSourceProcessingMatrix as invert,packSourceProcessingMatrix as pack,rotateSourceProcessingMatrix as rotate,scaleSourceProcessingMatrix as scale,sourceProcessingCameraMatrix,sourceProcessingDefaultCameraZ,sourceProcessingOrthographic,sourceProcessingPerspective,sourceProcessingRotationMatrix,translateSourceProcessingMatrix as translate,SourceProcessingMatrixError} from './sourceProcessingMatrix';

/** The graphics object owns these matrices across frames and scene switches.
 * A shader captures that object on its first bind, not the latest render target.
 * Source: Processing 4.5.0 PGraphicsOpenGL/PShader and MathArt 1.7.8 Scene.
 * This models the matrix/hint operations used by those paths, not all PGraphics. */
export type SourceProcessingContextEvent=
 | {kind:'begin-draw'|'end-draw'|'reset-matrix'|'push-matrix'|'pop-matrix'|'default-camera'|'default-perspective'|'ortho'}
 | {kind:'resize';width:number;height:number}
 | {kind:'hint';index:6|7;enabled:boolean}
 | {kind:'camera';z:number}
 | {kind:'perspective';fov:number;aspect:number;near:number;far:number}
 | {kind:'translate'|'scale';x:number;y:number;z:number}
 | {kind:'rotate';axis:'x'|'z';angle:number};
export interface SourceProcessingContextSnapshot {
 readonly viewport:readonly number[];
 readonly projection:readonly number[];readonly modelview:readonly number[];readonly transform:readonly number[];
 /** Already in the GL upload order: rows of modelviewInv become columns. */
 readonly normalMatrix:readonly number[];
 readonly perspective:0|1;readonly scale:readonly number[];readonly lightCount:0;
}
export class SourceProcessingContextError extends Error {
 constructor(readonly kind:'input'|'state'|'capacity'|'arithmetic'|'unsupported',message:string){super(message);this.name='SourceProcessingContextError';}
}
export type SourceProcessingContextResult<T>={ok:true;value:T}|{ok:false;error:SourceProcessingContextError};
const F=Math.fround,identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const instances=new WeakSet<object>();
function demand(ok:unknown,kind:SourceProcessingContextError['kind'],message:string):asserts ok {if(!ok)throw new SourceProcessingContextError(kind,message);}
function attempt<T>(run:()=>T):SourceProcessingContextResult<T>{try{return{ok:true,value:run()};}catch(error){if(error instanceof SourceProcessingContextError)return{ok:false,error};if(error instanceof SourceProcessingMatrixError)return{ok:false,error:new SourceProcessingContextError('arithmetic',error.message)};throw error;}}
const scalar=(value:number)=>{demand(typeof value==='number'&&Number.isFinite(F(value)),'input','Processing scalar must be finite float32');return F(value);};
function dimensions(width:number,height:number){demand(Number.isInteger(width)&&width>0&&width<=2147483647&&Number.isInteger(height)&&height>0&&height<=2147483647,'input','Processing dimensions must be positive int32');}
type Matrices={modelview:number[];inverse:number[];camera:number[];cameraInverse:number[]};
const clone=(m:Matrices):Matrices=>({modelview:[...m.modelview],inverse:[...m.inverse],camera:[...m.camera],cameraInverse:[...m.cameraInverse]});
export class SourceProcessingContext {
 private width:number;private height:number;private sized=true;private ready=false;private drawing=false;private disposed=false;
 private projection=identity();private transform=identity();private matrices:Matrices={modelview:identity(),inverse:identity(),camera:identity(),cameraInverse:identity()};
 private eyeDistance=0;private viewport=[0,0,0,0];private hint6=false;private hint7=false;private stack:Matrices[]=[];
 private constructor(width:number,height:number){this.width=width;this.height=height;instances.add(this);}
 static create(width:number,height:number):SourceProcessingContextResult<SourceProcessingContext>{return attempt(()=>{dimensions(width,height);return new SourceProcessingContext(width,height);});}
 private check(){demand(!this.disposed,'state','Processing graphics owner was disposed');}
 private rebuild(){this.transform=[...this.projection];apply(this.transform,this.matrices.modelview);}
 private defaultPerspective(){
  const z=sourceProcessingDefaultCameraZ(F(this.height));
  this.projection=sourceProcessingPerspective(F(Math.PI/3),F(F(this.width)/F(this.height)),F(z/10),F(z*10));this.rebuild();
 }
 private camera(z:number){
  const modelview=sourceProcessingCameraMatrix(F(this.width),F(this.height),z),inverse=[...modelview];invert(inverse);
  this.matrices={modelview,inverse,camera:[...modelview],cameraInverse:[...inverse]};this.eyeDistance=F(Math.sqrt(F(z*z)));this.rebuild();
 }
 private preInverse(matrix:number[]){apply(matrix,this.matrices.inverse);this.matrices.inverse=matrix;}
 apply(event:SourceProcessingContextEvent):SourceProcessingContextResult<void>{return attempt(()=>{
  this.check();demand(event&&typeof event==='object','input','Processing event required');
  switch(event.kind){
   case 'resize':dimensions(event.width,event.height);this.width=event.width;this.height=event.height;this.sized=true;return;
   case 'hint':demand((event.index===6||event.index===7)&&typeof event.enabled==='boolean','input','Processing hint invalid');if(event.index===6)this.hint6=event.enabled;else this.hint7=event.enabled;return;
   case 'begin-draw':{
    demand(!this.drawing,'state','Processing beginDraw already active');
    if(this.sized){this.defaultPerspective();this.camera(sourceProcessingDefaultCameraZ(F(this.height)));this.sized=false;}
    else{this.matrices.modelview=[...this.matrices.camera];this.matrices.inverse=[...this.matrices.cameraInverse];this.rebuild();}
    this.viewport=[0,0,F(this.width),F(this.height)];this.drawing=true;this.ready=true;return;
   }
   case 'end-draw':demand(this.drawing,'state','Processing endDraw without beginDraw');this.drawing=false;return;
   case 'reset-matrix':this.matrices={modelview:identity(),inverse:identity(),camera:identity(),cameraInverse:identity()};this.transform=[...this.projection];return;
   case 'push-matrix':demand(this.stack.length<32,'capacity','Processing matrix stack exceeds 32');this.stack.push(clone(this.matrices));return;
   case 'pop-matrix':demand(this.stack.length>0,'state','Processing matrix stack is empty');this.matrices=this.stack.pop()!;this.rebuild();return;
   case 'default-camera':this.camera(sourceProcessingDefaultCameraZ(F(this.height)));return;
   case 'default-perspective':this.defaultPerspective();return;
   case 'camera':{const z=scalar(event.z);this.camera(z);return;}
   case 'perspective':{
    const fov=scalar(event.fov),aspect=scalar(event.aspect),near=scalar(event.near),far=scalar(event.far);
    this.projection=sourceProcessingPerspective(fov,aspect,near,far);this.rebuild();return;
   }
   case 'ortho':this.projection=sourceProcessingOrthographic(F(this.width),F(this.height),this.eyeDistance).values;this.rebuild();return;
   case 'translate':{
    const x=scalar(event.x),y=scalar(event.y),z=scalar(event.z),inverse=identity();inverse[3]=-x;inverse[7]=-y;inverse[11]=-z;
    translate(this.matrices.modelview,x,y,z);this.preInverse(inverse);translate(this.transform,x,y,z);return;
   }
   case 'scale':{
    const x=scalar(event.x),y=scalar(event.y),z=scalar(event.z),inverse=identity();inverse[0]=F(1/x);inverse[5]=F(1/y);inverse[10]=F(1/z);
    scale(this.matrices.modelview,x,y,z);this.preInverse(inverse);scale(this.transform,x,y,z);return;
   }
   case 'rotate':{
    demand(event.axis==='x'||event.axis==='z','input','Processing rotation axis invalid');const angle=scalar(event.angle);
    rotate(this.matrices.modelview,event.axis,angle);this.preInverse(sourceProcessingRotationMatrix(event.axis,-angle));this.rebuild();return;
   }
   default:throw new SourceProcessingContextError('input','Unknown Processing event');
  }
 });}
 snapshot():SourceProcessingContextResult<SourceProcessingContextSnapshot>{return attempt(()=>{
  this.check();demand(this.ready,'state','Processing graphics has not begun a frame');
  const p=this.projection,inv=this.matrices.inverse;
  // PGraphicsOpenGL zero/same use a strict FLOAT_EPS comparison.
  const ortho=[1,2,4,6,8,9,12,13,14].every(i=>Math.abs(p[i])<2**-23)&&Math.abs(F(p[15]-1))<2**-23;
  const displacement=F(.999),normal=[inv[0],inv[1],inv[2],inv[4],inv[5],inv[6],inv[8],inv[9],inv[10]];
  const values={viewport:[...this.viewport],projection:Array.from(pack([...p]).columnMajor),modelview:Array.from(pack([...this.matrices.modelview]).columnMajor),transform:Array.from(pack([...this.transform]).columnMajor),normalMatrix:normal,perspective:(this.hint7&&!ortho?1:0) as 0|1,scale:this.hint6?[1,1,1]:ortho?[1,1,displacement]:[displacement,displacement,displacement],lightCount:0 as const};
  for(const value of Object.values(values))if(Array.isArray(value)){demand(value.every(Number.isFinite),'arithmetic','Processing context contains nonfinite matrix values');Object.freeze(value);}
  return Object.freeze(values);
 });}
 dispose():void {this.disposed=true;this.stack=[];}
}
/** Own the first graphics object, including across scene/target changes. A new
 * shader instance creates a new binding; a new frame does not. */
export class SourceProcessingShaderContext {
 private graphics?:SourceProcessingContext;private disposed=false;
 bind(current:SourceProcessingContext|undefined):SourceProcessingContextResult<SourceProcessingContextSnapshot>{
  if(this.disposed)return{ok:false,error:new SourceProcessingContextError('state','Processing shader binding disposed')};
  if(!this.graphics){if(!current||!instances.has(current))return{ok:false,error:new SourceProcessingContextError('input','Processing graphics identity unknown')};this.graphics=current;}
  return this.graphics.snapshot();
 }
 dispose():void {this.disposed=true;this.graphics=undefined;}
}
