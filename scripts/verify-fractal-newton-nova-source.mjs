import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Independent retained-source expectations. No production arithmetic module is
// imported by the reference builder below. Browser adapters are actual-only.
const scriptPath='scripts/verify-fractal-newton-nova-source.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?{kind:'bigint',decimal:v.toString()}:typeof v==='number'&&!Number.isFinite(v)?{kind:'nonfinite',value:String(v)}:v,2)+'\n';
const check=(value,message)=>{if(!value)throw Error(message);};
const evidencePaths={
 dd:'.cache/fractal-newton-nova-double-double-next.json',
 reference:'.cache/fractal-newton-nova-reference-service-next.json',
 mapper:'../.cache/mathart-investigation/nova-runtime-mapper-bytecode.json',
 formula:'../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/fractal/parts/formulas/formula_newton_nova.glsl',
 math:'../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/fractal/parts/fractal_math.glsl',
 main:'../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/fractal/parts/fractal_main.glsl',
 init:'../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/fractal/parts/pipeline/fractal_pipeline_init.glsl',
};
const retained=Object.fromEntries(await Promise.all(Object.entries(evidencePaths).map(async([key,path])=>[key,{path,sha256:sha(await readFile(path)),text:await readFile(path,'utf8')}])));

/** JVM DoubleDouble bytecode transcription. Every parenthesized expression
 * follows stack evaluation order: add @0–73, sub @0–74, mul @0–196,
 * div @0–60. Java div's second correction uses remainder.hi ONLY. */
function addDD(a,b){const s=a[0]+b[0],v=s-a[0],e=(((b[0]-v)+(a[0]-(s-v)))+a[1])+b[1],h=s+e;return[h,e-(h-s)];}
function subDD(a,b){const s=a[0]-b[0],v=s-a[0],e=(((-b[0]-v)+(a[0]-(s-v)))+a[1])-b[1],h=s+e;return[h,e-(h-s)];}
function mulDD(a,b){
 const p=a[0]*b[0],ac=a[0]*134217729,bc=b[0]*134217729,ah=ac-(ac-a[0]),bh=bc-(bc-b[0]),al=a[0]-ah,bl=b[0]-bh;
 let error=ah*bh-p;error=error+(ah*bl+al*bh);error=error+al*bl;
 const cross=a[0]*b[1]+a[1]*b[0],s=p+cross,e=s-p,t=(a[1]*b[1]+((cross-e)+(p-(s-e))))+error,h=s+t;
 return[h,t-(h-s)];
}
function divDD(a,b){const q=[a[0]/b[0],0],r=subDD(a,mulDD(b,q));return addDD(q,[r[0]/b[0],0]);}
const cmul=(a,b)=>[subDD(mulDD(a[0],b[0]),mulDD(a[1],b[1])),addDD(mulDD(a[0],b[1]),mulDD(a[1],b[0]))];
const dvalue=d=>d[0]+d[1],pair=z=>z.map(dvalue),clone=z=>z.map(d=>d.slice());

// This input is explicit source-mapped context, not FractalConfig or a prepared
// production plan. Mapping itself is checked separately against authored cases.
function independentReference(input){
 const length=Math.min(input.iterations,2048),center=[addDD([input.center[0],0],[input.center[1],0]),addDD([input.center[2],0],[input.center[3],0])];
 if(length<=0)return{kind:'unavailable',reason:'ITERATIONS_NON_POSITIVE',length:0,values:[]};
 let z,constant;
 if(input.variant==='julia'){z=clone(center);constant=input.mappedJulia.map(x=>[x,0]);}
 else{
  if(input.formula==='nova')z=input.mappedJulia.map(x=>[x,0]);
  else{z=clone(center);if(Math.abs(dvalue(z[0]))+Math.abs(dvalue(z[1]))<1e-24){const min=Math.max(1,Math.min(Math.fround(input.width),Math.fround(input.height))),shift=Math.max((2/min)*.5,1e-18);z[0]=addDD(z[0],[shift,0]);}}
  constant=clone(center);
 }
 const initialZ=clone(z),p=input.power,relax=Math.fround(input.relaxation)>0?Math.fround(input.relaxation):1,values=[];
 for(let i=0;i<length;i++){
  // Reference stores the collapsed double, then float high/residual. It does
  // not pack the original DD low word directly, and steps after the final pack.
  for(const d of z){const n=dvalue(d),hi=Math.fround(n);values.push(hi,Math.fround(n-hi));}
  let pm1;
  if(p>1){pm1=clone(z);for(let j=1;j<p-1;j++)pm1=cmul(pm1,z);}else pm1=[[1,0],[0,0]];
  const power=cmul(pm1,z),numerator=[subDD(power[0],[1,0]),power[1]],derivative=pm1.map(d=>mulDD(d,[p,0])),denom=addDD(mulDD(derivative[0],derivative[0]),mulDD(derivative[1],derivative[1])),dn=dvalue(denom);
  if(!Number.isFinite(dn)||Math.abs(dn)<1e-30)return{kind:'unavailable',reason:input.formula==='nova'?'NOVA_REF_DERIV_SINGULAR':'REF_DERIV_SINGULAR',length:0,values:[],failedStep:i,initialZ,constant,relax};
  const nr=addDD(mulDD(numerator[0],derivative[0]),mulDD(numerator[1],derivative[1])),ni=subDD(mulDD(numerator[1],derivative[0]),mulDD(numerator[0],derivative[1])),qr=divDD(nr,denom),qi=divDD(ni,denom);
  if(![dvalue(qr),dvalue(qi)].every(Number.isFinite))return{kind:'unavailable',reason:input.formula==='nova'?'NOVA_REF_STEP_INVALID':'REF_STEP_INVALID',length:0,values:[],failedStep:i,initialZ,constant,relax};
  z=[subDD(z[0],mulDD(qr,[relax,0])),subDD(z[1],mulDD(qi,[relax,0]))];if(input.formula==='nova')z=z.map((d,k)=>addDD(d,constant[k]));
 }
 return{kind:'ready',layout:'real-hi-low-imag-hi-low',length,values,initialZ,constant,relax,finalStateAfterLastPacked:clone(z)};
}
const context=(name,overrides={})=>({name,formula:'newton',variant:'mandelbrot',center:[2,0,0,0],mappedJulia:[1,0],power:2,relaxation:1,iterations:4,width:97,height:73,...overrides});
const referenceInputs=[
 context('newton-real-binary-p2'),
 context('newton-complex-low-center-p3',{center:[.73,2**-55,-.21,-(2**-57)],power:3,iterations:8}),
 context('nova-mandel-seed-not-center',{formula:'nova',center:[.02,2**-60,.01,0],mappedJulia:[1,0],power:3,iterations:8}),
 context('nova-julia-center-seed',{formula:'nova',variant:'julia',center:[.8,2**-55,.2,0],mappedJulia:[.01,.03],power:3,iterations:8}),
 context('newton-nearzero-23-height',{center:[1e-25,0,0,0],width:31,height:23}),
 context('newton-nearzero-47-height',{center:[1e-25,0,0,0],width:61,height:47}),
 context('newton-dd-low-collapsed-before-float-pack',{center:[2,2**-54,0,0]}),
 context('reference-nonpositive-relax-defaults-one',{relaxation:0}),
 context('reference-relax-f32',{relaxation:.7,center:[.91,0,.17,0],power:3}),
 ...[16,17,18].map(power=>context('reference-uncapped-power-'+power,{power,center:[1.01,0,.02,0]})),
 context('nova-zero-seed-whole-reference-unavailable',{formula:'nova',mappedJulia:[0,0]}),
 context('newton-huge-dimensions-bias-singularity',{center:[0,0,0,0],width:1e20,height:1e20}),
 context('reference-last-step-may-invalidate-whole-table',{center:[1e150,0,0,0],iterations:1}),
 context('reference-2048-cap-no-early-convergence',{center:[1,0,0,0],iterations:4096}),
];
const referenceVectors=referenceInputs.map(input=>{const expected=independentReference(input),array=Float32Array.from(expected.values);return {input,expected:{...expected,valueBits:Array.from(new Uint32Array(array.buffer)),valueSha256:sha(Buffer.from(array.buffer))}};});
check(referenceVectors[0].expected.values.slice(0,12).every((x,i)=>Object.is(x,[2,0,0,0,1.25,0,0,0,Math.fround(1.025),Math.fround(1.025-Math.fround(1.025)),0,0][i])),'independent DD binary/rational sanity failed');
check(referenceVectors.at(-1).expected.length===2048&&referenceVectors.at(-1).expected.values.every((x,i)=>x===(i%4===0?1:0)),'independent reference cap/root sanity failed');
check(referenceVectors.find(x=>x.input.name==='nova-zero-seed-whole-reference-unavailable').expected.reason==='NOVA_REF_DERIV_SINGULAR','reference must reject singular Nova instead of keeping a partial table');

if(process.argv.includes('--reference-only')){
 const directory=`.cache/fractal-newton-nova-reference-oracle-${Date.now()}`;await mkdir(directory,{recursive:true});
 const report={status:'independent-source-transcription-generated',scope:'Retained static Java DoubleDouble/reference bytecode transcribed to JS number operations; no production math imports, original JVM or browser execution. Explicit source-mapped contexts; full public mapping validation is separate.',evidence:Object.fromEntries(Object.entries(retained).map(([k,{text,...v}])=>[k,v])),oracleScript:{path:scriptPath,sha256:sha(await readFile(scriptPath))},vectors:referenceVectors,limitations:['Binary64 arithmetic ordering is transcribed; this is not original JVM runtime execution.','Shader DS uses a separate binary32 implementation and capped power helper; these DD reference vectors do not substitute for its actual GL oracle.']};
 await writeFile(directory+'/report.json',json(report),{flag:'wx'});await writeFile(directory+'/oracle.mjs',await readFile(scriptPath),{flag:'wx'});console.log(json({directory,report:directory+'/report.json',vectors:referenceVectors.length,sha256:sha(json(report))}));process.exit(0);
}


// Fragment-stage numerical oracle, assembled from retained artifacts. Actual
// interpolation/fragment arithmetic runs on the current WebGL2 driver. The
// original numerical loop is kept verbatim; only terminal color is replaced by
// four RGBA32F captures and observational counters. This is not original JOGL.
const partsDirectory='../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/fractal/parts/';
const extraParts=['fractal_header.glsl','formula_router.glsl','formula_param_slots.glsl','pipeline/fractal_pipeline_capabilities.glsl'];
const parts=Object.fromEntries(await Promise.all(extraParts.map(async name=>{const text=await readFile(partsDirectory+name,'utf8');return[name,{path:partsDirectory+name,text,sha256:sha(text)}];})));
function replaceOnce(text,from,to){check(text.split(from).length===2,'retained extraction anchor not unique: '+from);return text.replace(from,to);}
let numericalMain=retained.main.text.slice(0,retained.main.text.indexOf('    bool escaped;'));
check(numericalMain.length>10000,'retained numerical main extraction failed');
numericalMain=replaceOnce(numericalMain,'\n    if (perturbActive) {','\n    int probePerturbSteps=0,probeOrdinarySteps=0,probeGlitches=0;bool probeInitialPerturb=perturbActive;\n    if (perturbActive) {');
numericalMain=replaceOnce(numericalMain,'        if (perturbActive) {','        if (perturbActive) {\n            probePerturbSteps++;');
numericalMain=replaceOnce(numericalMain,'        } else {\n            vec2 zr_old = zr;','        } else {\n            probeOrdinarySteps++;\n            vec2 zr_old = zr;');
numericalMain=replaceOnce(numericalMain,'                    perturbActive = false;','                    probeGlitches++;perturbActive = false;');
numericalMain+=`\n probeZ=vec4(zr,zi);probeTerminal=vec4(float(iter),float(exitKind),finalResidual,convergenceThreshold2);
 probePaths=vec4(float(probePerturbSteps),float(probeOrdinarySteps),float(probeGlitches),probeInitialPerturb?1.:0.);
 probeOffset=vec4(ox,oy);\n}\n`;
// GLSL 150 sampler values have desktop float precision. ES 300 defaults sampler2D
// to lowp, so the retained shader adapter declares highp explicitly.
const oracleShader=parts['fractal_header.glsl'].text.replace('#version 150','#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;').replace('out vec4 fragColor;',`layout(location=0)out vec4 probeZ;layout(location=1)out vec4 probeTerminal;layout(location=2)out vec4 probePaths;layout(location=3)out vec4 probeOffset;`)+`
#define ENABLE_NEWTON 1
#define ENABLE_NOVA 1
#define FID_MANDELBROT 0
#define FID_JULIA 1
#define FID_NEWTON 2
#define FID_NOVA 3
#define FID_PHOENIX 4
#define FID_MAGNET1 5
#define FID_MAGNET2 6
#define FID_LAMBDA 7
#define FID_C_SIN 8
#define FID_SPIRAL_SEPTAGON 9
#define FID_BINOCULAR 10
// Nonselected trap/color declarations only. No trap/color result is asserted.
const int CID_DIRECT_ORBIT_TRAP=8,CID_ORBIT_TRAP_INDEX=10,CID_DISTANCE_ESTIMATOR=6;
uniform int u_insideColoringAlgorithm,u_outsideColoringAlgorithm;
uniform vec4 u_insideColoringParams0,u_insideColoringParams1,u_insideColoringParams2,u_outsideColoringParams0,u_outsideColoringParams1,u_outsideColoringParams2;
vec2 orbitTrapTransform(vec2 z,vec4 p){return z;}
float orbitTrapDistance(vec2 z,vec4 a,vec4 b){return 0.;}
vec3 directOrbitTrapColorByDistance(float d,vec2 r,vec2 i,vec4 a,vec4 b){return vec3(0.);}
float directOrbitTrapLayerAlpha(float d,vec4 a){return 0.;}
`+retained.math.text+'\n'+parts['formula_param_slots.glsl'].text+'\n'+retained.formula.text+`
// Probe restricts formula choice to Newton/Nova. Unselected other-family branch
// declarations satisfy the retained full loop; they are never oracle cases.
void evalFormulaFamilyStep(int fid,vec2 zr,vec2 zi,vec2 cr,vec2 ci,int ft,vec2 pr,vec2 pi,float relax,out vec2 nr,out vec2 ni){if(fid==FID_NEWTON)iterateNewton(zr,zi,pr,pi,relax,nr,ni);else iterateNova(zr,zi,cr,ci,pr,pi,relax,nr,ni);}
void iteratePhoenix(vec2 zr,vec2 zi,vec2 hr,vec2 hi,vec2 cr,vec2 ci,int p,int p2,vec2 dr,vec2 di,out vec2 nr,out vec2 ni){nr=zr;ni=zi;}
`+parts['formula_router.glsl'].text+'\n'+parts['pipeline/fractal_pipeline_capabilities.glsl'].text+'\n'+retained.init.text+'\n'+numericalMain;
const oracleVertex=`#version 300 es\nprecision highp float;layout(location=0)in vec2 position;layout(location=1)in vec2 texCoord;out vec2 vUv;void main(){vUv=texCoord;gl_Position=vec4(position,0.,1.);}`;

/** Own isolated retained fragment oracle. Resource limits bound test work, not
 * source file acceptance. Raw readPixels is flipped to caller top-row order. */
function createRetainedOracle(fragment,vertex){
 const assert=(v,m)=>{if(!v)throw Error(m);};
 const gl=new OffscreenCanvas(1,1).getContext('webgl2',{antialias:false,depth:false,alpha:false});assert(gl,'retained oracle WebGL2 unavailable');assert(gl.getExtension('EXT_color_buffer_float'),'retained oracle float framebuffer unavailable');
 const resources=[],keep=(kind,value)=>{assert(value,'oracle '+kind+' allocation');resources.push({kind,value});return value;};
 const program=keep('Program',gl.createProgram()),shaders=[];
 for(const[type,code]of[[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=keep('Shader',gl.createShader(type));shaders.push(shader);gl.shaderSource(shader,code);gl.compileShader(shader);assert(gl.getShaderParameter(shader,gl.COMPILE_STATUS),gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}
 gl.linkProgram(program);assert(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));
 const vao=keep('VertexArray',gl.createVertexArray()),buffer=keep('Buffer',gl.createBuffer()),fbo=keep('Framebuffer',gl.createFramebuffer()),textures=Array.from({length:4},()=>keep('Texture',gl.createTexture())),reference=keep('Texture',gl.createTexture());
 gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
 // Original QUADS TL,TR,BR,BL with Processing triangles [0,1,2,2,3,0].
 gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,1,0,0, 1,1,1,0, 1,-1,1,1, 1,-1,1,1, -1,-1,0,1, -1,1,0,0]),gl.STATIC_DRAW);
 for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,2,gl.FLOAT,false,16,i*8);}
 let draws=0,reads=0,allocatedSize='';
 const location=name=>gl.getUniformLocation(program,name),f=(name,value)=>gl.uniform1f(location(name),value),i=(name,value)=>gl.uniform1i(location(name),value),v2=(name,value)=>gl.uniform2fv(location(name),value);
 const split=n=>{const hi=Math.fround(n);return[hi,Math.fround(n-hi)];};
 return{
  run(input){const {width,height}=input;assert(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width*height<=1e6,'oracle test dimensions');gl.useProgram(program);gl.bindVertexArray(vao);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,width,height);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DITHER);
   if(allocatedSize!==`${width}:${height}`){textures.forEach((texture,index)=>{gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+index,gl.TEXTURE_2D,texture,0);});allocatedSize=`${width}:${height}`;}
   gl.drawBuffers([0,1,2,3].map(n=>gl.COLOR_ATTACHMENT0+n));assert(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'oracle framebuffer incomplete');
   const centerR=input.shaderCenter.slice(0,2),centerI=input.shaderCenter.slice(2),juliaR=split(input.mappedJulia[0]),juliaI=split(input.mappedJulia[1]),zoom=split(input.zoom);
   v2('u_resolution',input.logicalSize??[width,height]);v2('u_centerHigh',[centerR[0],centerI[0]]);v2('u_centerLow',[centerR[1],centerI[1]]);v2('u_zoomDS',zoom);v2('u_juliaConstantHigh',[juliaR[0],juliaI[0]]);v2('u_juliaConstantLow',[juliaR[1],juliaI[1]]);
   f('u_rotation',input.rotation);f('u_previewScale',1);f('u_bailout',input.bailout);f('u_perturbationThreshold',input.glitchThreshold);f('u_perturbationAbsFactor',input.glitchAbsFactor);f('u_perturbationRelLimit',input.glitchRelLimit);
   for(const[name,value]of Object.entries({u_formulaId:input.formula==='newton'?2:3,u_type:input.variant==='julia'?1:0,u_formulaType:0,u_power:Math.round(input.power[0]),u_formulaSupportsPerturbation:1,u_iterations:input.iterations,u_usePerturbation:input.reference?.kind==='ready'?1:0,u_refOrbitLen:input.reference?.length??0,u_refOrbitTex:0,u_insideColoringAlgorithm:1,u_outsideColoringAlgorithm:1}))i(name,value);
   gl.uniform4fv(location('u_formulaParams'),[input.power[0],input.relaxation,0,0]);gl.uniform1fv(location('u_dynamicParams[0]'),Float32Array.from({length:32},(_,n)=>n===0?input.power[0]:n===1?input.power[1]:n===2?input.relaxation:0));
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,reference);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,input.reference?.length||1,1,0,gl.RGBA,gl.FLOAT,Float32Array.from(input.reference?.values.length?input.reference.values:[0,0,0,0]));
   gl.drawArrays(gl.TRIANGLES,0,6);draws++;const outputs=[];
   for(let attachment=0;attachment<4;attachment++){gl.readBuffer(gl.COLOR_ATTACHMENT0+attachment);const raw=new Float32Array(width*height*4),top=new Float32Array(raw.length);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,raw);reads++;for(let y=0;y<height;y++)top.set(raw.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);outputs.push(top);}
   assert(gl.getError()===gl.NO_ERROR,'retained oracle GL error');return {z:outputs[0],terminal:outputs[1],paths:outputs[2],offset:outputs[3]};
  },
  dispose(){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);for(const s of shaders)gl.detachShader(program,s);for(const {kind,value}of [...resources].reverse())gl['delete'+kind](value);const alive=resources.filter(({kind,value})=>gl['is'+kind](value)).map(x=>x.kind);assert(!alive.length,'retained oracle leaked '+alive.join(','));gl.getExtension('WEBGL_lose_context')?.loseContext();return{draws,readbacks:reads,ownedGlObjects:resources.length,alive:[]};}
 };
}
const orbitCase=(name,extra={})=>({name,width:9,height:7,logicalSize:[9,7],formula:'newton',variant:'mandelbrot',center:[2,0,.1,0],mappedJulia:[1,0],power:[2,0],relaxation:1,iterations:12,zoom:2,rotation:0,bailout:1e-6,glitchThreshold:1e-4,glitchAbsFactor:16,glitchRelLimit:.01,...extra});
const orbitInputs=[
 orbitCase('ordinary-newton-p2'),orbitCase('ordinary-newton-authored-julia-forced-mandel',{variant:'julia'}),
 ...[[3,0],[16,0],[2.5,0],[2,.2]].map(power=>orbitCase('ordinary-newton-power-'+power.join('_'),{power})),
 orbitCase('ordinary-nova-mandel',{formula:'nova',center:[.1,0,.02,0],mappedJulia:[1,0]}),
 orbitCase('ordinary-nova-julia',{formula:'nova',variant:'julia',center:[.8,0,.1,0],mappedJulia:[.01,.02]}),
 orbitCase('ordinary-nova-complex',{formula:'nova',power:[2.5,.1],center:[.1,0,.03,0]}),
 orbitCase('strict-boundary-equal',{width:1,height:1,logicalSize:[1,1],center:[2,0,0,0],iterations:1,bailout:.75}),
 orbitCase('strict-boundary-above',{width:1,height:1,logicalSize:[1,1],center:[2,0,0,0],iterations:1,bailout:.7500001}),
 orbitCase('ordinary-singular-newton-hold',{width:1,height:1,logicalSize:[1,1],center:[0,0,0,0],iterations:3}),
 orbitCase('ordinary-singular-nova-still-add-c',{width:1,height:1,logicalSize:[1,1],formula:'nova',center:[.1,0,.2,0],mappedJulia:[0,0],iterations:1}),
 orbitCase('ordinary-nonfinite-still-inside',{width:1,height:1,logicalSize:[1,1],center:[1e20,0,0,0],power:[16,0],iterations:3}),
 ...[2,3,16,17,18].map(p=>orbitCase('rational-newton-p'+p,{center:[.91,2**-56,.17,0],power:[p,0],zoom:1e5,perturb:true,iterations:48})),
 orbitCase('rational-nova-mandel',{formula:'nova',center:[.01,0,.02,0],zoom:1e5,perturb:true,iterations:48}),
 orbitCase('rational-nova-julia',{formula:'nova',variant:'julia',center:[.91,0,.17,0],mappedJulia:[.01,.02],zoom:1e5,perturb:true,iterations:48}),
 orbitCase('rational-last-reference-no-next-test',{width:1,height:1,logicalSize:[1,1],center:[2,0,0,0],zoom:1e6,perturb:true,iterations:1,bailout:1}),
 orbitCase('rational-glitch-resumes-current-z',{center:[.001,0,.002,0],zoom:100,perturb:true,iterations:16,glitchThreshold:1e-30,glitchRelLimit:1e-12,glitchAbsFactor:1}),
 orbitCase('rational-deep-adjacent-low-center',{center:[.91,2**-55,.17,-(2**-58)],zoom:1e14,perturb:true,iterations:3}),
 orbitCase('nova-resolution-small',{formula:'nova',center:[.1,0,.03,0],zoom:1e4,perturb:true,logicalSize:[9,7],bailout:1e-3}),
 orbitCase('nova-resolution-large',{formula:'nova',center:[.1,0,.03,0],zoom:1e4,perturb:true,logicalSize:[257,193],bailout:1e-3}),
 orbitCase('rational-reference2048-cap',{width:1,height:1,logicalSize:[1,1],center:[1,0,0,0],zoom:1e6,perturb:true,iterations:4096,bailout:1e-12,legacyPointTrap:true,nearestExpected:1}),
 // Larger rectangular rasters and nonzero rotations exercise retained varying
 // interpolation and the complete fragment path, not supplied CPU offsets.
 orbitCase('rotated-ordinary-newton-noninteger',{width:65,height:47,logicalSize:[65,47],rotation:.37,power:[2.5,0],center:[.73,2**-56,-.21,-(2**-58)],iterations:37}),
 orbitCase('rotated-ordinary-nova-julia-complex',{width:47,height:65,logicalSize:[47,65],formula:'nova',variant:'julia',rotation:-.61,power:[2.5,.1],center:[.8,0,.1,0],mappedJulia:[.01,.02],iterations:41}),
 orbitCase('rotated-rational-newton-p17',{width:53,height:37,logicalSize:[53,37],rotation:.73,power:[17,0],center:[.97,2**-55,.03,-(2**-58)],zoom:1e6,perturb:true,iterations:64}),
 orbitCase('rotated-rational-nova-mandel-distinct-seeds',{width:37,height:53,logicalSize:[37,53],formula:'nova',rotation:-1.13,power:[3,0],center:[.005,2**-58,.002,0],start:[.93,.12],julia:[-.23,.07],mappedJulia:[.93,.12],zoom:1e6,perturb:true,iterations:64}),
 // FormulaRuntimeMapper chooses start_value for Mandel and julia_seed for
 // Julia. Keeping both authored pairs distinct prevents a fixture from hiding
 // a mapper that always selects the same field.
 orbitCase('ordinary-nova-mandel-distinct-seeds',{width:21,height:15,logicalSize:[21,15],formula:'nova',center:[.02,0,.01,0],start:[.91,.17],julia:[-.13,.08],mappedJulia:[.91,.17],iterations:53}),
 orbitCase('ordinary-nova-julia-distinct-seeds',{width:21,height:15,logicalSize:[21,15],formula:'nova',variant:'julia',center:[.8,0,.1,0],start:[.91,.17],julia:[-.13,.08],mappedJulia:[-.13,.08],iterations:53}),
 // Small relaxation keeps a non-root reference in motion for many updates.
 // The runtime oracle must witness at least 128 perturbation steps per pixel;
 // merely allocating a long table or immediately converging does not pass.
 orbitCase('long-perturb-newton-p3',{width:17,height:13,logicalSize:[17,13],center:[.91,2**-56,.17,-(2**-58)],power:[3,0],relaxation:.01,rotation:.19,zoom:1e6,perturb:true,iterations:384,bailout:1e-12,minPerturbSteps:128}),
 orbitCase('long-perturb-nova-mandel-p3',{width:17,height:13,logicalSize:[17,13],formula:'nova',center:[.0001,0,.0002,0],mappedJulia:[.91,.17],power:[3,0],relaxation:.01,rotation:-.29,zoom:1e6,perturb:true,iterations:384,bailout:1e-12,minPerturbSteps:128}),
].map(input=>{const center=[addDD([input.center[0],0],[input.center[1],0]),addDD([input.center[2],0],[input.center[3],0])],shaderCenter=center.flatMap(([h,l])=>[Math.fround(h),Math.fround((h-Math.fround(h))+l)]),progress=Math.min(1,Math.max(0,(Math.log10(Math.max(1,input.zoom))-2)/28));return {...input,shaderCenter,glitchThreshold:Math.fround(1e-4),glitchAbsFactor:Math.fround(4096*(1+progress*.5)),glitchRelLimit:Math.fround(1e6*(1+progress*9)),reference:input.perturb?independentReference({formula:input.formula,variant:input.formula==='newton'?'mandelbrot':input.variant,center:input.center,mappedJulia:input.mappedJulia,power:Math.round(input.power[0]),relaxation:input.relaxation,iterations:input.iterations,width:input.logicalSize[0],height:input.logicalSize[1]}):undefined};});
if(process.argv.includes('--prepare-only')){const directory=`.cache/fractal-newton-nova-oracle-prepared-${Date.now()}`;await mkdir(directory,{recursive:true});await writeFile(directory+'/oracle.frag',oracleShader,{flag:'wx'});await writeFile(directory+'/oracle.vert',oracleVertex,{flag:'wx'});await writeFile(directory+'/inputs.json',json(orbitInputs),{flag:'wx'});console.log(json({directory,cases:orbitInputs.length,shaderSha256:sha(oracleShader),status:'prepared-not-executed'}));process.exit(0);}


async function sourceFiles(directory){const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const p=directory+'/'+entry.name;if(entry.isDirectory())result.push(...await sourceFiles(p));else if(entry.isFile())result.push(p);else throw Error('Unexpected source entry '+p);}return result;}
const sourceHashes=async()=>Object.fromEntries(await Promise.all([...(await sourceFiles('src')),scriptPath].sort().map(async path=>[path,sha(await readFile(path))])));
const directory=`.cache/fractal-newton-nova-source-run-${Date.now()}`;await mkdir(directory,{recursive:true});
const artifact=name=>directory+'/'+name,report={at:new Date().toISOString(),status:'running',scope:'Independent retained Java-DD and GLSL numerical expectations versus current production WebGL2 orbit and actual Generator Worker. Native quad varying interpolation in fragment oracle, supplied-offset bridge separated. No original application/JVM/JOGL execution, native OS DPI, native color or complete original-pixel parity.',sourceBefore:await sourceHashes(),evidence:Object.fromEntries(Object.entries({...retained,...parts}).map(([k,{text,...v}])=>[k,v])),artifacts:{directory},pageErrors:[],checks:{}};
await writeFile(artifact('verifier.mjs'),await readFile(scriptPath),{flag:'wx'});await writeFile(artifact('retained-oracle.frag'),oracleShader,{flag:'wx'});await writeFile(artifact('retained-oracle.vert'),oracleVertex,{flag:'wx'});await writeFile(artifact('reference-vectors.json'),json(referenceVectors),{flag:'wx'});await writeFile(artifact('orbit-inputs.json'),json(orbitInputs),{flag:'wx'});
let server,browser,page,failure;const started=performance.now();
try{
 server=await createServer({server:{host:'127.0.0.1',port:5468,strictPort:true,hmr:false},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
 await page.route('**/newton-nova-source-probe',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Independent source Newton/Nova validation</title>'}));await page.goto(server.resolvedUrls.local[0]+'newton-nova-source-probe');
 report.results=await page.evaluate(async({oracleShader,oracleVertex,oracleFactory,referenceVectors,orbitInputs})=>{
  const check=(v,m)=>{if(!v)throw Error(m);},equal=(a,b)=>Object.is(a,b)||Number.isNaN(a)&&Number.isNaN(b),hash=async a=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const result=window.__sourceNumerics={references:[],orbits:[],boundaries:[],worker:[],diagnostics:{},cleanup:{}};
  const prototype=WebGL2RenderingContext.prototype,original={},contexts=new Map(),kinds=['Buffer','VertexArray','TransformFeedback','Texture','Framebuffer','Program','Shader'];let label='setup';
  const state=gl=>{if(!contexts.has(gl))contexts.set(gl,{objects:[],draws:[],reads:0,preLoss:undefined});return contexts.get(gl);};
  const patch=(name,method)=>{original[name]=prototype[name];prototype[name]=method;};
  for(const kind of kinds)patch('create'+kind,function(...args){const value=original['create'+kind].apply(this,args);if(value)state(this).objects.push({kind,value});return value;});
  patch('drawArrays',function(...args){state(this).draws.push({label,args});return original.drawArrays.apply(this,args);});
  patch('readPixels',function(...args){state(this).reads++;return original.readPixels.apply(this,args);});
  patch('getBufferSubData',function(...args){state(this).reads++;return original.getBufferSubData.apply(this,args);});
  patch('getExtension',function(name){const ext=original.getExtension.call(this,name);if(name==='WEBGL_lose_context'&&ext){const lose=ext.loseContext.bind(ext);return{loseContext:()=>{state(this).preLoss=state(this).objects.filter(({kind,value})=>this['is'+kind](value)).map(x=>x.kind);return lose();},restoreContext:ext.restoreContext.bind(ext)};}return ext;});
  const WorkerClass=window.Worker;let workers=0,terminated=0;window.Worker=class extends WorkerClass{constructor(...args){super(...args);workers++;const terminate=this.terminate.bind(this);let done=false;this.terminate=()=>{if(!done){terminated++;done=true;}return terminate();};}};
  let oracle,gpu,generator,primaryFailure,cleanupFailure;
  try{
   const{prepareFractalSourcePlan,buildFractalSourceReference}=await import('/src/engine/fractalSourcePrecision.ts'),{FractalSourceNewtonGpu}=await import('/src/engine/fractalNativeNewtonGpu.ts'),{fractalConfig,definitions}=await import('/src/scenes/complex.ts'),{createScene}=await import('/src/engine/document.ts'),{Generator}=await import('/src/engine/client.ts');
   const base=createScene(definitions.find(x=>x.kind==='fractal'));
   function context(input){const settings={...base.settings,fractalNumericProfile:'mathart-1.7.8-newton-nova-v1',fractalColorVersion:2,fractalDistanceVersion:'mathart-1.7.8-v1',outsideColoring:'distance_estimator',insideColoring:'none',formula:input.formula,variant:input.variant,power:input.power[0],powerImag:input.power[1],startReal:(input.start??input.mappedJulia)[0],startImag:(input.start??input.mappedJulia)[1],juliaReal:(input.julia??input.mappedJulia)[0],juliaImag:(input.julia??input.mappedJulia)[1],iterations:input.iterations,tolerance:input.bailout,relaxation:input.relaxation,centerX:input.center[0],centerXLow:input.center[1],centerY:input.center[2],centerYLow:input.center[3],zoom:input.zoom,rotation:input.rotation,perturbationPrecision:'medium',fractalBackend:'webgl2',...(input.legacyPointTrap?{trapShape:'point',trapReal:0,trapImag:0,trapAspect:1,trapRotation:0}:{})};
    // Typed actual producer inputs bypass unrelated old authoring clamps; public
    // Worker cases below additionally consume the real Settings parser.
    const c={...fractalConfig(settings),numericProfile:'mathart-1.7.8-newton-nova-v1',formula:input.formula,variant:input.variant,power:input.power,start:input.start??input.mappedJulia,julia:input.julia??input.mappedJulia,iterations:input.iterations,tolerance:input.bailout,relaxation:input.relaxation};
    const view={centerX:input.center[0],centerXLow:input.center[1],centerY:input.center[2],centerYLow:input.center[3],zoom:input.zoom,rotation:input.rotation};
    const prepared=prepareFractalSourcePlan(c,view,{logicalWidth:input.logicalSize[0],logicalHeight:input.logicalSize[1],provenance:'requested-output-local'},{precision:'medium'});check(prepared.ok,input.name+' actual plan failed '+JSON.stringify(prepared));return{c,view,plan:prepared.value,settings};
   }
   for(const row of referenceVectors){const input=row.input,typed={formula:input.formula,variant:input.variant,power:[input.power,0],start:input.mappedJulia,julia:input.mappedJulia,iterations:input.iterations,tolerance:1e-6,relaxation:input.relaxation},view={centerX:input.center[0],centerXLow:input.center[1],centerY:input.center[2],centerYLow:input.center[3],zoom:1000,rotation:0},prepared=prepareFractalSourcePlan(typed,view,{logicalWidth:input.width,logicalHeight:input.height,provenance:'source-logical'},{precision:'medium'});check(prepared.ok,input.name+' reference admission failed '+JSON.stringify(prepared));const actual=buildFractalSourceReference(prepared.value),expected=row.expected;check(actual.kind===expected.kind,input.name+' reference kind mismatch');
    const facts={name:input.name,kind:actual.kind,length:actual.length};if(actual.kind==='ready'){const bits=new Uint32Array(actual.values.buffer,actual.values.byteOffset,actual.values.length);check(bits.length===expected.valueBits.length&&bits.every((v,i)=>v===expected.valueBits[i]),input.name+' retained DD/reference bits differ');facts.valueSha256=await hash(actual.values);facts.float32Components=actual.values.length;facts.exact=true;}else{check(actual.reason===expected.reason,input.name+' reference failure differs');facts.reason=actual.reason;facts.failedStep=actual.failedStep;}
    result.references.push(facts);
   }
   oracle=(0,eval)('('+oracleFactory+')')(oracleShader,oracleVertex);gpu=new FractalSourceNewtonGpu();
   const orbitMismatches=[];for(const input of orbitInputs){label=input.name;const {c,view,plan}=context(input),reference=buildFractalSourceReference(plan),expected=oracle.run(input),actualReference=reference.kind==='ready'?reference:undefined;
    check(plan.isJulia===(input.formula==='nova'&&input.variant==='julia'),input.name+' source mapper variant mismatch');if(input.formula==='nova')check(plan.sourceJuliaConstant.every((n,i)=>Object.is(n,input.mappedJulia[i])),input.name+' source mapper selected the wrong authored start/Julia pair');check(plan.shaderCenter.every((n,i)=>Object.is(n,input.shaderCenter[i])),input.name+' shader center packing differs');
    check(plan.perturbation.threshold===input.glitchThreshold&&plan.perturbation.absFactor===input.glitchAbsFactor&&plan.perturbation.relLimit===input.glitchRelLimit,input.name+' retained glitch controls differ');
    if(input.reference?.kind==='ready'){check(reference.kind==='ready'&&reference.values.length===input.reference.values.length&&reference.values.every((v,i)=>equal(v,input.reference.values[i])),input.name+' oracle/production reference mismatch');}else check(reference.kind!=='ready',input.name+' unexpected reference');
    const points=Float32Array.from({length:input.width*input.height*2},(_,i)=>i%2?Math.floor((i>>1)/input.width):(i>>1)%input.width);label=input.name+':bridge';const bridge=gpu.sampleOffsets(expected.offset,c,plan,actualReference);label=input.name+':raster';const raster=gpu.sample(points,input.width,input.height,view,c,plan);
    const coordinateCapture={applicability:'not-applicable',reason:'Production coordinates and orbit now execute in the same complete fragment invocation; attachment 0 stores final DS z, not an independently reusable coordinate prepass.'};

    const compare=(batch,scope)=>{check(batch.values&&batch.residual&&batch.source&&batch.distance,input.name+' missing actual GPU fact buffers '+scope);const diffs=[];let converged=0,glitches=0,perturb=0,ordinary=0,minPerturb=Infinity,maxPerturb=0;
     for(let pixel=0;pixel<points.length/2;pixel++){const v=pixel*8,q=pixel*4,d=pixel*12,observed=[batch.values[v],batch.residual[v],batch.values[v+1],batch.residual[v+1]],expectedZ=expected.z.subarray(q,q+4);for(let k=0;k<4;k++)if(!equal(observed[k],expectedZ[k]))diffs.push({pixel,field:'z'+k,actual:observed[k],expected:expectedZ[k]});
      const actualTerminal=[batch.residual[v+7],batch.values[v+3]===4?2:0,batch.distance[d+8]],expectedTerminal=expected.terminal.subarray(q,q+3);for(let k=0;k<3;k++)if(!equal(actualTerminal[k],expectedTerminal[k]))diffs.push({pixel,field:'terminal'+k,actual:actualTerminal[k],expected:expectedTerminal[k]});
      const actualPath=[batch.source[q+3],batch.source[q+2],batch.source[q+1],batch.source[q]],expectedPath=expected.paths.subarray(q,q+4);for(let k=0;k<4;k++)if(!equal(actualPath[k],expectedPath[k]))diffs.push({pixel,field:'path'+k,actual:actualPath[k],expected:expectedPath[k]});
      if(input.nearestExpected!==undefined)check(batch.values[v+6]===input.nearestExpected,input.name+' independent constant-root point-trap nearest differs '+scope);minPerturb=Math.min(minPerturb,batch.source[q+3]);maxPerturb=Math.max(maxPerturb,batch.source[q+3]);check(batch.values[v+7]===0,input.name+' unexpectedly requested CPU repair');converged+=batch.values[v+3]===4?1:0;glitches+=batch.source[q+1];ordinary+=batch.source[q+2];perturb+=batch.source[q+3];
     }
     return{scope,pixels:points.length/2,differenceCount:diffs.length,differences:diffs.slice(0,24),converged,glitches,ordinarySteps:ordinary,perturbSteps:perturb,minPerturbSteps:minPerturb,maxPerturbSteps:maxPerturb,...(input.nearestExpected===undefined?{}:{legacyNearest:{expected:input.nearestExpected,actual:batch.values[6],scope:'Analytic constant z=1 and point-trap center=0/aspect=1; not complete local trap/color coverage.'}})};};
    const row={name:input.name,coordinateCapture,width:input.width,height:input.height,logicalSize:input.logicalSize,reference:reference.kind,bridge:compare(bridge,'supplied retained-fragment DS offsets'),raster:compare(raster,'actual native-quad complete production fragment'),oracle:{zSha256:await hash(expected.z),terminalSha256:await hash(expected.terminal),offsetSha256:await hash(expected.offset),firstZ:Array.from(expected.z.slice(0,4)),firstTerminal:Array.from(expected.terminal.slice(0,4)),firstPath:Array.from(expected.paths.slice(0,4))},plan:{authoredVariant:plan.authoredVariant,isJulia:plan.isJulia,authoredStart:c.start,authoredJulia:c.julia,sourceJuliaConstant:plan.sourceJuliaConstant,rotation:plan.rotation,power:plan.shaderPower,referencePower:plan.reference.power,stopRules:plan.stopRules}};
    result.orbits.push(row);
    if(input.minPerturbSteps!==undefined){let oracleMin=Infinity,oracleMax=0;for(let p=0;p<expected.paths.length;p+=4){oracleMin=Math.min(oracleMin,expected.paths[p]);oracleMax=Math.max(oracleMax,expected.paths[p]);}row.longPerturbWitness={requiredMinimum:input.minPerturbSteps,oracleMinimum:oracleMin,oracleMaximum:oracleMax,referenceLength:reference.length};check(oracleMin>=input.minPerturbSteps&&row.bridge.minPerturbSteps>=input.minPerturbSteps&&row.raster.minPerturbSteps>=input.minPerturbSteps,input.name+' did not actually run the required many-step perturbation path');}
    if(input.nearestExpected!==undefined)check(expected.z[0]===1&&expected.z[1]===0&&expected.z[2]===0&&expected.z[3]===0,input.name+' nearest analytic witness is not the fixed root z=1');
    if(row.bridge.differenceCount||row.raster.differenceCount)orbitMismatches.push({name:input.name,bridgeDifferences:row.bridge.differenceCount,rasterDifferences:row.raster.differenceCount});
   }
   check(!orbitMismatches.length,'Actual GPU differs from independent retained oracle '+JSON.stringify(orbitMismatches));
   const by=name=>result.orbits.find(x=>x.name===name);check(by('strict-boundary-equal').raster.converged===0&&by('strict-boundary-above').raster.converged===1,'strict threshold witness missing');
   check(by('ordinary-singular-newton-hold').oracle.firstZ.every(x=>x===0),'singular Newton must hold zero');check(by('ordinary-nonfinite-still-inside').raster.converged===0,'nonfinite source falsely terminated as converged');
   check(by('rational-last-reference-no-next-test').oracle.firstZ[0]===2&&by('rational-last-reference-no-next-test').raster.converged===0,'last reference/current z witness missing');
   check(result.orbits.some(x=>x.raster.glitches>0&&x.raster.ordinarySteps>0&&x.raster.perturbSteps>0),'No actual mixed perturb-to-ordinary fallback witness');
   check(by('nova-resolution-small').oracle.firstTerminal[3]!==by('nova-resolution-large').oracle.firstTerminal[3],'Nova tolerance did not change with logical resolution');
   result.diagnostics.gpu=gpu.diagnostics();check(result.diagnostics.gpu.rasterDraws>0&&result.diagnostics.gpu.rasterAllocations>0&&result.diagnostics.gpu.draws>0&&result.diagnostics.gpu.samples>0,'production did not execute actual GPU');
   const cancelInput=orbitInputs[0],ctx=context(cancelInput);let cancelled;try{gpu.sampleOffsets(new Float32Array(4),ctx.c,ctx.plan,undefined,undefined,()=>true);}catch(e){cancelled={name:e.name,message:e.message};}check(cancelled?.name==='AbortError','source cancellation did not propagate');result.boundaries.push({kind:'preflight-cancel',error:cancelled});
   let capacity;try{gpu.sampleOffsets(new Float32Array(65537*4),ctx.c,ctx.plan,undefined);}catch(e){capacity={name:e.name,kind:e.kind??e.failure?.kind,message:e.message};}check(capacity&&/65536|capacity/i.test(capacity.message),'source capacity not rejected');result.boundaries.push({kind:'sample-capacity',error:capacity});
   const resumed=gpu.sampleOffsets(new Float32Array(4),ctx.c,ctx.plan,undefined);check(resumed.values?.length===8,'GPU did not recover after rejected/cancelled input');result.boundaries.push({kind:'post-rejection-reuse',passed:true});
   generator=new Generator();const generation=(scene,width,height)=>generator.generate(scene,{time:0,width,height,quality:'export',fractalViewport:{logicalWidth:width,logicalHeight:height,target:'offscreen'}});
   for(const name of ['ordinary-newton-p2','ordinary-nova-julia','rational-newton-p3','rational-nova-mandel']){const input=orbitInputs.find(x=>x.name===name),{settings}=context(input),scene={...structuredClone(base),id:'source-worker-'+name,name,settings:{...settings,renderMethod:'one-pass'},timeline:{...base.timeline,tracks:[],duration:1}},t=performance.now(),out=await generation(scene,input.width,input.height);check(out.type==='raster'&&out.backend==='webgl2'&&out.pixels.length===input.width*input.height*4,name+' Worker did not use real WebGL2');const again=await generation(scene,input.width,input.height);check(again.backend==='webgl2'&&again.pixels.every((v,i)=>v===out.pixels[i]),name+' same-request Worker replay changed');for(const [requestIndex,frame]of [out,again].entries()){const facts=frame.fractalRender;check(facts?.profile==='mathart-1.7.8-newton-nova-v1'&&facts.precision==='medium',name+' missing actual source frame facts');check(facts.logicalSize[0]===input.width&&facts.logicalSize[1]===input.height&&facts.logicalSizeProvenance==='requested-output-local',name+' actual logical dimensions/provenance mismatch');check(facts.execution.backend==='webgl2'&&facts.execution.cpuOrbitSamples===0&&facts.execution.probeSamples===0&&facts.execution.samples===input.width*input.height,name+' actual request did not execute precisely the one-pass GPU pixels');if(requestIndex===1)check(facts.reference.builds===0&&facts.reference.uploads===0,name+' repeated request rebuilt or uploaded reference');}
    result.worker.push({name,actualBackend:out.backend,width:out.width,height:out.height,sha256:await hash(out.pixels),stats:out.stats,warnings:out.warnings,fractalRender:out.fractalRender,repeatFractalRender:again.fractalRender,elapsedMs:performance.now()-t});}
  }catch(error){primaryFailure=error;result.primaryError={name:error.name,message:String(error),stack:error.stack};}finally{
   const failures=[];for(const [name,owner]of [['generator',generator],['gpu',gpu],['oracle',oracle]])if(owner)try{result.cleanup[name]=owner.dispose()??{disposed:true};}catch(error){failures.push(name+': '+String(error));}
   result.cleanup.workers={created:workers,terminated,alive:workers-terminated};result.cleanup.contexts=Array.from(contexts.entries()).map(([gl,s])=>({objects:s.objects.length,draws:s.draws,reads:s.reads,live:s.preLoss??s.objects.filter(({kind,value})=>gl['is'+kind](value)).map(x=>x.kind)}));
   for(const[name,method]of Object.entries(original))prototype[name]=method;window.Worker=WorkerClass;
   if(workers!==terminated||!result.cleanup.contexts.every(x=>x.live.length===0)||failures.length){cleanupFailure=Error('actual resource cleanup failed '+JSON.stringify({failures,cleanup:result.cleanup}));result.cleanupError={name:cleanupFailure.name,message:cleanupFailure.message,stack:cleanupFailure.stack};}
  }
  const errors=[primaryFailure,cleanupFailure].filter(Boolean);if(errors.length)throw new AggregateError(errors,errors.map(error=>String(error)).join('\nAdditionally: '));
  return result;
 },{oracleShader,oracleVertex,oracleFactory:createRetainedOracle.toString(),referenceVectors,orbitInputs});
 report.status='passed';report.checks={referenceVectors:report.results.references.length,orbitCases:report.results.orbits.length,workerRequests:report.results.worker.length*2,boundaries:report.results.boundaries.length,nonzeroRotationCases:report.results.orbits.filter(x=>x.plan.rotation!==0).length,distinctAuthoredSeedCases:report.results.orbits.filter(x=>x.plan.authoredStart.some((v,i)=>v!==x.plan.authoredJulia[i])).length,manyStepPerturbCases:report.results.orbits.filter(x=>x.longPerturbWitness).length,analyticLegacyNearestCases:report.results.orbits.filter(x=>x.raster.legacyNearest).length,actualWebGL2:true,independentRetainedOracle:true,originalRuntimeExecuted:false};
}catch(error){failure=error;report.status='failed';report.error={message:String(error),stack:error?.stack};if(page)try{report.results=await page.evaluate(()=>window.__sourceNumerics);}catch{};}
finally{
 const outerFailures=[];
 if(browser)try{await browser.close();report.browserClosed=!browser.isConnected();if(!report.browserClosed)throw Error('Browser remained connected after close');}catch(error){report.browserCleanupError=String(error);outerFailures.push(error);}
 if(server)try{await server.close();report.viteClosed=!server.httpServer?.listening;if(!report.viteClosed)throw Error('Vite server remained listening after close');}catch(error){report.viteCleanupError=String(error);outerFailures.push(error);}
 try{report.sourceAfter=await sourceHashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable)outerFailures.push(Error('Source changed while verification ran'));}catch(error){report.sourceSnapshotError=String(error);report.sourceStable=false;outerFailures.push(error);}
 if(report.pageErrors.length)outerFailures.push(Error('Unexpected page errors: '+report.pageErrors.join('; ')));
 if(outerFailures.length){report.status='failed';report.outerErrors=outerFailures.map(error=>({message:String(error),stack:error?.stack}));failure=new AggregateError([failure,...outerFailures].filter(Boolean),'Numerical verification or outer cleanup/freshness failed');}
 report.elapsedMs=performance.now()-started;await writeFile(artifact('report.json'),json(report),{flag:'wx'});console.log(json({report:artifact('report.json'),status:report.status,sourceStable:report.sourceStable,elapsedMs:report.elapsedMs,outerErrors:report.outerErrors}));
}
if(failure)throw failure;
