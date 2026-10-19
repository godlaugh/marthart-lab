/** Complete CPU motion/color/history task; excludes rendering and native parity. */
import {createServer} from 'vite';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
const paths=['sourcePerlinParticleMotion','sourcePerlinParticleColors','sourcePerlinColorRuntime','sourcePerlinParticleTrails','sourceParticleTrails','sourceManimGradient'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(`src/engine/${p}.ts`)).digest('hex')])));
const sources=await hashes();
const report={scope:'1000 particles, 121 color/motion/history updates and final polygon extraction',runs:[],limitations:['Single sequential samples; first run has cold task state but Vite modules are loaded.','No equivalent previous complete implementation; no speedup claim.','No renderer, native JVM pixels, process-family memory, driver memory or token measurement.','maxRssKiB covers this Node process lifetime including Vite.']};
try{
 const {SourcePerlinParticleMotion}=await server.ssrLoadModule('/src/engine/sourcePerlinParticleMotion.ts');
 const {SourcePerlinParticleColors}=await server.ssrLoadModule('/src/engine/sourcePerlinParticleColors.ts');
 const {SourcePerlinParticleTrails}=await server.ssrLoadModule('/src/engine/sourcePerlinParticleTrails.ts');
 for(const name of ['first complete task','repeat complete task after warmup']){
  const cpu=process.cpuUsage(),start=performance.now();
  const motion=new SourcePerlinParticleMotion({seed:'12345',count:1000,width:800,height:600});
  const colors=new SourcePerlinParticleColors({count:1000,palette:[0xff8657d6,0xffefa9e6]});
  const trails=new SourcePerlinParticleTrails({motion,packedColors:colors.packed,lifetime:4,fade:true,accumulation:false});
  for(let i=0;i<121;i++){
   if(i%30===0)colors.runtime.replacePalette(i%60?[0xff00aaff,0xffcc5500]:[0xff8657d6,0xffefa9e6]);
   colors.runtime.update(1/60);
   motion.update({time:i/60,deltaTime:1/60,noiseScale:8,noiseOffset:0,stepSize:.45,timeScale:.18,respawnRate:.1,flowMode:'SWIRL_FIELD',angleMap:'LINEAR'});
   trails.afterMotion(i/60,true);
  }
  const polygons=trails.snapshotPolygons(800,600),h=createHash('sha256');
  for(const a of [polygons.positions,polygons.colors,polygons.alphas,polygons.polygonOffsets,polygons.particleIds])h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));
  report.runs.push({name,wallMs:performance.now()-start,cpu:process.cpuUsage(cpu),maxRssKiB:process.resourceUsage().maxRSS,sha256:h.digest('hex'),motion:motion.diagnostics(),colors:colors.diagnostics(),trails:trails.diagnostics(),polygonCount:polygons.polygonOffsets.length-1,vertices:polygons.alphas.length,snapshotBytes:Object.values(polygons).filter(v=>ArrayBuffer.isView(v)).reduce((n,a)=>n+a.byteLength,0)});
 }
 if(report.runs[0].sha256!==report.runs[1].sha256)throw Error('Repeated complete task results differ');
 if(JSON.stringify(sources)!==JSON.stringify(await hashes()))throw Error('Sources changed during measurement');
 report.sources=sources;report.sourceStable=true;report.status='passed';
}catch(e){report.status='failed';report.error=String(e);process.exitCode=1;}
finally{await server.close();await mkdir('.cache',{recursive:true});await writeFile('.cache/v2-perlin-trail-costs.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
