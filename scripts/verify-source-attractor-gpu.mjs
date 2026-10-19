import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';

// Reference programs are extracted from the pinned artifact on every run.
// No production shader, RNG, warmup planner or density planner supplies oracle
// arithmetic. Parsed input facts and separately verified camera matrices are
// shared. This is adapted-shader equivalence, not native JVM framebuffer parity.
const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const sha=data=>createHash('sha256').update(data).digest('hex');
const hashes=async()=>{
 const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-attractor-gpu.mjs','tests/fixtures/source-attractor/visual.json').sort();
 return Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
};
const report={at:new Date().toISOString(),scope:'SourceAttractorGpu context engine versus independent retained GLSL 410 update/accumulation/presentation programs adapted to GLSL ES 300 on the same browser GPU. Complete RGBA32F state and RGBA8 framebuffers; no native app launched.',shared:'Parsed configuration/visual facts and source camera matrix owner. Oracle independently constructs Java Random seeds, palette raw channels, texIndex, warmup passes, RK4 body and density uniforms.',nativeParity:'0/11 unchanged',unmeasured:['Native JVM/JOGL framebuffer and driver parity','Full public importer/editor/export integration','Sustained large-count performance','CPU time, process-family peak memory, agent tokens']};
let browser,server;
try{
 const before=await hashes(),jarHash=sha(await readFile(jar));
 if(jarHash!=='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018')throw Error('Pinned JAR identity changed');
 const source=JSON.parse(execFileSync('python3',['-c',"import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);names=['quad.vert','attractor_update.frag','attractor_accumulate.vert','attractor_accumulate.frag','attractor_present.frag'];print(json.dumps({n:z.read('data/shader/'+n).decode() for n in names}))",jar],{encoding:'utf8'}));
 report.reference={jar,jarHash,shaders:Object.fromEntries(Object.entries(source).map(([name,text])=>[name,sha(text)]))};
 const paletteFixture=JSON.parse(await readFile('tests/fixtures/source-attractor/visual.json','utf8'));
 if(paletteFixture.artifactSha256!==jarHash)throw Error('Palette golden artifact differs');
 source.paletteGolden=paletteFixture.cases.find(c=>c.id==='transparent-rgb-7');
 if(source.paletteGolden.samples.length!==source.paletteGolden.count)throw Error('Incomplete palette golden');
 const port=await new Promise((resolve,reject)=>{const socket=createTcpServer();socket.once('error',reject);socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(error=>error?reject(error):resolve(port));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/attractor-source-oracle',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'attractor-source-oracle');
 report.results=await page.evaluate(async source=>{
  const {SourceAttractorGpu}=await import('/src/engine/sourceAttractorGpu.ts');
  const {importSourceAttractorConfig}=await import('/src/engine/sourceAttractorConfig.ts');
  const {importSourceAttractorVisualConfig}=await import('/src/engine/sourceAttractorVisualConfig.ts');
  const {prepareSourceAttractorGpuFunction}=await import('/src/engine/sourceAttractorGpuFunction.ts');
  const {prepareSourceCamera,SOURCE_CAMERA_MODEL}=await import('/src/engine/sourceCamera.ts');
  const F=Math.fround,check=(value,message)=>{if(!value)throw Error(message);};
  const unwrap=result=>{check(result.ok,JSON.stringify(result.error));return result.value;};
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const live=new Map(),originals=[];
  // Count partial resources before context loss, which would otherwise hide a
  // failed-construction leak. Both the oracle and production must dispose.
  for(const kind of ['Program','Shader','Buffer','Texture','VertexArray','Framebuffer','Renderbuffer']){
   for(const operation of ['create','delete']){
    const name=operation+kind,original=WebGL2RenderingContext.prototype[name];originals.push([name,original]);
    WebGL2RenderingContext.prototype[name]=function(...args){
     let groups=live.get(this);if(!groups){groups=new Map();live.set(this,groups);}let objects=groups.get(kind);if(!objects){objects=new Set();groups.set(kind,objects);}
     const value=original.apply(this,args);if(operation==='create'&&value)objects.add(value);else if(operation==='delete')objects.delete(args[0]);return value;
    };
   }
  }
  const outstanding=()=>[...live.values()].reduce((sum,groups)=>sum+[...groups.values()].reduce((n,objects)=>n+objects.size,0),0);
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true});
  check(gl,'WebGL2 unavailable');for(const extension of ['EXT_color_buffer_float','EXT_float_blend','OES_texture_float_linear'])check(gl.getExtension(extension),'Missing '+extension);
  const adapt=text=>text.replace('#version 410','#version 300 es\nprecision highp float;\nprecision highp int;');
  const resources={Program:[],Shader:[],Buffer:[],Texture:[],VertexArray:[],Framebuffer:[]};
  const own=(kind,value)=>{check(value,'Could not allocate '+kind);resources[kind].push(value);return value;};
  const release=()=>{for(const [kind,values] of Object.entries(resources))for(const value of values.splice(0))gl['delete'+kind](value);};
  const program=(vertex,fragment)=>{
   const result=own('Program',gl.createProgram());
   for(const [type,text] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=own('Shader',gl.createShader(type));gl.shaderSource(shader,adapt(text));gl.compileShader(shader);check(gl.getShaderParameter(shader,gl.COMPILE_STATUS),gl.getShaderInfoLog(shader));gl.attachShader(result,shader);}
   gl.linkProgram(result);check(gl.getProgramParameter(result,gl.LINK_STATUS),gl.getProgramInfoLog(result));return result;
  };
  const texture=(w,h,data,linear=false,byte=false)=>{
   const tex=own('Texture',gl.createTexture());gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,byte?gl.RGBA8:gl.RGBA32F,w,h,0,gl.RGBA,byte?gl.UNSIGNED_BYTE:gl.FLOAT,data);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,linear?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,linear?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   const fbo=own('Framebuffer',gl.createFramebuffer());gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Oracle incomplete framebuffer');return{tex,fbo,w,h};
  };
  const use=(p,target)=>{gl.useProgram(p);gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);gl.viewport(0,0,target.w,target.h);};
  const bind=(p,name,tex)=>{gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(gl.getUniformLocation(p,name),0);};
  const stateData=configuration=>{
   let rng=(12345n^0x5deece66dn)&((1n<<48n)-1n);
   const next=()=>{rng=(rng*0x5deece66dn+11n)&((1n<<48n)-1n);return Number(rng>>24n)/16777216;};
   const count=configuration.particleCountGPU,size=Math.ceil(Math.sqrt(count)),data=new Float32Array(size*size*4),b=configuration.bounds;
   let lo=F(configuration.dtRange.min),hi=F(configuration.dtRange.max);if(lo>hi)[lo,hi]=[hi,lo];const span=F(hi-lo);
   for(let i=0;i<count;i++){for(let k=0;k<3;k++){const axis='XYZ'[k],min=F(b['min'+axis]),max=F(b['max'+axis]);data[i*4+k]=F(min+F(next()*F(max-min)));}data[i*4+3]=span>0?F(lo+F(next()*span)):lo;}
   return{size,data};
  };
  const compareState=async(actual,expected,label)=>{
   check(actual.length===expected.length,'State dimensions '+label);let different=0,maxDelta=0,nonfinite=0;
   for(let i=0;i<actual.length;i++){if(!Number.isFinite(expected[i]))nonfinite++;if(Object.is(actual[i],expected[i])||(Number.isNaN(actual[i])&&Number.isNaN(expected[i])))continue;different++;maxDelta=Math.max(maxDelta,Math.abs(actual[i]-expected[i]));}
   check(different===0,'State differs '+label+': '+different+' channels, max '+maxDelta);return{label,channels:actual.length,different,maxDelta,nonfinite,hash:await digest(actual)};
  };
  const cases=[
   {name:'constant-first-update',steps:3},
   {name:'source-default-gpu-count',count:200000,radius:2,steps:5},
   {name:'warmup100-boundary',base:203,min:2,max:13,steps:5},
   {name:'negative-base',base:-4,min:0,max:13,steps:0},
   {name:'stagger-clamps',base:3,min:9,max:2,steps:-7},
   {name:'warmup-int-overflow',base:2147483647,min:1,max:1,steps:0},
   {name:'variable-dt',base:101,min:0,max:4,dtMin:-.001,dtMax:.003,steps:4},
   {name:'lorenz',base:103,min:0,max:7,steps:7,equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},body:'void calculate_derivative(vec3 p, out vec3 dp) {float x=p.x,y=p.y,z=p.z;dp=vec3(10.0*(y-x),x*(28.0-z)-y,x*y-(8.0/3.0)*z);}'},
   {name:'single-last-palette',count:1,palette:['#FFFF0000','#8040CC88'],packed:0x8040cc88},
   {name:'source-palette-interpolated',count:source.paletteGolden.count,palette:source.paletteGolden.colors,packedArray:source.paletteGolden.samples.map(sample=>sample.packed)},
   {name:'transparent-blue-is-not-tint-gray',palette:['#00000080'],packed:0x80,blank:true},
   {name:'negative-radius-minimum',radius:-12},
   {name:'transformed',scale:[17,-11,9],offset:[7,-4,6],camera:{phi:.47,theta:-.3,gamma:.23}},
   {name:'tone-overlap',bounds:[0,0],radius:18,tone:{gpu_exposure:24,gpu_gamma:1.4,gpu_saturation:1.6,gpu_density_scale:2,gpu_contrast:1.4}},
   {name:'orthographic-offscreen',target:'offscreen',projection:'scene-fade-orthographic',height:80},
   {name:'nonfinite-keeps-dt',steps:2,equations:{dx:'sqrt(-1)',dy:'1',dz:'0'},body:'void calculate_derivative(vec3 p, out vec3 dp) {dp=vec3(sqrt(-1.0),1.0,0.0);}',skipRender:true},
  ];
  const results=[];let latestOptions;
  try{
   for(const c of cases){
    const count=c.count??17,settings={render_mode:'GPU',particle_count_gpu:count,time_step_min:c.dtMin??.002,time_step_max:c.dtMax??.002,sub_steps:c.steps??3,dot_size:c.radius??8,scale_x:c.scale?.[0]??24,scale_y:c.scale?.[1]??24,scale_z:c.scale?.[2]??24,offset_x:c.offset?.[0]??0,offset_y:c.offset?.[1]??0,offset_z:c.offset?.[2]??0,...c.tone};
    const bounds=c.bounds??[-1,1],configuration=unwrap(importSourceAttractorConfig(settings,{warmup_steps:c.base??0,warmup_stagger_min:c.min??0,warmup_stagger_max:c.max??0,bounds:Object.fromEntries(['x','y','z'].flatMap(axis=>[['min_'+axis,bounds[0]],['max_'+axis,bounds[1]]]))})).configuration;
    const visualConfiguration=unwrap(importSourceAttractorVisualConfig(settings,c.palette??['#A040CC88'])).configuration;
    const shader=unwrap(prepareSourceAttractorGpuFunction({equations:c.equations??{dx:'1',dy:'-2',dz:'.5'},parameters:{}}));
    const options={configuration,visualConfiguration,shader},engine=new SourceAttractorGpu(options);latestOptions=options;
    const {size,data}=stateData(configuration),states=[texture(size,size,data),texture(size,size,null)];let read=0,write=1;
    const quad=source['quad.vert'],update=program(quad,source['attractor_update.frag'].replace('// %ATTRACTOR_FUNCTION_BODY%',c.body??'void calculate_derivative(vec3 p, out vec3 dp) {dp=vec3(1.0,-2.0,0.5);}'));
    gl.bindVertexArray(own('VertexArray',gl.createVertexArray()));gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.DITHER);
    const pass=(steps,warmup=false,start=0)=>{
     use(update,states[write]);bind(update,'posTex',states[read].tex);
     const warm=configuration.warmup,max=Math.max(0,warm.staggerMax),min=Math.min(max,Math.max(0,warm.staggerMin));
     for(const [name,value] of Object.entries({steps,isWarmup:warmup?1:0,warmupBase:warm.steps,staggerMin:min,staggerRange:max-min,currentStepBase:start}))gl.uniform1i(gl.getUniformLocation(update,name),value);
     gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);[read,write]=[write,read];
    };
    const readState=()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,states[read].fbo);const out=new Float32Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.FLOAT,out);return out;};
    try{
     const warm=configuration.warmup,max=Math.max(0,warm.staggerMax),total=(warm.steps+max)|0;let warmupPasses=0;
     if(warm.steps>0||max>0)for(let start=0;start<total;start+=100){pass(Math.min(100,total-start),true,start);warmupPasses++;}
     engine.initialize();const initial=await compareState(engine.readState(),readState(),c.name+' initialized');
     const initialHash=initial.hash;engine.initialize();check(await digest(engine.readState())===initialHash,'Initialization repeated warmup');
     pass(configuration.stepsPerFrame);engine.advance();const advanced=await compareState(engine.readState(),readState(),c.name+' advanced');
     const frames=[];
     if(!c.skipRender){
      const accumProgram=program(source['attractor_accumulate.vert'],source['attractor_accumulate.frag']),present=program(quad,source['attractor_present.frag']);
      const uv=new Float32Array(count*2),colors=new Float32Array(count*4),inv=F(1/size),half=F(inv*.5);
      for(let i=0;i<count;i++){const packed=c.packedArray?.[i]??c.packed??0xa040cc88;uv[i*2]=F(F((i%size)*inv)+half);uv[i*2+1]=F(F(Math.floor(i/size)*inv)+half);colors.set([F(((packed>>>16)&255)/255),F(((packed>>>8)&255)/255),F((packed&255)/255),F((packed>>>24)/255)],i*4);}
      gl.useProgram(accumProgram);const vao=own('VertexArray',gl.createVertexArray());gl.bindVertexArray(vao);
      for(const [name,n,data] of [['texIndex',2,uv],['color',4,colors]]){const buffer=own('Buffer',gl.createBuffer());gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);const location=gl.getAttribLocation(accumProgram,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,n,gl.FLOAT,false,0,0);}
      for(const multiplier of [1,2,1]){
       const logicalHeight=c.height??96,logicalWidth=144,width=logicalWidth*multiplier,height=logicalHeight*multiplier;
       const prepared=unwrap(prepareSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'angles',family:'attractor',...c.camera??{phi:0,theta:0,gamma:0}}},{logicalWidth,logicalHeight,referenceLogicalHeight:96,target:c.target??'primary',projectionPass:c.projection??'perspective'}));check(prepared.kind==='known','Camera plan unknown');const cameraPlan=prepared.plan;
       const scale=Math.max(1,Math.min(1.5,F(4096/Math.max(width,height)))),w=Math.max(1,Math.ceil(F(width*scale))),h=Math.max(1,Math.ceil(F(height*scale))),accum=texture(w,h,null,true),output=texture(width,height,null,false,true);
       use(accumProgram,accum);gl.bindVertexArray(vao);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DEPTH_TEST);gl.colorMask(true,true,true,true);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.blendFunc(gl.ONE,gl.ONE);
       for(const [name,value] of [['projection',cameraPlan.projection.columnMajor],['modelview',cameraPlan.modelView.columnMajor]])gl.uniformMatrix4fv(gl.getUniformLocation(accumProgram,name),false,value);
       gl.uniform1f(gl.getUniformLocation(accumProgram,'radius'),F(Math.max(1,F(visualConfiguration.points.dotRadius*Math.max(cameraPlan.displayScale,0)))*scale));
       for(const [name,prefix] of [['scale','scale'],['offset','offset']])gl.uniform3fv(gl.getUniformLocation(accumProgram,name),['X','Y','Z'].map(axis=>configuration.transform[prefix+axis]));
       bind(accumProgram,'posTex',states[read].tex);gl.drawArrays(gl.POINTS,0,count);
       use(present,output);gl.bindVertexArray(null);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);bind(present,'accumTex',accum.tex);
       const backgroundColor=0x40203040;gl.uniform3f(gl.getUniformLocation(present,'backgroundRgb'),32/255,48/255,64/255);
       const tone=visualConfiguration.gpuTone;for(const name of ['exposure','contrast','gamma','saturation'])gl.uniform1f(gl.getUniformLocation(present,name),tone[name]);
       gl.uniform1f(gl.getUniformLocation(present,'densityScale'),F(Math.max(F(.08),F(F(count/Math.max(1,F(F(w)*F(h))))*F(.45)))*tone.densityScale));
       gl.drawArrays(gl.TRIANGLE_STRIP,0,4);const bottomUp=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bottomUp);const expected=new Uint8Array(bottomUp.length);for(let y=0;y<height;y++)expected.set(bottomUp.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
       const actual=engine.render({width,height,cameraPlan,backgroundColor});check(actual.width===width&&actual.height===height,'Rendered size');
       let different=0,maxDelta=0,foreground=0;for(let i=0;i<expected.length;i++){const delta=Math.abs(expected[i]-actual.pixels[i]);if(delta){different++;maxDelta=Math.max(maxDelta,delta);}if(i%4!==3&&expected[i]!==[32,48,64][i%4])foreground++;if(i%4===3)check(actual.pixels[i]===255,'Density must output alpha1');}
       frames.push({width,height,different,maxDelta,foreground,actualHash:await digest(actual.pixels),referenceHash:await digest(expected)});
       check(!different,'Density pixels differ '+c.name+': '+different+' / '+maxDelta);check(c.blank?foreground===0:foreground>0,'Unexpected blank density '+c.name);
      }
      check(frames[0].actualHash===frames[2].actualHash,'Render/resize mutated simulation state');check(await digest(engine.readState())===advanced.hash,'Display advanced state');
     }
     check(gl.getError()===gl.NO_ERROR,'Oracle GL error '+c.name);results.push({name:c.name,warmupPasses,initial,advanced,frames,diagnostics:engine.diagnostics()});
    }finally{engine.dispose();engine.dispose();release();}
   }
   check(outstanding()===0,'Resources leaked after successful cases: '+outstanding());
   const failures=[];
   const malformed=new SourceAttractorGpu({...latestOptions,shader:{...latestOptions.shader,code:'void calculate_derivative(vec3 p,out vec3 dp){dp=unknown_source_symbol;}'}});let error='';
   try{malformed.initialize();}catch(e){error=String(e);}finally{malformed.dispose();}
   check(error.includes('unknown_source_symbol'),'Malformed shader diagnostic lost');check(outstanding()===0,'Shader failure leaked GPU resources');failures.push({name:'compile-failure',error,outstanding:outstanding()});
   let cancelled=false;const cancel=new SourceAttractorGpu({...latestOptions,isCancelled:()=>cancelled});
   try{cancel.initialize();cancelled=true;error='';try{cancel.advance();}catch(e){error=String(e);}check(error,'Cancellation was ignored');}finally{cancel.dispose();}
   check(outstanding()===0,'Cancellation leaked resources');failures.push({name:'cancellation',error,outstanding:outstanding()});
   const prototype=WebGL2RenderingContext.prototype,getExtension=prototype.getExtension;
   const unavailable=new SourceAttractorGpu(latestOptions);error='';
   try{
    prototype.getExtension=function(name){return name==='EXT_float_blend'?null:getExtension.call(this,name);};
    try{unavailable.initialize();}catch(e){error=String(e);}
    check(error.includes('EXT_float_blend'),'Capability failure must be explicit');
   }finally{prototype.getExtension=getExtension;unavailable.dispose();}
   check(outstanding()===0,'Capability failure leaked resources');failures.push({name:'missing-float-blend',error,outstanding:outstanding()});
   const retry=new SourceAttractorGpu(latestOptions);retry.initialize();const deleteTexture=prototype.deleteTexture;let interrupted=false,retained;
   try{
    prototype.deleteTexture=function(object){if(!interrupted){interrupted=true;throw Error('injected deletion failure');}return deleteTexture.call(this,object);};
    error='';try{retry.dispose();}catch(e){error=String(e);}
    retained=retry.diagnostics();check(interrupted&&error.includes('injected deletion failure')&&retained.contextOwned&&retained.handles>0,'Failed cleanup ownership discarded');
   }finally{prototype.deleteTexture=deleteTexture;retry.dispose();}
   check(outstanding()===0,'Retried disposal leaked resources');failures.push({name:'deletion-failure-retry',retained,outstanding:outstanding()});
   const knownContexts=new Set(live.keys()),lost=new SourceAttractorGpu(latestOptions);lost.initialize();const lostGl=[...live.keys()].find(context=>!knownContexts.has(context));check(lostGl,'New context missing');
   try{lostGl.getExtension('WEBGL_lose_context').loseContext();await new Promise(resolve=>setTimeout(resolve,0));error='';try{lost.advance();}catch(e){error=String(e);}check(error.includes('上下文丢失'),'Context loss was ignored');}finally{lost.dispose();}
   check(outstanding()===0,'Context loss disposal leaked resources');failures.push({name:'context-loss',error,outstanding:outstanding()});
   const recovery=new SourceAttractorGpu({...latestOptions,shader:unwrap(prepareSourceAttractorGpuFunction({equations:{dx:'1',dy:'-2',dz:'.5'},parameters:{}}))});
   try{recovery.advance();check(recovery.readState().every(Number.isFinite),'Fresh recovery failed');}finally{recovery.dispose();}
   check(outstanding()===0,'Recovery leaked resources');failures.push({name:'fresh-engine-recovery',outstanding:outstanding()});
   return{cases:results,failures,outstandingBeforeContextLoss:outstanding(),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),nativeAppParity:false};
  }finally{release();for(const [name,original] of originals)WebGL2RenderingContext.prototype[name]=original;for(const context of live.keys())context.getExtension('WEBGL_lose_context')?.loseContext();}
 },source);
 report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);
 if(errors.length||!report.sourceStable)throw Error('Page errors or sources changed during verification');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.cleanup='Oracle GL resources, production engine instances, browser and owned Vite server disposed.';await writeFile('.cache/v2-source-attractor-gpu.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,cases:report.results?.cases.map(c=>({name:c.name,stateDifferences:c.advanced.different,frames:c.frames.length}))}));}
