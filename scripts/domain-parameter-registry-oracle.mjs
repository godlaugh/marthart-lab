// Independent transcription of the retained registry/animator lifecycle.
// No production imports. Fixtures use neutral/default edge easing and linear ramps;
// this isolates registry semantics from separately verified easing functions.
// Clock: local deterministic 60 Hz plus event/finish boundaries, float dt.
export const registryOracleScope = {
 source: '.cache/domain-parameter-import-next-audit.json',
 sourceSha256: '3457c8634886e0b7d75b12ab1fba3c88245c61e272346a01c044bc656c8633af',
 kind: 'source-derived independent reference; original application not executed',
 edge: {window:.5,floor:1,easing:'linear'},
 limitations: ['Neutral-edge and source default sine-out edge; linear action ramps only.', '60 Hz is the declared local replay clock, not a measurement of original live/offline cadence.'],
};
const all = undefined;
const start=(name=all,min=-1,max=1,step=.1)=>({method:'paramStart',name,...(name===undefined?{}:{min,max,step})});
const stop=(name=all)=>({method:'paramStop',name});
const group=(at,operations,duration=0)=>({at,duration,operations});
const names=['a.b','a_b','aB','__proto__','constructor','prototype','中文','\u00a0','\u0000','   ','Scale',' scale '];
export const registryFixtures = [
 {id:'empty-all',groups:[group(0,[start()])],times:[0,.1,1]},
 {id:'dt-zero-outside',parameters:{a:8},groups:[group(0,[start('a',-1,1,.02)])],times:[0,1/60,.037,1]},
 {id:'named-stop-resume-held-phase',groups:[group(0,[start('a')]),group(.5,[stop('a')]),group(1,[start()])],times:[0,.5,.75,1,1.1]},
 {id:'all-stop-resync-phase',groups:[group(0,[start('a')]),group(.5,[stop()]),group(1,[start()])],times:[0,.5,.75,1,1.1]},
 {id:'already-running-all-no-sync',groups:[group(0,[start('a')]),group(.5,[start()])],times:[0,.5,.75,1]},
 {id:'named-restart-replaces-range',groups:[group(0,[start('a')]),group(.5,[stop('a')]),group(.75,[start('a',-2,3,-.02)])],times:[0,.5,.75,1,1.1]},
 {id:'same-group-last-config',parameters:{a:8},groups:[group(0,[start('a',-2,2,.02),start('a',-3,3,-.02)])],times:[0,1/60,.037,1]},
 {id:'same-group-start-stop',groups:[group(0,[start('a'),stop('a')])],times:[0,.1,1]},
 {id:'same-group-stop-start',groups:[group(0,[stop('a'),start('a')])],times:[0,.1,1]},
 {id:'same-group-all-stop-then-start',groups:[group(0,[start('a')]),group(.5,[stop(),start('a')])],times:[0,.5,.75,1]},
 {id:'stop-all-captures-then-finally-stops-new-name',groups:[group(0,[start('a')]),group(.5,[stop()],1),group(.75,[start('b')])],times:[0,.75,1,1.5,2]},
 {id:'start-all-gain-includes-later-name',groups:[group(0,[start('a')]),group(.25,[stop()]),group(.5,[start()],1),group(.75,[start('b')])],times:[0,.75,1,1.5]},
 {id:'unknown-stop-does-not-register',groups:[group(0,[start('a'),stop('unknown')]),group(.5,[stop('a')]),group(1,[start()])],times:[0,.5,1,1.2]},
 {id:'unknown-name-first-positive-write',groups:[group(0,[start('new.name',2,3,.01)])],times:[0,1/60,.1]},
 {id:'exact-own-and-blank-keys',parameters:Object.fromEntries(names.map((name,i)=>[name,i+10])),groups:[group(0,names.map(name=>start(name,2,2,.01)))],times:[0,.1,1]},
 {id:'special-bindings-win-over-formula-map',parameters:{scale:77,phaseDensity:88,modDensity:99,phaseSharpness:66,modSharpness:55},settings:{scale:4,phaseDensity:20,modDensity:10,phaseSharpness:2,modSharpness:3},groups:[group(0,[start('scale',.5,.5,0),start('phaseDensity',3,3,0),start('modDensity',4,4,0),start('phaseSharpness',.7,.7,0),start('modSharpness',.8,.8,0)])],times:[0,.1,1]},
 {id:'special-positive-defaults-and-full-curve-normalize',settings:{phaseDensity:20,modDensity:10,modSharpness:-3,curveBias:5,curveMix:-1},groups:[group(0,[start('phaseDensity',-2,-2,0)])],times:[0,.1,1]},
 {id:'fractional-boundaries',groups:[group(0,[start('a',-1,1,.02)]),group(.55,[stop('a')],.2),group(1,[start()])],times:[0,.037,.55,.75,1.2,2]},
];
export function registryTracks(fixture) {
 return fixture.groups.map((g,i)=>({id:'registry-track-'+i,type:'animate',target:'camera.actions',from:0,to:0,pingPong:false,repeat:1,enabled:true,start:g.at,duration:g.duration,easing:'linear',actions:g.operations.map((op,j)=>({id:`registry-action-${i}-${j}`,method:op.method,domainParameters:[{model:'domain-registry-1.7.8',scope:op.name===undefined?{kind:'all'}:{kind:'named',name:op.name},...(op.method==='paramStart'&&op.name!==undefined?{configuration:{min:op.min,max:op.max,step:op.step,edgeEasing:{window:.5,floor:1,easing:'linear'}}}:{})}]}))}));
}
const defaults={phaseDensity:12,modDensity:8,phaseSharpness:1,modSharpness:1},tau=2*Math.PI;
const own=(object,key)=>Object.hasOwn(object,key);
// Java String.isBlank is Character.isWhitespace over UTF-16/codepoints, not
// JS trim. In particular NBSP, figure/narrow NBSP and NUL are not blank.
const blank=name=>name.length===0||/^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]*$/u.test(name);
const positive=(x,fallback)=>Number.isFinite(Math.fround(x))&&Math.fround(x)>0?Math.fround(x):fallback;
export function registryReference(fixture,time,initial) {
 const parameters=Object.fromEntries(Object.entries(initial.parameters)),settings={...initial.settings},entries=new Map(),active=[];
 let running=false,now=0,nextGroup=0;
 const read=name=>blank(name)?undefined:name==='scale'?Math.max(1e-9,settings.scale??2.5):own(defaults,name)?positive(settings[name]??defaults[name],defaults[name]):own(parameters,name)?parameters[name]:undefined;
 const write=(name,value)=>{
  if(blank(name))return undefined;
  if(name==='scale'){settings.scale=Math.max(1e-9,value);return settings.scale;}
  if(own(defaults,name)){
   const previous=read(name);for(const key of Object.keys(defaults))settings[key]=positive(settings[key]??defaults[key],defaults[key]);
   settings.curveMode??='PHASE_MODULUS';settings.curveBias=Math.max(-1,Math.min(1,Math.fround(settings.curveBias??.15)));settings.curveMix=Math.max(0,Math.min(1,Math.fround(settings.curveMix??1)));
   settings[name]=positive(Number.isFinite(value)&&Number.isFinite(Math.fround(value))?value:previous,defaults[name]);return settings[name];
  }
  Object.defineProperty(parameters,name,{value,writable:true,configurable:true,enumerable:true});return value;
 };
 const sync=(entry,value)=>{
  const {minimum:lo,maximum:hi,middle,half,step}=entry;
  let seed=value??lo;if(seed<lo||seed>hi)seed=step<0?hi:lo;
  entry.phase=half?Math.asin(Math.max(-1,Math.min(1,(seed-middle)/half))):0;
  if(half&&step<0)entry.phase=Math.PI-entry.phase;
 };
 const startGroup=g=>{
  const readings=new Map([...entries.keys(),...g.operations.flatMap(op=>op.name===undefined?[]:[op.name])].map(name=>[name,read(name)]));
  for(const entry of entries.values())entry.value=readings.get(entry.name);
  for(const op of g.operations){
   if(op.method==='paramStart'){
    if(op.name!==undefined){
     const lo=Math.min(Math.fround(op.min),Math.fround(op.max)),hi=Math.max(Math.fround(op.min),Math.fround(op.max)),thin=hi-lo<=1e-6;
     const entry={name:op.name,minimum:lo,maximum:hi,middle:thin?lo:(lo+hi)/2,half:thin?0:(hi-lo)/2,step:Math.fround(op.step),edge:op.edge??'neutral',phase:0,gain:1,value:readings.get(op.name),written:entries.get(op.name)?.written??false};
     entries.set(op.name,entry);if(running)sync(entry,readings.get(op.name));
    }
    if(!running){for(const entry of entries.values())sync(entry,readings.get(entry.name));running=true;}
    for(const entry of entries.values())if(op.name===undefined||op.name===entry.name)entry.gain=0;
    active.push({g,op});
   }else if(running){
    const selected=op.name===undefined?[...entries.keys()]:[op.name];
    active.push({g,op,captured:new Map(selected.map(name=>[name,entries.get(name)?.gain??1]))});
   }
  }
 };
 const effects=at=>{
  const keep=[];
  for(const effect of active){
   const {g,op}=effect,finished=at>=g.at+g.duration,progress=Math.fround(g.duration===0?1:Math.max(0,Math.min(1,(at-g.at)/g.duration)));
   if(op.method==='paramStart'){for(const entry of entries.values())if(op.name===undefined||op.name===entry.name)entry.gain=finished?1:progress;}
   else {for(const [name,gain]of effect.captured){const entry=entries.get(name);if(entry)entry.gain=finished?0:gain*Math.max(0,1-progress);}if(finished&&op.name===undefined){running=false;for(const entry of entries.values())entry.gain=0;}}
   if(!finished)keep.push(effect);
  }
  active.splice(0,active.length,...keep);
 };
 const arrivals=()=>{let arrived=false;while(nextGroup<fixture.groups.length&&fixture.groups[nextGroup].at<=now){startGroup(fixture.groups[nextGroup++]);arrived=true;}if(arrived)effects(now);};
 arrivals();
 while(now<time){
  const nextEvent=fixture.groups[nextGroup]?.at??Infinity,nextEnd=Math.min(Infinity,...active.map(a=>a.g.at+a.g.duration));
  const moving=running&&[...entries.values()].some(e=>e.gain!==0&&e.step!==0&&e.half!==0);
  // Advance on the global grid, never cache a user-request fraction.
  let tick=(Math.floor(now*60)+1)/60;if(tick<=now)tick=(Math.floor(now*60)+2)/60;
  const at=Math.min(time,nextEvent,nextEnd,moving||active.length?tick:Infinity),dt=Math.fround(at-now);
  effects(at);
  if(dt>0&&running)for(const entry of entries.values()){
   if(entry.half){
    let speed=1;
    if(entry.edge==='source-default'){
     const wrapped=((entry.phase%tau)+tau)%tau,distance=Math.abs(((wrapped+Math.PI/2)%Math.PI)-Math.PI/2);
     const q=Math.fround(Math.max(0,Math.min(1,(Math.PI/2-distance)/.5)));
     speed=.25+.75*Math.fround(Math.sin(q*Math.PI/2));
    }
    entry.phase+=Math.abs(entry.step)*entry.gain*speed/entry.half*(dt*60);while(entry.phase>tau)entry.phase-=tau;while(entry.phase<0)entry.phase+=tau;
   }
   const value=write(entry.name,entry.half?entry.middle+entry.half*Math.sin(entry.phase):entry.minimum);
   if(value!==undefined){entry.value=value;entry.written=true;}
  }
  now=at;arrivals();
 }
 return{time,running,entries:[...entries.values()].map(({middle,half,edge,...e})=>e),parameters,settings};
}
