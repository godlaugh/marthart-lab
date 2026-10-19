import {JavaSourceRandom48} from './javaSourceRandom';
import {SourceProcessingNoise} from './sourceProcessingNoise';
import {sourcePerlinSeed} from './sourcePerlinSeed';
const F=Math.fround,PI=F(Math.PI),TAU=F(2*Math.PI);
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
/** At most two million Processing noise samples per update in VECTOR_FIELD.
 * Retained packed state is 21 bytes/particle; a diagnostic copy doubles it. */
export const SOURCE_PERLIN_PARTICLE_MAX_COUNT=250_000;
export class SourcePerlinParticleMotionError extends Error{
 constructor(readonly code:'input'|'nonfinite'|'capacity'|'cancelled'|'failed',message:string){super(message);this.name=code==='cancelled'?'AbortError':'SourcePerlinParticleMotionError';}
}
const finite=(v:number)=>{if(typeof v!=='number'||!Number.isFinite(F(v)))throw new SourcePerlinParticleMotionError('nonfinite','Perlin particle motion requires finite Float32 values.');return F(v);};
const dimensions=(w:number,h:number):readonly[number,number]=>{w=finite(w);h=finite(h);return w<200||h<200?[800,800]:[w,h];};
export interface SourcePerlinParticleMotionOptions{
 readonly seed:string|number;readonly count:number;readonly width:number;readonly height:number;
 readonly noise?:Pick<SourceProcessingNoise,'sample'>;readonly isCancelled?:()=>boolean;
}
export interface SourcePerlinParticleFrame{
 readonly time:number;readonly deltaTime:number;readonly width?:number;readonly height?:number;
 readonly noiseScale:number;readonly noiseOffset:number;readonly stepSize:number;readonly timeScale:number;readonly respawnRate:number;
 readonly flowMode:'ANGLE_FIELD'|'SWIRL_FIELD'|'VECTOR_FIELD';readonly angleMap:'LINEAR'|'SOFT_POWER';
}
/** Owns particle positions, direction and Processing random consumption only.
 * Caller owns source gradients/parameter updates before this step, and trails
 * after it. Failed updates poison this owner; no partial state is publishable. */
export class SourcePerlinParticleMotion{
 readonly count:number;readonly textureSeed:number;
 private readonly positions:Float32Array;private readonly velocities:Float32Array;
 private readonly steps:Float32Array;private readonly flags:Uint8Array;
 private readonly ownsNoise:boolean;
 private readonly random:JavaSourceRandom48;private readonly noise:Pick<SourceProcessingNoise,'sample'>;
 private readonly isCancelled?:()=>boolean;private failed=false;private draws=0;
 private width:number;private height:number;
 constructor(options:SourcePerlinParticleMotionOptions){
  if(!Number.isSafeInteger(options.count)||options.count<0)throw new SourcePerlinParticleMotionError('input','Perlin particle count must be a nonnegative integer.');
  if(options.count>SOURCE_PERLIN_PARTICLE_MAX_COUNT)throw new SourcePerlinParticleMotionError('capacity','Perlin particle motion exceeds the local count/work budget.');
  this.count=options.count;this.width=finite(options.width);this.height=finite(options.height);
  this.isCancelled=options.isCancelled;this.check();const seed=sourcePerlinSeed(options.seed);this.textureSeed=seed.textureSeed;
  this.random=new JavaSourceRandom48(seed.randomSeed);this.ownsNoise=options.noise===undefined;this.noise=options.noise??new SourceProcessingNoise(BigInt(this.textureSeed));
  this.positions=new Float32Array(this.count*2);this.velocities=new Float32Array(this.count*2);this.steps=new Float32Array(this.count);this.flags=new Uint8Array(this.count);
  const [width,height]=dimensions(this.width,this.height),hx=F(width*.5),hy=F(height*.5);
  for(let i=0;i<this.count;i++){
   this.check();this.positions[i*2]=this.randomRange(-hx,hx);this.positions[i*2+1]=this.randomRange(-hy,hy);
   const angle=this.randomHigh(TAU);this.velocities[i*2]=F(Math.cos(angle));this.velocities[i*2+1]=F(Math.sin(angle));
  }
 }
 private check(){if(this.isCancelled?.())throw new SourcePerlinParticleMotionError('cancelled','Perlin particle motion cancelled.');}
 private usable(){if(this.failed)throw new SourcePerlinParticleMotionError('failed','Perlin particle motion failed; rebuild before use.');this.check();}
 private draw(){this.check();if(++this.draws>this.count*8+1024)throw new SourcePerlinParticleMotionError('capacity','Processing random endpoint retries exceeded the local budget.');return this.random.nextFloat();}
 private randomHigh(high:number):number{if(high===0)return 0;let value:number;do{value=F(this.draw()*high);}while(value===high);return value;}
 private randomRange(low:number,high:number):number{if(low>=high)return low;let value:number;do{value=F(this.randomHigh(F(high-low))+low);}while(value===high);return value;}
 private particleNoise(x:number,y:number,z:number){
  const a=finite(this.noise.sample(x,y,z)),b=finite(this.noise.sample(finite(F(x*2)+F(17.31)),finite(F(y*2)+F(9.73)),finite(z*F(1.37))));
  return F(F(a*F(.72))+F(b*F(.28)));
 }
 update(frame:SourcePerlinParticleFrame):void{
  this.usable();try{
   if(!['ANGLE_FIELD','SWIRL_FIELD','VECTOR_FIELD'].includes(frame.flowMode)||!['LINEAR','SOFT_POWER'].includes(frame.angleMap))throw new SourcePerlinParticleMotionError('input','Unknown source Perlin flow or angle map.');
   const time=finite(frame.time),dt=Math.max(0,finite(frame.deltaTime)),noiseScale=finite(frame.noiseScale),noiseOffset=finite(frame.noiseOffset);
   const stepSize=finite(frame.stepSize),timeScale=finite(frame.timeScale),respawnRate=finite(frame.respawnRate);
   this.width=finite(frame.width??this.width);this.height=finite(frame.height??this.height);
   const [width,height]=dimensions(this.width,this.height);
   const hx=F(width*.5),hy=F(height*.5),baseStep=finite(F(stepSize*dt)*60),prob=Math.min(1,finite(respawnRate*dt));
   const sx=F(F((this.textureSeed&65535)/65535)*10),sy=F(F(((this.textureSeed>>>16)&65535)/65535)*10);
   const offset=finite(noiseOffset*TAU),nz=finite(time*timeScale);
   const map=(n:number)=>frame.angleMap==='SOFT_POWER'?F(Math.pow(clamp(n,0,1),1.5)):clamp(n,0,1);
   this.draws=0;this.flags.fill(0);
   for(let i=0;i<this.count;i++){
    this.check();const k=i*2;let x=this.positions[k],y=this.positions[k+1],vx=this.velocities[k],vy=this.velocities[k+1],step=baseStep;
    const nx=finite(sx+F(F(F(x+hx)/Math.max(1,width))*noiseScale)),ny=finite(sy+F(F(F(y+hy)/Math.max(1,height))*noiseScale));
    if(frame.flowMode==='VECTOR_FIELD'){
     const e=clamp(F(F(.65)/Math.max(1,noiseScale)),F(.015),F(.08));
     const gx=F(F(this.particleNoise(finite(nx+e),ny,nz)-this.particleNoise(finite(nx-e),ny,nz))/F(2*e));
     const gy=F(F(this.particleNoise(nx,finite(ny+e),nz)-this.particleNoise(nx,finite(ny-e),nz))/F(2*e));
     const mag=finite(Math.sqrt(F(F(gx*gx)+F(gy*gy))));let cx=vx,cy=vy;
     if(mag>F(.0001)){cx=F(gy/mag);cy=F(-gx/mag);}else if(F(F(cx*cx)+F(cy*cy))<F(.0001)){cx=1;cy=0;}
     if(frame.angleMap!=='LINEAR'){
      const a=F(Math.atan2(cy,cx)),mapped=map(F(F(a+PI)/TAU)),angle=F(F(mapped*TAU)+offset);cx=F(Math.cos(angle));cy=F(Math.sin(angle));
     }else if(Math.abs(noiseOffset)>F(.0001)){const angle=F(F(Math.atan2(cy,cx))+offset);cx=F(Math.cos(angle));cy=F(Math.sin(angle));}
     if(F(F(vx*vx)+F(vy*vy))<F(.0001)){vx=cx;vy=cy;}
     const t=clamp(F(mag*2),0,1),s=F(F(t*t)*F(3-F(2*t))),blend=F(F(.18)+F(F(.36)*s));
     vx=F(vx+F(F(cx-vx)*blend));vy=F(vy+F(F(cy-vy)*blend));
     const length=finite(Math.sqrt(F(F(vx*vx)+F(vy*vy))));
     if(length>F(.0001)){vx=F(vx/length);vy=F(vy/length);}else{vx=cx;vy=cy;}
     step=finite(baseStep*F(F(.9)+F(F(.2)*s)));
    }else{
     const mapped=F(map(this.particleNoise(nx,ny,nz))*TAU);
     const angle=finite((frame.flowMode==='SWIRL_FIELD'?F(F(Math.atan2(y,x))+mapped):mapped)+offset);
     vx=F(Math.cos(angle));vy=F(Math.sin(angle));
    }
    x=finite(x+F(vx*step));y=finite(y+F(vy*step));
    if(x< -hx){x=hx;this.flags[i]|=1;}else if(x>hx){x=-hx;this.flags[i]|=1;}
    if(y< -hy){y=hy;this.flags[i]|=1;}else if(y>hy){y=-hy;this.flags[i]|=1;}
    if(prob>0&&this.randomHigh(1)<prob){x=this.randomRange(-hx,hx);y=this.randomRange(-hy,hy);this.flags[i]|=2;}
    this.positions[k]=x;this.positions[k+1]=y;this.velocities[k]=finite(vx);this.velocities[k+1]=finite(vy);this.steps[i]=step;
   }
  }catch(error){this.failed=true;throw error;}
 }
 snapshot(){this.usable();return{positions:this.positions.slice(),velocities:this.velocities.slice(),actualSteps:this.steps.slice(),flags:this.flags.slice(),randomState48:this.random.state48.toString(),width:this.width,height:this.height};}
 diagnostics(){this.usable();return{count:this.count,particleStateBytes:this.count*21,retainedBytes:this.count*21+(this.ownsNoise?4096*4:0),randomState48:this.random.state48.toString()};}
}
