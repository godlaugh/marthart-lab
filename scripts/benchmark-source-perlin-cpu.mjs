/** Measures CPU motion/geometry only. No pixels, UI, native target or speedup claim. */
import {createServer} from 'vite';
import {createHash} from 'node:crypto';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
const paths=['src/engine/sourcePerlinSeed.ts','src/engine/sourcePerlinAngleField.ts','src/engine/sourcePerlinCurveGeometry.ts','src/engine/sourcePerlinParticleMotion.ts','src/engine/sourceProcessingNoise.ts','src/engine/javaSourceRandom.ts','scripts/benchmark-source-perlin-cpu.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')])));
const before=await hashes();
const report={scope:'Local CPU producer only; no rendering, UI or original JVM comparison',runs:[],limitations:['No before-change equivalent source producer exists; no speedup claim.','Browser/driver and process-family memory are unmeasured.','Token cost unmeasured; maxRSS is this Node process lifetime including Vite modules.','Single sequential samples, not a statistical benchmark.']};
const hash=arrays=>{const h=createHash('sha256');for(const a of arrays)h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));return h.digest('hex');};
const measure=(name,task)=>{const cpu=process.cpuUsage(),start=performance.now();const result=task();report.runs.push({name,wallMs:performance.now()-start,cpu:process.cpuUsage(cpu),maxRssKiB:process.resourceUsage().maxRSS,...result});};
try{
 const {SourcePerlinParticleMotion}=await server.ssrLoadModule('/src/engine/sourcePerlinParticleMotion.ts');
 const {SourceProcessingNoise}=await server.ssrLoadModule('/src/engine/sourceProcessingNoise.ts');
 const {SourcePerlinAngleField}=await server.ssrLoadModule('/src/engine/sourcePerlinAngleField.ts');
 const {SourcePerlinCurveGeometry}=await server.ssrLoadModule('/src/engine/sourcePerlinCurveGeometry.ts');
 const options={seed:'12345',count:10000,width:800,height:600};
 const frame={deltaTime:1/60,noiseScale:8,noiseOffset:0,stepSize:.15,timeScale:0,respawnRate:0,flowMode:'ANGLE_FIELD',angleMap:'LINEAR'};
 let motion;
 measure('particles: construct and 31 sequential updates',()=>{motion=new SourcePerlinParticleMotion(options);for(let i=0;i<31;i++)motion.update({...frame,time:i/60});const s=motion.snapshot();return{sha256:hash([s.positions,s.velocities,s.actualSteps,s.flags]),...motion.diagnostics()};});
 measure('particles: independently repeat same complete task after module warmup',()=>{const b=new SourcePerlinParticleMotion(options);for(let i=0;i<31;i++)b.update({...frame,time:i/60});const s=b.snapshot();return{sha256:hash([s.positions,s.velocities,s.actualSteps,s.flags]),...b.diagnostics()};});
 let field,curves;
 measure('curves: construct 41x31 field and 3000x70 paths',()=>{field=new SourcePerlinAngleField({width:800,height:600,fieldCellSize:20,textureSeed:12345,curveNoiseScale:1.2,curveNoiseOctaves:2,curveNoiseOffset:0,curveAngleScale:4,noise:new SourceProcessingNoise(12345n)});curves=new SourcePerlinCurveGeometry({seed:'12345',count:3000,length:70,width:800,height:600,sampling:'jittered-grid',stepSize:2,angleField:field,noiseOffset:0});const s=curves.snapshot();return{sha256:hash([s.seedXs,s.seedYs,s.xs,s.ys]),field:field.diagnostics()};});
 measure('curves: reuse field and fixed seeds, rebuild same 3000x70 paths',()=>{curves.rebuild({noiseOffset:0});const s=curves.snapshot();return{sha256:hash([s.seedXs,s.seedYs,s.xs,s.ys])};});
 if(report.runs[0].sha256!==report.runs[1].sha256||report.runs[2].sha256!==report.runs[3].sha256)throw new Error('Equivalent complete producer results differ');
 report.sources=await hashes();if(JSON.stringify(before)!==JSON.stringify(report.sources))throw new Error('Source changed during measurement');report.sourceStable=true;report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await server.close();await mkdir('.cache',{recursive:true});await writeFile('.cache/v2-perlin-cpu-costs.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
