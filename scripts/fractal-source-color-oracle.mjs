// Independent retained-bytecode transcription for verifier expectations only.
// No module under src/ is imported here. Source locations are exported below.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const F=Math.fround;
const add=(a,b)=>F(a+b),sub=(a,b)=>F(a-b),mul=(a,b)=>F(a*b),div=(a,b)=>F(a/b);
const fract=x=>sub(x,F(Math.floor(x))),clamp=x=>Math.max(0,Math.min(1,x));
export const ALGORITHMS=['none','basic','smooth_mandelbrot','decomposition','binary_decomposition','distance_estimator','direct_domain','direct_orbit_trap','direct_normalized_z','orbit_trap_index'];
export const TRANSFERS=['none','linear','sqr','sqrt','cube','cuberoot','log','exp','sin','arctan'];
export const SOURCE_EVIDENCE={
 fragment:'../.cache/mathart-investigation/MathArt.app/Contents/app/data/shader/fractal_frag.glsl',
 host:'../.cache/mathart-investigation/nova-convergence-bytecode.json',
 catalog:'.cache/fractal-source-color-catalog.json',
 palette:'.cache/domain-source-PaletteRuntime-bytecode.json',
 manim:'.cache/domain-source-ManimColors-bytecode.json',
 binder:'.cache/fractal-de-source/color-binder-bytecode.json',
 mapper:'../.cache/mathart-investigation/nova-runtime-mapper-bytecode.json',
 reference:'.cache/fractal-newton-nova-reference-service-next.json',
};
export async function retainedInputs(){
 const entries=await Promise.all(Object.entries(SOURCE_EVIDENCE).map(async([name,path])=>{const bytes=await readFile(path);return[name,{path,sha256:hash(bytes),text:bytes.toString('utf8')}];}));
 const sources=Object.fromEntries(entries);
 if(sources.fragment.sha256!=='9e38efc9674e18309db8eb155337e840e97a08b14818fecf280e6937ca363a3b')throw Error('Retained full fragment changed');
 // The full original shader is retained, including every coloring and trace
 // branch. These are interface adaptations, not replacement arithmetic.
 let fragment=sources.fragment.text;
 for(const[from,to]of[['#version 150','#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;'],['out vec4 fragColor;','layout(location=0) out vec4 fragColor;']]){
  if(fragment.split(from).length!==2)throw Error('Nonunique retained interface anchor '+from);fragment=fragment.replace(from,to);
 }
 return{sources,fragment,metadata:catalogMetadata(JSON.parse(sources.catalog.text))};
}
// Read defaults/bounds directly from static constructor instructions. This is a
// tiny format-aware metadata extractor, not Java execution. COMPLEX exponent's
// two dconst_0 array stores are checked explicitly; unsupported builders fail.
export function catalogMetadata(raw){
 const result={};
 for(const method of raw.methods){
  if(!method.name.startsWith('build'))continue;
  const ids={None:'none',Basic:'basic',SmoothMandelbrot:'smooth_mandelbrot',Decomposition:'decomposition',BinaryDecomposition:'binary_decomposition',DistanceEstimator:'distance_estimator',DirectDomain:'direct_domain',DirectOrbitTrap:'direct_orbit_trap',DirectNormalizedZ:'direct_normalized_z',OrbitTrapIndex:'orbit_trap_index'};
  const id=ids[method.name.slice(5)];if(!id)throw Error('Unknown retained catalog method '+method.name);
  const parameters={};let current;
  const a=method.instructions;
  for(let j=0;j<a.length;j++){
   const ref=String(a[j].reference??'');
   if(ref.includes('ColoringParamType ')){const name=a[j-1].reference;current=parameters[name]={type:ref.split('ColoringParamType ')[1].split(' ')[0],sourcePc:a[j-1].offset};}
   for(const [call,key]of[['defaultValue','default'],['minValue','min'],['maxValue','max']])if(ref.includes('$Builder '+call+' (')){
    if(!current)throw Error('Metadata property without parameter');
    if(current.type==='COMPLEX'){
     const stores=a.slice(j-12,j);if(stores.filter(x=>x.opcode==='0x52').length!==2||stores.filter(x=>x.opcode==='0xe').length!==2)throw Error('Unexpected complex metadata default');current[key]=[0,0];
    }else{let v=a[j-1];if(String(v.reference).startsWith('java/lang/Double valueOf'))v=a[j-2];const value=v.opcode==='0xe'?0:v.opcode==='0xf'?1:v.reference;if(value==null)throw Error('Unparsed metadata literal');current[key]=current.type==='FLOAT'?Number(value):value;}
   }
  }
  result[id]=parameters;
 }
 if(Object.keys(result).length!==10)throw Error('Retained registry coverage changed');return result;
}
export function rgba(hex){if(!/^#[\da-f]{6}([\da-f]{2})?$/i.test(hex))throw Error('Oracle fixtures require explicit #RRGGBB or #RRGGBBAA');return [0,1,2,3].map(i=>F((i===3&&hex.length===7?255:parseInt(hex.slice(1+2*i,3+2*i),16))/255));}
function hsv([r,g,b]){const max=Math.max(r,Math.max(g,b)),min=Math.min(r,Math.min(g,b)),d=sub(max,min);let h=d<F(1e-6)?0:max===r?div(div(sub(g,b),d),6):max===g?div(add(div(sub(b,r),d),2),6):div(add(div(sub(r,g),d),4),6);if(h<0)h=add(h,1);return[h,max<=0?0:div(d,max),max];}
function rgb([h,s,v]){const q=mul(h,6),i=Math.floor(q),f=sub(q,F(i)),p=mul(v,sub(1,s)),a=mul(v,sub(1,mul(s,f))),b=mul(v,sub(1,mul(s,sub(1,f))));return [[v,b,p],[a,v,p],[p,v,b],[p,a,v],[b,p,v],[v,p,a]][((i%6)+6)%6];}
// PaletteRuntime.sampleColor PCs0–795. Ordinary RGB/HSV interpolation is float,
// not byte-quantized. Optional RGB animation override follows ManimColors.lerp
// f2i truncation; other animation color spaces are intentionally not asserted.
export function paletteSample(palette,t,runtime){
 const adjusted=add(F(t),F(palette.offset)),cosine=palette.cosine;
 if(palette.useCosine)return[0,1,2].map(k=>clamp(add(F(cosine.a[k]),mul(F(cosine.b[k]),F(Math.cos(mul(F(6.283180236816406),add(mul(F(cosine.c[k]),adjusted),F(cosine.d[k])))))))));
 if(!palette.colors.length)return[0,0,0];const colors=palette.colors.map(c=>rgba(c).slice(0,3));if(colors.length===1)return colors[0];
 const q=F(Math.pow(fract(adjusted),Math.max(F(.01),F(palette.gamma))));
 if(runtime){
  if(runtime.interpolation!=='rgb')throw Error('Independent runtime override only transcribes RGB in this matrix');
  const u=fract(q),position=runtime.cyclic?mul(u,F(colors.length)):mul(clamp(u),F(colors.length-1)),index=Math.floor(position),fraction=sub(position,F(index));
  const a=colors[index%colors.length],b=colors[runtime.cyclic?(index+1)%colors.length:Math.min(index+1,colors.length-1)];
  // Packed RGB source bytes are exact integers before interpolation.
  return a.map((_,k)=>div(F(Math.trunc(add(F(Math.round(a[k]*255)),mul(F(Math.round(b[k]*255)-Math.round(a[k]*255)),fraction)))),255));
 }
 const position=mul(clamp(q),F(colors.length-1)),index=Math.floor(position),fraction=sub(position,F(index));let a=colors[index],b=colors[Math.min(index+1,colors.length-1)];
 if(palette.space==='hsv'){a=hsv(a);b=hsv(b);const delta=sub(b[0],a[0]);if(Math.abs(delta)>.5)a[0]=add(a[0],Math.sign(delta));return rgb([fract(add(a[0],mul(sub(b[0],a[0]),fraction))),add(a[1],mul(sub(b[1],a[1]),fraction)),add(a[2],mul(sub(b[2],a[2]),fraction))]);}
 if(palette.space!=='rgb')throw Error('Unknown oracle palette space');return a.map((v,k)=>add(v,mul(sub(b[k],v),fraction)));
}
export function paletteLut(palette,runtime){const result=new Float32Array(3072);for(let i=0;i<1024;i++)result.set(paletteSample(palette,div(F(i),F(1023)),runtime),i*3);return result;}
// Independent registry -> FloatParamSet -> ComplexFractalMobject packColoringParams.
// Matrix inputs are already explicit canonical types, never a production plan.
export function packSide(side,numeric,metadata){
 const id=ALGORITHMS.indexOf(side.algorithm)+1;if(id<1)throw Error('Unknown oracle algorithm');const p={};
 for(const[key,spec]of Object.entries(metadata[side.algorithm])){
  let value=side.parameters?.[key]??spec.default;
  if(spec.type==='FLOAT'){value=F(value);if(!Number.isFinite(value))value=0;if(spec.min!==undefined)value=Math.max(value,F(spec.min));if(spec.max!==undefined)value=Math.min(value,F(spec.max));}
  else if(spec.type==='COMPLEX')value=value.map(Number);
  p[key]=value;
 }
 // Host power is rounded-double then narrowed int, not the shader's floor(F(p+.5)).
 const hostPower=Math.max(2,Number(BigInt.asIntN(32,BigInt(Math.floor(numeric.power[0]+.5)))));
 const p0=[0,1,F(hostPower),Math.max(F(1e-12),F(numeric.bailout))],p1=[0,0,0,1],p2=[F(.25),0,0,0],get=(k,f)=>p[k]??F(f),positive=(k,f)=>Math.max(F(1e-6),get(k,f));
 if(id===2)p0[0]=['ITERATION','REAL','IMAGINARY','SUM'].indexOf(p.metric);
 if(id===3){let exponent=numeric.power.map(F);if('power'in p)exponent=[p.power,0];if('exponent'in p&&p.exponent.map(F).every(Number.isFinite))exponent=p.exponent.map(F);if(!exponent.every(Number.isFinite)||exponent.every(x=>Math.abs(x)<F(1e-6)))exponent=[p0[2],0];let bailout=p0[3];if(Number.isFinite(p.bailout)&&p.bailout>0)bailout=p.bailout;p0.splice(0,4,...exponent,Math.max(F(1e-12),bailout),0);}
 if(id===5)p0[0]=p.type==='TYPE_2'?1:0;
 if(id===6)p0[2]=Math.max(2,get('power',p0[2]));
 if(id===7||id===9)p0.splice(0,4,id===7?positive('scale',1):Math.max(0,get('scale',1)),positive('gamma',1),clamp(get('saturation',.8)),positive('trap_radius',.5));
 if(id===8)p0.splice(0,4,clamp(get('mix_factor',0)),positive('gamma',1),clamp(get('saturation',.8)),positive('trap_radius',.5));
 if(id===10){p0[0]=1;p0[3]=positive('trap_radius',.5);}
 if(id===8||id===10){p1.splice(0,4,get('trap_center_x',0),get('trap_center_y',0),get('trap_angle',0),positive('trap_aspect',1));p2[0]=positive('threshold',.25);p2[1]=p.trap_shape==='ring'?1:p.trap_shape==='cross'?2:0;if(id===8)p2[2]=clamp(get('merge_opacity',.2));}
 const transferId=TRANSFERS.indexOf(side.transfer);if(transferId<0)throw Error('Unknown transfer');return {algorithmId:id,p0,p1,p2,solid:rgba(side.solidColor),transferId,density:F(side.density),offset:F(side.offset),repeat:side.repeat?1:0,metadataParameters:p};
}

// Reused independent retained DD transcript; no production reference code.
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
export function independentReference(input){
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

// Independent retained-shader execution, shared by browser and desktop probes.
export function createColorOracle(fragment,vertex){
 const assert=(v,m)=>{if(!v)throw Error(m);},gl=new OffscreenCanvas(1,1).getContext('webgl2',{alpha:false,antialias:false,depth:false});assert(gl,'Independent WebGL2 unavailable');assert(gl.getExtension('EXT_color_buffer_float'),'Independent float texture support unavailable');
 const owned=[],own=(kind,value)=>{assert(value,'Oracle allocation '+kind);owned.push({kind,value});return value;};let program,draws=0,reads=0,disposed=false;
 const dispose=()=>{if(disposed)return{disposed:true};gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);for(const{kind,value}of [...owned].reverse())gl['delete'+kind](value);const live=owned.filter(({kind,value})=>gl['is'+kind](value)).map(x=>x.kind);assert(!live.length,'Oracle cleanup failed '+live);disposed=true;gl.getExtension('WEBGL_lose_context')?.loseContext();return{draws,reads,owned:owned.length,live};};
 try{
  program=own('Program',gl.createProgram());for(const[type,source]of[[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=own('Shader',gl.createShader(type));gl.shaderSource(shader,source);gl.compileShader(shader);assert(gl.getShaderParameter(shader,gl.COMPILE_STATUS),gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}gl.linkProgram(program);assert(gl.getProgramParameter(program,gl.LINK_STATUS),gl.getProgramInfoLog(program));
  const vao=own('VertexArray',gl.createVertexArray()),buffer=own('Buffer',gl.createBuffer()),fbo=own('Framebuffer',gl.createFramebuffer()),target=own('Texture',gl.createTexture()),lut=own('Texture',gl.createTexture()),reference=own('Texture',gl.createTexture());
  gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,1,0,0,1,1,1,0,1,-1,1,1,1,-1,1,1,-1,-1,0,1,-1,1,0,0]),gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,2,gl.FLOAT,false,16,i*8);}
  const loc=n=>gl.getUniformLocation(program,n),f=(n,v)=>gl.uniform1f(loc(n),v),int=(n,v)=>gl.uniform1i(loc(n),v),v2=(n,v)=>gl.uniform2fv(loc(n),v),v4=(n,v)=>gl.uniform4fv(loc(n),v),split=n=>{const h=Math.fround(n);return[h,Math.fround(n-h)];};
  const bind=(t,unit)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);};
  let size='';return{info(){const ext=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,version:gl.getParameter(gl.VERSION)};},dispose,run(input){assert(!disposed,'Disposed oracle');const {width,height,numeric:n,expected}=input;assert(width*height<1e6,'Oracle resource bound');gl.useProgram(program);gl.bindVertexArray(vao);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.viewport(0,0,width,height);for(const cap of [gl.BLEND,gl.DEPTH_TEST,gl.DITHER,gl.SCISSOR_TEST])gl.disable(cap);
   if(size!==width+':'+height){bind(target,0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);size=width+':'+height;}gl.drawBuffers([gl.COLOR_ATTACHMENT0]);assert(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Independent framebuffer incomplete');
   const center=input.shaderCenter,jr=split(n.mappedJulia[0]),ji=split(n.mappedJulia[1]);v2('u_resolution',input.logicalSize);v2('u_centerHigh',[center[0],center[2]]);v2('u_centerLow',[center[1],center[3]]);v2('u_zoomDS',split(n.zoom));v2('u_juliaConstantHigh',[jr[0],ji[0]]);v2('u_juliaConstantLow',[jr[1],ji[1]]);
   for(const[name,value]of Object.entries({u_rotation:n.rotation,u_previewScale:1,u_bailout:n.bailout,u_perturbationThreshold:input.glitchThreshold,u_perturbationAbsFactor:input.glitchAbsFactor,u_perturbationRelLimit:input.glitchRelLimit}))f(name,value);
   for(const[name,value]of Object.entries({u_formulaId:n.formula==='newton'?2:3,u_type:n.formula==='nova'&&n.variant==='julia'?1:0,u_formulaType:0,u_power:Math.floor(Math.fround(Math.fround(n.power[0])+.5)),u_formulaSupportsPerturbation:1,u_iterations:n.iterations,u_usePerturbation:input.reference?.kind==='ready'?1:0,u_refOrbitLen:input.reference?.length??0,u_refOrbitTex:2,u_gradientTex:1,u_gradientSize:1024}))int(name,value);
   v4('u_formulaParams',[n.power[0],n.relaxation,0,0]);gl.uniform1fv(loc('u_dynamicParams[0]'),Float32Array.from({length:32},(_,i)=>i<2?n.power[i]:i===2?n.relaxation:0));
   for(const side of ['inside','outside']){const p=expected[side],prefix='u_'+side;int(prefix+'ColoringAlgorithm',p.algorithmId);for(let i=0;i<3;i++)v4(prefix+'ColoringParams'+i,p['p'+i]);v4(prefix+'SolidColor',p.solid);int(prefix+'TransferFunction',p.transferId);f(prefix+'ColorDensity',p.density);f(prefix+'GradientOffset',p.offset);int(prefix+'RepeatGradient',p.repeat);}
   bind(lut,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB32F,1024,1,0,gl.RGB,gl.FLOAT,Float32Array.from(expected.lut));bind(reference,2);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,input.reference?.length||1,1,0,gl.RGBA,gl.FLOAT,Float32Array.from(input.reference?.values.length?input.reference.values:[0,0,0,0]));
   gl.drawArrays(gl.TRIANGLES,0,6);draws++;const raw=new Uint8Array(width*height*4),top=new Uint8Array(raw.length);raw.fill(0xa5);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,raw);reads++;assert(gl.getError()===gl.NO_ERROR,'Independent color GL error');for(let y=0;y<height;y++)top.set(raw.subarray((height-y-1)*width*4,(height-y)*width*4),y*width*4);return top;
  }};
 }catch(error){try{dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Independent shader initialization and cleanup failed');}throw error;}
}
