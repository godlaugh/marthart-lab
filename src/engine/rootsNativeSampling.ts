import {JavaSourceRandom48} from './javaSourceRandom';
import type {RootNativeParameter,RootsMathConfiguration} from '../types';
import {isJavaBlank,javaTrim} from './sourceJavaText';
import {parseRootsSignedLongText} from './rootsSourceOrder';
import {prepareRootsWorkerPartitions,type RootsWorkerPartitionPlan} from './rootsSourceRandom';
import {RootsNativeError,rootsNativeAttempt,rootsNativeCheck,type RootsNativeResult,type RootsNativeScope,type RootsNativeWorkHooks} from './rootsNativeExpression';

export interface RootsNativeSample {
  readonly ordinal:number;
  readonly workerIndex:number;
  readonly workerSampleOrdinal:number;
  /** Borrowed until the next sample/reset/dispose, including a failed call. */
  readonly values:RootsNativeScope;
  readonly passesFilter:boolean;
}
export interface PreparedRootsNativeSampling {
  readonly partitions:RootsWorkerPartitionPlan;
  readonly drawsPerSample:number;
  readonly names:readonly string[];
  /** Normalized sampling definitions; the last trimmed-name collision wins. */
  readonly bindings:ReadonlyMap<string,Readonly<RootNativeParameter>>;
  readonly filter:'all'|'t2-imaginary-nonnegative';
  sampleAt(ordinal:number,hooks?:RootsNativeWorkHooks):RootsNativeResult<RootsNativeSample>;
  reset():void;
  dispose():void;
  diagnostics():{definitions:number;bindings:number;randomInstances:number;nextOrdinal:number|null};
}
/** Source parameter stream, ordered by the already-resolved definition list.
 * Original workers race to enqueue batches. Our replay visits global ordinals
 * in a stable order, preserving each worker's sample stream, not arrival time. */
export function prepareRootsNativeSampling(
  parameters:readonly RootNativeParameter[],
  sampling:RootsMathConfiguration['sampling'],
  hooks:RootsNativeWorkHooks={},
):RootsNativeResult<PreparedRootsNativeSampling> {
  return rootsNativeAttempt(()=>{
    rootsNativeCheck(hooks);
    const seed=parseRootsSignedLongText(sampling.seed);
    if(!seed.ok)throw new RootsNativeError(seed.error.kind==='capacity'?'capacity':'input','Invalid source Roots signed-long seed',seed.error.kind==='capacity'?{resource:seed.error.resource,actual:seed.error.actual,limit:seed.error.limit}:{});
    const partitionResult=prepareRootsWorkerPartitions(sampling.sampleCount,sampling.workerCount,seed.value);
    if(!partitionResult.ok)throw new RootsNativeError('input',partitionResult.error.reason,{field:partitionResult.error.field});
    const partitions=partitionResult.value,values=new Map<string,[number,number]>();
    let drawsPerSample=0;
    let definitions=parameters.map(row=>{
      rootsNativeCheck(hooks,1);
      // isBlank precedes trim in the source constructor. A nonblank NUL-only
      // name therefore becomes an empty key; do not replace this with JS trim.
      if(isJavaBlank(row.name))throw new RootsNativeError('input','Source Roots parameter name must not be blank');
      const name=javaTrim(row.name),out:[number,number]=[0,0];
      if(!['UNIT_CIRCLE','REAL_RANGE','COMPLEX_RECT','FIXED'].includes(row.domain))throw new RootsNativeError('input','Unprepared source Roots parameter domain');
      const draws=row.domain==='FIXED'?0:row.domain==='COMPLEX_RECT'?2:1;
      drawsPerSample+=draws;
      values.set(name,out); // Last trimmed-name collision wins, after all draws.
      return{name,domain:row.domain,minRe:Math.min(row.minRe,row.maxRe),maxRe:Math.max(row.minRe,row.maxRe),minIm:Math.min(row.minIm,row.maxIm),maxIm:Math.max(row.minIm,row.maxIm),fixed:[...row.value] as [number,number],out};
    });
    const names=Object.freeze([...values.keys()]);
    const bindings=new Map<string,Readonly<RootNativeParameter>>();
    for(const row of definitions)bindings.set(row.name,Object.freeze({name:row.name,domain:row.domain,minRe:row.minRe,maxRe:row.maxRe,minIm:row.minIm,maxIm:row.maxIm,value:[...row.fixed] as [number,number]}));
    const filterText=sampling.filter.replaceAll(' ','').toLowerCase();
    const filter=filterText==='im(t2)>=0'||filterText==='t2.im>=0'?'t2-imaginary-nonnegative' as const:'all' as const;
    let rng:JavaSourceRandom48|undefined,workerIndex=-1,nextOrdinal:number|null=null,disposed=false;
    const reset=()=>{rng=undefined;workerIndex=-1;nextOrdinal=null;for(const row of definitions)row.out.fill(0);};
    return{
      partitions,drawsPerSample,names,bindings,filter,
      sampleAt(ordinal:number,work:RootsNativeWorkHooks={}):RootsNativeResult<RootsNativeSample>{
        return rootsNativeAttempt(()=>{
          if(disposed)throw new RootsNativeError('input','Source Roots sampler was disposed');
          if(!Number.isInteger(ordinal)||ordinal<0||ordinal>=partitions.sampleCount)throw new RootsNativeError('input','Source Roots sample ordinal is outside the prepared ensemble',{ordinal});
          rootsNativeCheck(work);
          const partition=partitions.partitionForSample(ordinal);
          if(!rng||partition.index!==workerIndex||ordinal!==nextOrdinal){
            rng=new JavaSourceRandom48(partition.seed);
            rng.skipDraws(BigInt(ordinal-partition.start)*BigInt(drawsPerSample));
            workerIndex=partition.index;
          }
          nextOrdinal=null;
          for(const row of definitions){
            rootsNativeCheck(work,1);
            const next=()=>{rootsNativeCheck(work,2);return rng!.nextDouble();};
            let real:number,imag:number;
            switch(row.domain){
              case 'UNIT_CIRCLE':{const angle=(next()*Math.PI)*2;real=Math.cos(angle);imag=Math.sin(angle);break;}
              case 'REAL_RANGE':real=row.minRe+next()*(row.maxRe-row.minRe);imag=0;break;
              case 'COMPLEX_RECT':real=row.minRe+next()*(row.maxRe-row.minRe);imag=row.minIm+next()*(row.maxIm-row.minIm);break;
              case 'FIXED':real=row.fixed[0];imag=row.fixed[1];break;
            }
            // ComplexNumber canonicalizes signed zero, but retains nonfinite
            // arithmetic for the expression/finite-root admission boundaries.
            row.out[0]=real===0?0:real;row.out[1]=imag===0?0:imag;
          }
          rootsNativeCheck(work);
          nextOrdinal=ordinal+1;
          const t2=values.get('t2');
          return{ordinal,workerIndex:partition.index,workerSampleOrdinal:ordinal-partition.start,values,passesFilter:filter==='all'||!!t2&&t2[1]>=0};
        });
      },
      reset,
      dispose(){reset();definitions=[];values.clear();bindings.clear();disposed=true;},
      diagnostics(){return{definitions:definitions.length,bindings:values.size,randomInstances:rng?1:0,nextOrdinal};},
    };
  });
}
