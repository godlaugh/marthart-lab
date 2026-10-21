import {build,stop} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const directory=resolve('.cache/surface-live-cost-'+Date.now()),baseline='c5cba4187c4672900e4eb1567593ddcc86670ca8';await mkdir(directory);await mkdir(directory+'/before');
execFileSync('tar',['-xf','-','-C',directory+'/before'],{input:execFileSync('git',['archive',baseline,'src'],{maxBuffer:32*1024*1024})});
const hashes={},sha=b=>createHash('sha256').update(b).digest('hex');
for(const variant of ['before','after']){
 const result=await build({stdin:{contents:"export {generateSourceSurface} from './src/scenes/sourceSurface';export {parseProjectFile} from './src/engine/legacyImport';export {ordinarySourceViewport} from './src/engine/ordinarySourceCamera';"+(variant==='after'?"export {SourceSurfaceLiveSession} from './src/engine/sourceSurfaceLiveSession';":''),resolveDir:variant==='before'?directory+'/before':process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',metafile:true,outfile:directory+'/'+variant+'.mjs'});
 for(const file of Object.keys(result.metafile.inputs))if(file!=='<stdin>')hashes[resolve(file)]=sha(await readFile(file));
}
stop();
const runner=directory+'/run.mjs';await writeFile(runner,`
import {createHash} from 'node:crypto';
const [variant,backend,mode]=process.argv.slice(2),api=await import('./'+variant+'.mjs');
const results=[];
for(let repeat=0;repeat<3;repeat++){
 const cpu=process.cpuUsage(),start=performance.now(),hash=createHash('sha256');
 const scene=api.parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'cost',equations:{x:'a+u',y:'v',z:'sin(u+v)'},parameters:{a:.25},settings:{render_mode:backend,surface_mode:mode,u_segments:32,v_segments:24,mesh_u_segments:32,mesh_v_segments:24,u_min:0,u_max:1,v_min:0,v_max:1,speed_u:.1,speed_v:.05,scale_x:1,scale_y:1,scale_z:1,show_trails:false,mesh_wireframe:false},camera:{phi:0,theta:0,gamma:0},timeline:[{type:'animate',duration:1,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{a:{min:-1,max:1,step:.01}}}}]},{type:'wait',duration:20}]})).scene;scene.timeline.fps=4;scene.id='measured';scene.timeline.tracks.forEach((t,i)=>{t.id='track-'+i;t.actions?.forEach((a,j)=>a.id='action-'+j);});
 const owner=variant==='after'?new api.SourceSurfaceLiveSession():undefined;
 const common={width:96,height:64,quality:'preview',sourceViewport:api.ordinarySourceViewport(scene,96,64,'primary',64)};
 function digest(v,path=''){if(['surfaceLive','warnings','stats.elapsedMs','temporal.time','temporal.windowStart','sourceCameraFrame.time'].includes(path))return;if(ArrayBuffer.isView(v)){hash.update(v.constructor.name);hash.update(Buffer.from(v.buffer,v.byteOffset,v.byteLength));}else if(Array.isArray(v)){hash.update('[');v.forEach((x,i)=>digest(x,path+'.'+i));hash.update(']');}else if(v&&typeof v==='object'){for(const k of Object.keys(v).sort()){const child=path?path+'.'+k:k;if(['surfaceLive','warnings','stats.elapsedMs','temporal.time','temporal.windowStart','sourceCameraFrame.time'].includes(child))continue;hash.update(k);digest(v[k],child);}}else hash.update(JSON.stringify(Object.is(v,-0)?'-0':v)??'undefined');}
 for(let i=0;i<32;i++){
  const c={...common,time:i/4},out=owner?owner.generate(scene,{...c,surfaceLive:{sessionId:'measured',revision:0,startAt:0,clock:{paused:false,timestampMs:1000+i*250},actualFrameRate:4}}):api.generateSourceSurface(scene,c);digest(out);
 }
 const used=process.cpuUsage(cpu);results.push({repeat,temperature:repeat===0?'first-task-after-module-load':'warm-runtime-fresh-owner',elapsedMs:performance.now()-start,cpuMs:(used.user+used.system)/1000,maxRSSKiB:process.resourceUsage().maxRSS,sha256:hash.digest('hex')});
}
console.log(JSON.stringify({variant,backend,mode,results}));
`);
const rows=[];for(const backend of ['CPU','GPU'])for(const mode of ['POINTS','MESH'])for(const variant of ['before','after'])rows.push(JSON.parse(execFileSync(process.execPath,[runner,variant,backend,mode],{encoding:'utf8',maxBuffer:1024*1024})));
const comparisons=[];for(let i=0;i<rows.length;i+=2)comparisons.push({backend:rows[i].backend,mode:rows[i].mode,equal:rows[i].results.every((r,j)=>r.sha256===rows[i+1].results[j].sha256)});
const sourceStable=(await Promise.all(Object.entries(hashes).map(async([p,h])=>sha(await readFile(p))===h))).every(Boolean),passed=sourceStable&&comparisons.every(r=>r.equal);
const report={status:passed?'passed':'failed',directory,baseline,sourceStable,hashes,rows,comparisons,scope:'32 completed source JSON import + geometry publication requests, 32x24, CPU/GPU points/mesh. Before: fixed reconstruction per request. After: retained live owner, initial explicit seek and exact .25-second updates with FPS4. Three fresh tasks per process.',limits:['Hashes omit warnings, elapsedMs, new live metadata, and request-time vs actual-scene-time labels only; all geometry, GPU shader/uniform time and camera/queue facts are compared.','First task occurs after module load; not a full App cold start. GPU data only, no draws.','maxRSS is cumulative per child. Complete tokens and VRAM unmeasured.']};await writeFile('.cache/surface-live-cost.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,directory,comparisons,rows}));if(!passed)process.exitCode=1;
