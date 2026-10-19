import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer as createTcpServer} from 'node:net';

const jar='../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const sha=data=>createHash('sha256').update(data).digest('hex');
const hashes=async()=>{const files=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx)$/.test(p)).map(p=>'src/'+p).concat('scripts/verify-source-bouncing-update.mjs').sort();return Object.fromEntries(await Promise.all(files.map(async path=>[path,sha(await readFile(path))])));};
const report={at:new Date().toISOString(),scope:'Native Bouncing motion foundation only: supplied Float32 XY-position/ZW-velocity state and parsed host uniforms. Independent pinned update.frag and quad_attrib.vert adapted from GLSL410 to ES300 versus SourceBouncingGpu. Complete padded RGBA32F state after every pass, without production shaders or update helpers in the reference.',limits:['No source initialization RNG/sampler/import/display/queue integration verified here. Existing public local model remains separate.','Raw ABI zero/negative timeStep, radii and subSteps outside JSON clamps are explicitly hostile fixtures, not normal native JSON reachability.','Original JVM/JOGL app was not run; native parity remains 0/11.','Same browser GPU adapted-shader equivalence does not establish native driver precision.','Large supplied-state cases are capacity/correctness checks, not throughput benchmarks. CPU/peak memory/token costs unmeasured.']};
let server,browser;
try{
 const before=await hashes(),jarHash=sha(await readFile(jar));if(jarHash!=='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018')throw Error('Pinned artifact differs');
 const source=JSON.parse(execFileSync('python3',['-c',"import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({k:z.read('data/shader/'+v).decode() for k,v in {'vertex':'quad_attrib.vert','fragment':'bouncing_particles_update.frag'}.items()}))",jar],{encoding:'utf8'}));
 report.reference={jar,jarHash,vertexSha256:sha(source.vertex),fragmentSha256:sha(source.fragment)};
 const port=await new Promise((resolve,reject)=>{const s=createTcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(error=>error?reject(error):resolve(port));});});
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/bouncing-source-oracle',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(server.resolvedUrls.local[0]+'bouncing-source-oracle');
 report.results=await page.evaluate(async source=>{
  const {SourceBouncingGpu}=await import('/src/engine/sourceBouncingGpu.ts');
  const {advanceBilliard}=await import('/src/scenes/bouncing.ts');
  const check=(condition,message)=>{if(!condition)throw Error(message);},digest=async values=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',values))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const proto=WebGL2RenderingContext.prototype,originals=[],live=new Map();
  for(const kind of ['Texture','Framebuffer','Buffer','VertexArray','Program','Shader'])for(const operation of ['create','delete']){
   const name=operation+kind,original=proto[name];originals.push([name,original]);proto[name]=function(...args){let groups=live.get(this);if(!groups){groups=new Map();live.set(this,groups);}let values=groups.get(kind);if(!values){values=new Set();groups.set(kind,values);}const result=original.apply(this,args);if(operation==='create'&&result)values.add(result);else if(operation==='delete')values.delete(args[0]);return result;};
  }
  const outstanding=()=>[...live.values()].reduce((n,groups)=>n+[...groups.values()].reduce((s,values)=>s+values.size,0),0);
  const gl=document.createElement('canvas').getContext('webgl2',{antialias:false,depth:false});check(gl&&gl.getExtension('EXT_color_buffer_float'),'Oracle requires RGBA32F');
  const adapt=text=>text.replace('#version 410','#version 300 es\nprecision highp float;\nprecision highp int;');
  const owned=[],own=(kind,resource)=>{check(resource,'Oracle allocation '+kind);owned.push([kind,resource]);return resource;};
  const cleanup=()=>{for(const [kind,resource] of owned.splice(0))gl['delete'+kind](resource);};
  const createOracle=(initial,collisions=4)=>{
   const count=initial.length/4,size=Math.ceil(Math.sqrt(count)),data=new Float32Array(size*size*4);data.set(initial);
   const program=own('Program',gl.createProgram());
   for(const [kind,code] of [[gl.VERTEX_SHADER,source.vertex],[gl.FRAGMENT_SHADER,source.fragment.replace('#define MAX_COLLISIONS_PER_SUBSTEP 4','#define MAX_COLLISIONS_PER_SUBSTEP '+collisions)]]){const shader=own('Shader',gl.createShader(kind));gl.shaderSource(shader,adapt(code));gl.compileShader(shader);check(gl.getShaderParameter(shader,gl.COMPILE_STATUS),gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}
   gl.linkProgram(program);check(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));
   const vao=own('VertexArray',gl.createVertexArray());gl.bindVertexArray(vao);const vbo=own('Buffer',gl.createBuffer());gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);const location=gl.getAttribLocation(program,'quadPosition');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
   const states=[0,1].map(i=>{const texture=own('Texture',gl.createTexture());gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,size,size,0,gl.RGBA,gl.FLOAT,i===0?data:null);for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.NEAREST);for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);const framebuffer=own('Framebuffer',gl.createFramebuffer());gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Oracle framebuffer incomplete');return{texture,framebuffer};});let current=0;
   return{advance(u){
    gl.useProgram(program);gl.bindVertexArray(vao);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.CULL_FACE);gl.colorMask(true,true,true,true);gl.bindFramebuffer(gl.FRAMEBUFFER,states[1-current].framebuffer);gl.viewport(0,0,size,size);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,states[current].texture);
    gl.uniform1i(gl.getUniformLocation(program,'stateTex'),0);gl.uniform1i(gl.getUniformLocation(program,'subSteps'),u.subSteps);gl.uniform1f(gl.getUniformLocation(program,'timeStep'),u.timeStep);gl.uniform1f(gl.getUniformLocation(program,'particleRadius'),u.particleRadius);
    const b=u.boundary;gl.uniform1i(gl.getUniformLocation(program,'containerShape'),b.kind==='circle'?1:b.kind==='ellipse'?2:0);
    // Native uploader writes every scalar shape uniform each pass. Unselected
    // values are zero here and never contribute to the selected shader branch.
    gl.uniform2fv(gl.getUniformLocation(program,'circleCenter'),b.kind==='circle'?b.center:[0,0]);gl.uniform1f(gl.getUniformLocation(program,'circleRadius'),b.kind==='circle'?b.radius:0);
    gl.uniform2fv(gl.getUniformLocation(program,'ellipseCenter'),b.kind==='ellipse'?b.center:[0,0]);gl.uniform1f(gl.getUniformLocation(program,'ellipseA'),b.kind==='ellipse'?b.a:0);gl.uniform1f(gl.getUniformLocation(program,'ellipseB'),b.kind==='ellipse'?b.b:0);
    const polygon=b.kind==='polygon'?b.vertices:[];gl.uniform1i(gl.getUniformLocation(program,'polygonVertexCount'),polygon.length);if(polygon.length)gl.uniform2fv(gl.getUniformLocation(program,'polygonVertices[0]'),new Float32Array(polygon.flat()));
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);check(gl.getError()===gl.NO_ERROR,'Oracle update GL error');current=1-current;
   },read(){gl.bindFramebuffer(gl.FRAMEBUFFER,states[current].framebuffer);const out=new Float32Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.FLOAT,out);check(gl.getError()===gl.NO_ERROR,'Oracle read GL error');return out;}};
  };
  const circle={kind:'circle',center:[0,0],radius:1},ellipse={kind:'ellipse',center:[.1,-.1],a:1,b:.35},box={kind:'polygon',vertices:[[-1,-1],[1,-1],[1,1],[-1,1]]};
  const update=(boundary=circle,extra={})=>({subSteps:4,timeStep:.012,particleRadius:.006,boundary,...extra});
  const initial=new Float32Array([0,0,1,.3,.99,0,2,0,-.99,.02,-1,.2,0,.5,.2,-2,.1,.1,0,0]);
  const cases=[
   {name:'circle-sequence',initial,sequence:Array.from({length:20},()=>update())},
   {name:'ellipse-inner-outer',initial:new Float32Array([.99,.1,2,.7,1.4,.5,-1,.3,.1,-.1,0,0,.2,.4,0,-2]),sequence:Array.from({length:12},()=>update(ellipse))},
   {name:'polygon-both-windings',initial,sequence:[update(box),update({kind:'polygon',vertices:box.vertices.toReversed()}),update(box,{timeStep:.25})]},
   {name:'degenerate-concave-polygon',initial,sequence:[update({kind:'polygon',vertices:[[0,0],[1,0],[1,0],[.2,.2],[1,1],[0,1]]}),update({kind:'polygon',vertices:[[0,0],[1,0],[2,0]]})]},
   {name:'mixed-host-uniform-updates',initial,sequence:[update(circle),update(ellipse,{subSteps:16,timeStep:.25}),update(box,{subSteps:1,timeStep:.003}),update({kind:'circle',center:[.2,.1],radius:.7}),update({kind:'ellipse',center:[-.2,.3],a:.8,b:.2})]},
   {name:'polygon64',initial,sequence:[update({kind:'polygon',vertices:Array.from({length:64},(_,i)=>[Math.cos(i*Math.PI/32),Math.sin(i*Math.PI/32)])})]},
   {name:'four-collision-cap',initial:new Float32Array([.2,.1,93,31]),sequence:[update(circle,{subSteps:1,timeStep:.25,particleRadius:.02})],witness:true},
   {name:'hostile-zero-negative-dt',initial:new Float32Array([2,2,1,.2,0,0,1,0]),hostile:true,sequence:[update(circle,{timeStep:0}),update(ellipse,{timeStep:-0}),update(box,{timeStep:0}),update(circle,{timeStep:-.25})]},
   {name:'hostile-substeps-clamp-radius',initial,hostile:true,sequence:[update(circle,{subSteps:-12,particleRadius:-.1}),update(ellipse,{subSteps:99,particleRadius:.4}),update({kind:'circle',center:[0,0],radius:0},{subSteps:0})]},
   {name:'hostile-small-polygon-counts',initial,hostile:true,sequence:[update({kind:'polygon',vertices:[]}),update({kind:'polygon',vertices:[[0,0]]}),update({kind:'polygon',vertices:[[0,0],[1,0]]})]},
   {name:'hostile-nonfinite-state',initial:new Float32Array([NaN,0,1,0,0,Infinity,0,1]),hostile:true,sequence:[update(circle),update(ellipse),update(box)]},
   {name:'default200000-supplied-state',count:200000,sequence:[update(circle)]},
   {name:'requested2000000-supplied-state',count:2000000,sequence:[update(circle,{subSteps:1})]},
   {name:'transferred-small-mixed-padding',transfer:true,initial:initial.slice(),sequence:[update(circle),update(ellipse),update(box)]},
   {name:'copy-input-mutation-isolation',mutate:true,initial:initial.slice(),sequence:[update(circle)]},
   {name:'transferred5000000-supplied-state',transfer:true,count:5000000,sequence:[update(circle,{subSteps:1})],diagnosticAdmission:true},
  ];
  const results=[];
  const compare=async(actual,expected,name)=>{
   check(actual.length===expected.length,'State dimensions '+name);let different=0,nonfinite=0,maxDelta=0;
   for(let i=0;i<expected.length;i++){if(!Number.isFinite(expected[i]))nonfinite++;if(Object.is(actual[i],expected[i])||(Number.isNaN(actual[i])&&Number.isNaN(expected[i])))continue;different++;maxDelta=Math.max(maxDelta,Math.abs(actual[i]-expected[i]));}
   check(!different,`${name}: ${different} differing channels, max ${maxDelta}`);return{channels:actual.length,different,maxDelta,nonfinite,actualHash:await digest(actual),referenceHash:await digest(expected),firstParticle:Array.from(actual.slice(0,4))};
  };
  try{
   for(const fixture of cases){
    let data=fixture.initial;
    if(fixture.count){data=new Float32Array(fixture.count*4);for(let i=0;i<fixture.count;i++){data[i*4]=(i%101)/505-.1;data[i*4+1]=Math.floor(i/101)%101/505-.1;data[i*4+2]=.3;data[i*4+3]=-.1;}}
    const count=data.length/4,oracle=createOracle(data),engine=fixture.transfer?SourceBouncingGpu.takeState(data):new SourceBouncingGpu(data),frames=[];
    if(fixture.transfer)check(data.byteLength===0,'Transferred caller alias remains live');
    if(fixture.mutate)data.fill(123);
    try{
     engine.initialize();frames.push(await compare(engine.readState(),oracle.read(),fixture.name+' initial'));engine.initialize();
     for(let step=0;step<fixture.sequence.length;step++){const uniforms=fixture.sequence[step];oracle.advance(uniforms);engine.advance(uniforms);frames.push(await compare(engine.readState(),oracle.read(),fixture.name+' '+step));}
     let capWitness;
     if(fixture.witness){const more=createOracle(data,8);more.advance(fixture.sequence[0]);const extended=more.read(),original=oracle.read();check(await digest(extended)!==await digest(original),'Four-collision witness failed to distinguish 8 collisions');const local=advanceBilliard([data[0],data[1]],[data[2],data[3]],Math.fround(.25),{kind:'circle',radius:1},Math.fround(.02)),positionGap=Math.hypot(original[0]-local.position[0],original[1]-local.position[1]);check(local.collisions>4&&positionGap>.01,'Local continuous solver did not distinguish native four-collision cap');capWitness={nativeMaxCollisions:4,diagnosticVariantCollisions:8,native:Array.from(original),variant:Array.from(extended),localContinuousSolver:local,localPositionGap:positionGap,interpretation:'Changing only the collision cap changes state; the existing local continuous solver also differs. Neither local nor 8-collision output supplies reference expected state.'};}
     let diagnosticAdmission;
     if(fixture.diagnosticAdmission){
      const {prepareSourceCamera,SOURCE_CAMERA_MODEL}=await import('/src/engine/sourceCamera.ts'),{importSourceBouncingVisualConfig}=await import('/src/engine/sourceBouncingVisualConfig.ts');
      const camera=prepareSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'absent'}},{logicalWidth:3840,logicalHeight:2160,referenceLogicalHeight:360,target:'offscreen',projectionPass:'perspective'}),visual=importSourceBouncingVisualConfig({settings:{dot_size:.001}});
      check(camera.ok&&camera.value.kind==='known'&&visual.ok,'4K fixture preparation');
      const options={width:3840,height:2160,cameraPlan:camera.value.plan,visualConfiguration:visual.value.configuration,initialSpeed:1};
      const first=engine.render(options);let rejected='';try{engine.readState();}catch(error){rejected=String(error);}
      check(rejected.includes('诊断读回')&&!engine.diagnostics().failed,'Diagnostic capacity refusal poisoned usable owner');
      const same=engine.render(options);check(await digest(first.pixels)===await digest(same.pixels),'Diagnostic refusal changed display');
      engine.advance(fixture.sequence[0]);oracle.advance(fixture.sequence[0]);engine.render({...options,width:320,height:180});
      frames.push(await compare(engine.readState(),oracle.read(),fixture.name+' recovered diagnostic'));
      diagnosticAdmission={rejected,same4kFrame:true,continuedUpdate:true,smallerTargetReadback:true};
     }
     results.push({name:fixture.name,count,transferred:!!fixture.transfer,hostileRawAbi:!!fixture.hostile,frames,capWitness,diagnosticAdmission,diagnostics:engine.diagnostics()});
    }finally{engine.dispose();engine.dispose();cleanup();}
    check(outstanding()===0,'Case resource leak '+fixture.name);
   }
   const failures=[],getExtension=proto.getExtension;
   let message='',missing=new SourceBouncingGpu(initial);
   try{proto.getExtension=function(name){return name==='EXT_color_buffer_float'?null:getExtension.call(this,name);};try{missing.initialize();}catch(error){message=String(error);}check(message.includes('RGBA32F'),'Missing capability was not explicit');}finally{proto.getExtension=getExtension;missing.dispose();}
   check(!outstanding(),'Capability leak');failures.push({name:'missing-rgba32f',message});
   const shaderSource=proto.shaderSource,bad=new SourceBouncingGpu(initial);message='';
   try{proto.shaderSource=function(shader,text){return shaderSource.call(this,shader,text.includes('solveCircle')?text+'\ninvalid_source_symbol':text);};try{bad.initialize();}catch(error){message=String(error);}check(message.includes('编译失败'),'Compile failure ignored');}finally{proto.shaderSource=shaderSource;bad.dispose();}
   check(!outstanding(),'Compile leak');failures.push({name:'compile-failure',message});
   const texSubImage2D=proto.texSubImage2D,upload=SourceBouncingGpu.takeState(initial.slice());let uploads=0;message='';
   try{proto.texSubImage2D=function(...args){if(++uploads===2)throw Error('injected tail upload failure');return texSubImage2D.apply(this,args);};try{upload.initialize();}catch(error){message=String(error);}check(message.includes('tail upload')&&upload.diagnostics().handles>0,'Upload failure lost ownership');}finally{proto.texSubImage2D=texSubImage2D;upload.dispose();}
   check(!outstanding(),'Tail upload leak');failures.push({name:'transferred-tail-upload-failure',message});
   let transferCancelled=false;const cancelledTransfer=SourceBouncingGpu.takeState(initial.slice(),()=>transferCancelled);transferCancelled=true;message='';
   try{cancelledTransfer.initialize();}catch(error){message=String(error);}finally{cancelledTransfer.dispose();}
   check(message.includes('取消')&&!outstanding(),'Transferred pre-initialize cancellation leak');failures.push({name:'transferred-cancel-before-initialize',message});
   let cancelled=false;const cancel=new SourceBouncingGpu(initial,()=>cancelled);cancel.initialize();cancelled=true;message='';try{cancel.advance(update());}catch(error){message=String(error);}finally{cancel.dispose();}check(message.includes('取消')&&!outstanding(),'Cancellation failure');failures.push({name:'cancel',message});
   const retry=new SourceBouncingGpu(initial);retry.initialize();const deleteTexture=proto.deleteTexture;let threw=false,retained;
   try{proto.deleteTexture=function(handle){if(!threw){threw=true;throw Error('injected delete failure');}return deleteTexture.call(this,handle);};message='';try{retry.dispose();}catch(error){message=String(error);}retained=retry.diagnostics();check(message&&retained.contextOwned&&retained.handles,'Failed cleanup ownership discarded');}finally{proto.deleteTexture=deleteTexture;retry.dispose();}
   check(!outstanding(),'Retry leak');failures.push({name:'cleanup-retry',retained});
   const known=new Set(live.keys()),lost=new SourceBouncingGpu(initial);lost.initialize();const context=[...live.keys()].find(value=>!known.has(value));context.getExtension('WEBGL_lose_context').loseContext();await new Promise(resolve=>setTimeout(resolve,0));message='';try{lost.advance(update());}catch(error){message=String(error);}finally{lost.dispose();}check(message.includes('上下文丢失')&&!outstanding(),'Context loss failure');failures.push({name:'context-loss',message});
   return{cases:results,failures,outstandingBeforeContextLoss:outstanding(),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION)};
  }finally{cleanup();for(const [name,original] of originals)proto[name]=original;for(const context of live.keys())context.getExtension('WEBGL_lose_context')?.loseContext();}
 },source);
 report.errors=errors;report.sources=await hashes();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sources);if(errors.length||!report.sourceStable)throw Error('Page errors or changed sources');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();report.cleanup='Engine/oracle resources, browser and owned Vite server disposed.';await writeFile('.cache/v2-source-bouncing-update.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,sourceStable:report.sourceStable,cases:report.results?.cases.map(c=>({name:c.name,count:c.count,states:c.frames.length}))}));}
