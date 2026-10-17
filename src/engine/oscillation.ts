import type {OscillationEdgeEasing,ParameterAnimation} from '../types';
export const OSCILLATION_FPS=60;
const TAU=2*Math.PI;
const wrap=(v:number)=>((v%TAU)+TAU)%TAU;
export function validateOscillationRange(value:Pick<ParameterAnimation,'model'|'min'|'max'|'step'|'phase'>):void{
 if(value.model!==undefined&&value.model!=='domain-1.7.8')throw new Error('未知参数振荡模型');
 if(![value.min,value.max,value.step].every(Number.isFinite)||value.model===undefined&&value.max<value.min)throw new Error('参数振荡目标或范围无效');
 if(value.phase!==undefined&&!Number.isFinite(value.phase))throw new Error('参数振荡相位或取整无效');
 if(value.model==='domain-1.7.8'&&value.phase!==undefined)throw new Error('原产物 Domain 振荡相位由启动时参数值计算');
}
export interface PreparedParameterOscillation {readonly minimum:number;readonly maximum:number;readonly middle:number;readonly half:number;readonly phase:number;readonly rate:number;}
/** Sole range/phase owner. Source Domain retains endpoint order in the document,
 * sorts at execution, and chooses an out-of-range starting endpoint by step sign.
 * This is a deterministic 60 Hz reference, not the native live frame clock. */
export function prepareParameterOscillation(value:Pick<ParameterAnimation,'model'|'min'|'max'|'step'|'phase'>,initial:number):PreparedParameterOscillation{
 validateOscillationRange(value);if(!Number.isFinite(initial))throw new Error('振荡起始值必须有限');
 const source=value.model==='domain-1.7.8';
 // Source JSON action construction uses getJsonFloat, then f2d into the
 // animator. Preserve authored doubles in the document, quantize only here.
 const rawMin=source?Math.fround(value.min):value.min,rawMax=source?Math.fround(value.max):value.max,step=source?Math.fround(value.step):value.step;
 if(![rawMin,rawMax,step].every(Number.isFinite))throw new Error('参数振荡范围超出可表示范围');
 const minimum=source?Math.min(rawMin,rawMax):rawMin,maximum=source?Math.max(rawMin,rawMax):rawMax;
 const span=maximum-minimum,middle=(maximum+minimum)/2,half=span/2;
 if(![span,middle,half].every(Number.isFinite))throw new Error('参数振荡范围超出可表示范围');
 if(source&&span<=1e-6)return Object.freeze({minimum,maximum,middle:minimum,half:0,phase:0,rate:0});
 const start=source&&(initial<minimum||initial>maximum)?step<0?maximum:minimum:initial;
 let phase=value.phase??(half?Math.asin(Math.max(-1,Math.min(1,(start-middle)/half))):0);
 if(source&&step<0)phase=Math.PI-phase;
 const rate=source?Math.abs(step)*OSCILLATION_FPS/half:step;
 if(!Number.isFinite(rate))throw new Error('振荡相位速度超出可表示范围');
 return Object.freeze({minimum,maximum,middle,half,phase,rate});
}
export const DEFAULT_EDGE_EASING:OscillationEdgeEasing={window:.5,floor:.25,easing:'sine-out'};
export function parseOscillationEdge(value:OscillationEdgeEasing):OscillationEdgeEasing{
 if(!value||!Number.isFinite(value.window)||!Number.isFinite(value.floor)||typeof value.easing!=='string')throw new Error('振荡端点减速配置无效');
 return{window:Math.max(1e-6,value.window),floor:Math.max(0,Math.min(1,value.floor)),easing:value.easing};
}
export function edgeSpeedScale(phase:number,config:OscillationEdgeEasing,curve:(t:number)=>number,sourceFloat=false):number{
 const distance=Math.abs(((wrap(phase)+Math.PI/2)%Math.PI)-Math.PI/2),q=Math.min(1,(Math.PI/2-distance)/config.window);
 const argument=Math.max(0,q),eased=sourceFloat?Math.fround(curve(Math.fround(argument))):curve(argument);
 return config.floor+(1-config.floor)*eased;
}
/** Deterministic reference replay, using source Euler phase updates at 60 Hz.
 * The clock is integrated animation-speed time, so attack/release timing stays
 * continuous. Fractional samples never become future state. Each oscillator
 * keeps at most 128 numeric checkpoints; random seeking can replay from zero. */
export class EdgePhaseTimeline {
 private checkpoints=new Map<number,number>([[0,0]]);
 private readonly edge:OscillationEdgeEasing;
 constructor(private readonly initial:number,private readonly rate:number,config:OscillationEdgeEasing,private readonly curve:(t:number)=>number,private readonly sourceFloat=false){
  if(!Number.isFinite(initial)||!Number.isFinite(rate))throw new Error('振荡相位必须有限');this.edge=parseOscillationEdge(config);this.checkpoints.set(0,wrap(initial));
 }
 sample(seconds:number):number{
  if(!Number.isFinite(seconds)||Math.abs(seconds)>86400)throw new Error('振荡有效时钟超出单日时间线范围');
  // Negative eased time and speed can occur for overshooting easing curves.
  const direction=seconds<0?-1:1,ticks=Math.floor(Math.abs(seconds)*OSCILLATION_FPS),fraction=Math.abs(seconds)*OSCILLATION_FPS-ticks;
  if(this.rate===0)return wrap(this.initial);
  const cache=direction>0?this.checkpoints:new Map<number,number>([[0,wrap(this.initial)]]);
  let tick=0,phase=wrap(this.initial);for(const [at,value]of cache)if(at<=ticks&&at>=tick){tick=at;phase=value;}
  const step=direction*this.rate/OSCILLATION_FPS;
  for(;tick<ticks;tick++){
   const next=wrap(phase+step*edgeSpeedScale(phase,this.edge,this.curve,this.sourceFloat));
   if(!Number.isFinite(next))throw new Error('振荡相位溢出');
   if(next===phase){tick=ticks;break;}phase=next;
   if((tick+1)%3600===0){cache.set(tick+1,phase);this.trim(cache);}
  }
  cache.set(ticks,phase);this.trim(cache);
  return wrap(phase+fraction*step*edgeSpeedScale(phase,this.edge,this.curve,this.sourceFloat));
 }
 private trim(cache:Map<number,number>){while(cache.size>128){const key=[...cache.keys()].find(key=>key!==0)!;cache.delete(key);}}
 diagnostics(){return{checkpoints:this.checkpoints.size,numericBytes:this.checkpoints.size*16};}
}
