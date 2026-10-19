import {createServer} from 'vite';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=data=>createHash('sha256').update(data).digest('hex'),directory='.cache/v2-bouncing-seeds';await mkdir(directory,{recursive:true});
const files=[...(await readdir('src',{recursive:true})).filter(path=>/\.tsx?$/.test(path)).map(path=>'src/'+path),'scripts/source-bouncing-bytecode-seeds.py','scripts/verify-source-bouncing-seeds.mjs'].sort();
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async path=>[path,sha(await readFile(path))])));
const before=await hashes(),server=await createServer({server:{middlewareMode:true},logLevel:'error'}),report={at:new Date().toISOString(),scope:'Independent retained bytecode interpreter versus complete production seed generation. Canonical parsed config is shared; this does not independently verify native JSON decoding.',limitations:['Original bundled JVM dlopen did not return during bounded attempts; stack was inside dyld code-signature mapping (cause unknown); no Java or target GUI/GL executed. JNI experiment retained only in ignored cache.','Bytecode interpreter uses Python libm and explicit Java Random/Float32 adapters; native JVM math parity is not established. Untested nonfinite Math.max/min/signum/pow and transcendental edge cases are outside this interpreter claim.','Formula constructor/splitComparison/evaluate/compare/sample execute retained bytecode. FastExpression uses a restricted independent Python AST arithmetic adapter for listed fixtures only; original parser, functions and exception semantics are unverified.','Constructor boundary snapshot is source-derived; sampler factory/constructors/sample, outer rejection and all velocity instructions execute original retained bytecode.','Seed generation is unpadded; GPU padding was verified independently by verify-source-bouncing-update.mjs.','No public importer/editor/export claim; native frame parity remains 0/11.']};
try{
 const {importSourceBouncingConfig}=await server.ssrLoadModule('/src/engine/sourceBouncingConfig.ts'),{generateSourceBouncingSeeds}=await server.ssrLoadModule('/src/engine/sourceBouncingSeeds.ts');
 const raw=[];const add=(name,settings={},extra={})=>raw.push({name,raw:{settings:{particle_count:17,seed:'12345',...settings},...extra}});
 add('default-settings-count17-seed12345');
 const shapes=['BOX','CIRCLE','HEART','INFINITY','RING','SPIRAL','STAR','LISSAJOUS','ROSE','SUPERELLIPSE','HYPOCYCLOID','EPICYCLOID','ARCHIMEDEAN_SPIRAL'];
 for(const initial_position_mode of shapes)for(const shape_fill_mode of ['FILL','OUTLINE'])add(initial_position_mode+'-'+shape_fill_mode,{initial_position_mode,shape_fill_mode,container_shape:'CIRCLE',circle_radius:10,initial_circle_radius:.6,initial_circle_center_x:.1,initial_circle_center_y:-.2,shape_line_width:.03});
 for(const initial_velocity_mode of ['UNIFORM','RADIAL_OUT','RADIAL_IN','TANGENTIAL_CW','TANGENTIAL_CCW','RANDOM'])for(const velocity_noise of [0,.13])add(initial_velocity_mode+'-noise'+velocity_noise,{initial_velocity_mode,velocity_noise,initial_angle:.8,initial_angle_spread:velocity_noise? .2:0,velocity_center_x:.15,velocity_center_y:-.17});
 for(const seed of ['-9223372036854775808','9223372036854775807','9007199254740993','-1','0'])add('seed-'+seed,{seed});
 for(const container_shape of ['CIRCLE','ELLIPSE','POLYGON'])add('outer-512-fallback-'+container_shape,{container_shape,initial_position_mode:'BOX',x0_min:100,x0_max:101,y0_min:100,y0_max:101,boundary_center_x:.13,boundary_center_y:-.27,initial_velocity_mode:'RADIAL_OUT'});
 add('velocity-degenerate',{x0_min:0,x0_max:0,y0_min:0,y0_max:0,initial_velocity_mode:'RADIAL_OUT',initial_angle:1.2});
 add('zero-speed-random',{initial_velocity_mode:'RANDOM',initial_speed:0});
 add('polygon-translated-concave',{boundary_center_x:.3,boundary_center_y:-.2,particle_radius:.25},{polygon:[[-1,-1],[1,-1],[.1,.1],[1,1],[-1,1]]});
 for(const shape_fill_mode of ['FILL','OUTLINE'])for(const shape_formula of ['', '0', '1', 'x+y', 'x*x+y*y<=0.2', '0/0', '0/0!=0/0', '0/0==0/0', '0/0>=0','0/0<=0','0/0>0','0/0<0'])add('FORMULA-'+shape_fill_mode+'-'+JSON.stringify(shape_formula),{initial_position_mode:'FORMULA',shape_fill_mode,shape_formula,container_shape:'CIRCLE',circle_radius:10,initial_circle_center_x:.1,initial_circle_center_y:-.2,initial_circle_radius:.6});
 const prepared=raw.map(fixture=>{const parsed=importSourceBouncingConfig(fixture.raw);if(!parsed.ok)throw Error(fixture.name+': '+JSON.stringify(parsed.error));return{...fixture,configuration:parsed.value.configuration,count:17};});
 await writeFile(directory+'/inputs.json',JSON.stringify(prepared,null,2));
 const oracle=JSON.parse(execFileSync('python3',['scripts/source-bouncing-bytecode-seeds.py',directory+'/inputs.json'],{encoding:'utf8',maxBuffer:20*1024*1024}));
 report.pinnedJarSha256=oracle.pinnedJarSha256;report.evidence=oracle.evidence;report.cases=[];
 for(let i=0;i<prepared.length;i++){
  const fixture=prepared[i],expected=oracle.cases[i],result=generateSourceBouncingSeeds(fixture.configuration);
  if(!result.ok){report.cases.push({name:fixture.name,productionError:result.error,oracleError:expected.error});continue;}
  const actual=new Uint32Array(result.value.state.buffer,result.value.state.byteOffset,result.value.state.length),mismatches=[];
  if(expected.result)for(let j=0;j<actual.length;j++)if(actual[j]!==expected.result.words[j])mismatches.push({channel:j,actual:actual[j],expected:expected.result.words[j]});
  report.cases.push({name:fixture.name,oracleError:expected.error,channels:actual.length,lengthMatch:expected.result?.words.length===actual.length,mismatchCount:mismatches.length,mismatches:mismatches.slice(0,12),randomStateMatch:expected.result?.randomState48===result.value.diagnostics.randomState48,diagnostics:result.value.diagnostics,oracle:expected.result});
 }
 report.totals={cases:report.cases.length,particles:prepared.reduce((n,c)=>n+c.count,0),channels:report.cases.reduce((n,c)=>n+(c.channels??0),0),retainedClasses:Object.keys(report.evidence).length};report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);report.status=report.sourceStable&&report.cases.every(c=>!c.oracleError&&!c.productionError&&!c.mismatchCount&&c.lengthMatch&&c.randomStateMatch)?'passed':'failed';if(report.status!=='passed')process.exitCode=1;
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await server.close();await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,cases:report.cases?.map(c=>({name:c.name,oracleError:c.oracleError,mismatches:c.mismatchCount,rng:c.randomStateMatch,productionError:c.productionError}))}));}
