import type {SymmetryParameters} from './iterated';

/** Retained 1.7.8 ParameterRandomizer.evaluateCandidate contract. This CPU
 * search uses fixed double-precision probe orbits, not rendered particle RNG,
 * GPU precision or a promise of long-term stability. */
export interface SymmetryCandidateMetrics {
 model:'mathart-1.7.8-search-v1';score:number;accepted:boolean;
 finiteRatio:number;visibleRatio:number;coverageRatio:number;occupied:number;
 center:[number,number]|null;centerOffset:number|null;
 sampled:number;reason:'warmup-diverged'|'thresholds'|null;
}
const WARMUP=80,SAMPLES=2200,GRID=72,VIEW=3.2,MAX_RADIUS_SQUARED=28*28;
const SEEDS:readonly (readonly [number,number])[]=[[.001,.002],[.11,-.07]];
const cancelled=(check?:()=>boolean)=>{if(check?.())throw new Error('对称探索已取消');};

/** The reference search multiplies complex powers in double precision. The
 * existing renderer expresses the same polynomial in polar form; rounding can
 * separate chaotic trajectories. Reference search also suppresses the modified
 * radial term below r²=1e-12, unlike its own GPU shader's unit-complex branch.
 * Keep this search-only numerical contract out of persisted render semantics. */
export function symmetrySearchStep(x:number,y:number,p:SymmetryParameters):[number,number] {
 const norm=x*x+y*y;let real=x,imaginary=y;
 for(let i=0;i<p.n-2;i++){const nextReal=real*x-imaginary*y;imaginary=imaginary*x+real*y;real=nextReal;}
 const zn=x*real-y*imaginary,delta=p.template==='modified'?(p.delta??0):0;
 const radial=delta!==0&&norm>1e-12?Math.sqrt(norm)*Math.cos(p.n*(p.deltaPower??1)*Math.atan2(y,x)):0;
 const gain=p.lambda+p.alpha*norm+p.beta*zn+delta*radial;
 return[gain*x+p.gamma*real-p.omega*y,gain*y-p.gamma*imaginary+p.omega*x];
}

/** Receives validated candidate parameters from exploreSymmetry. Sampling is
 * fixed by the source diagnostic, not by caller render counts or view fitting. */
export function evaluateSymmetryCandidate(p:SymmetryParameters,isCancelled?:()=>boolean):SymmetryCandidateMetrics {
 const cells=new Uint8Array(GRID*GRID);let finite=0,visible=0,occupied=0,sumX=0,sumY=0,sampled=0;
 for(const seed of SEEDS){
  let [x,y]=seed;
  for(let i=0;i<WARMUP;i++){
   if((i&31)===0)cancelled(isCancelled);
   [x,y]=symmetrySearchStep(x,y,p);
   if(!Number.isFinite(x)||!Number.isFinite(y)||x*x+y*y>MAX_RADIUS_SQUARED)
    return{model:'mathart-1.7.8-search-v1',score:-1,accepted:false,finiteRatio:finite/(SAMPLES*SEEDS.length),visibleRatio:finite?visible/finite:0,coverageRatio:occupied/(GRID*GRID),occupied,center:null,centerOffset:null,sampled,reason:'warmup-diverged'};
  }
  for(let i=0;i<SAMPLES;i++){
   if((i&31)===0)cancelled(isCancelled);
   [x,y]=symmetrySearchStep(x,y,p);sampled++;
   // The source continues stepping after a bad sample. It neither reseeds nor
   // counts a finite position outside radius 28 as a finite accepted sample.
   if(!Number.isFinite(x)||!Number.isFinite(y)||x*x+y*y>MAX_RADIUS_SQUARED)continue;
   finite++;if(Math.abs(x)>VIEW||Math.abs(y)>VIEW)continue;
   visible++;sumX+=x;sumY+=y;
   const gx=Math.max(0,Math.min(GRID-1,Math.trunc((x+VIEW)/(2*VIEW)*GRID))),gy=Math.max(0,Math.min(GRID-1,Math.trunc((y+VIEW)/(2*VIEW)*GRID))),index=gy*GRID+gx;
   if(!cells[index]){cells[index]=1;occupied++;}
  }
 }
 const finiteRatio=finite/(SEEDS.length*SAMPLES),visibleRatio=finite?visible/finite:0,coverageRatio=occupied/(GRID*GRID);
 const center: [number,number]|null=visible?[sumX/visible,sumY/visible]:null;
 const offset=center?Math.sqrt(center[0]*center[0]+center[1]*center[1]):Infinity;
 const accepted=finiteRatio>=.99&&visibleRatio>=.3&&coverageRatio>=.003&&coverageRatio<=.28&&offset<=1.8;
 const fitness=Math.exp(-Math.abs(Math.log((coverageRatio+1e-6)/.05)));
 const score=.45*fitness+.35*visibleRatio+.2*finiteRatio-.12*Math.min(offset,6)-(accepted?0:.25);
 return{model:'mathart-1.7.8-search-v1',score,accepted,finiteRatio,visibleRatio,coverageRatio,occupied,center,centerOffset:center?offset:null,sampled,reason:accepted?null:'thresholds'};
}
