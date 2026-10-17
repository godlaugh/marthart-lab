// Independent source-derived fixtures. No Studio production imports and no JVM.
// CPU coordinate and packed-color helpers are previously retained independent
// transcriptions of DomainColoringMobject bytecode; formula expectations below
// are hand-written for this finite corpus, never produced by Studio lowering.
import {sourceCpuSample} from '../.cache/domain-viewport-independent-oracle-varying-ss.mjs';
import {shadeSourceCpu} from '../.cache/domain-source-cpu-oracle.mjs';
const palette17=Array.from({length:17},(_,i)=>'#ff'+[i*15,255-i*13,(i*43)%256].map(v=>v.toString(16).padStart(2,'0')).join(''));
export const policyFixtures=[
 {id:'disabled-next',equations:{f:'z+1',next:'w+100'},settings:{iterationEnabled:false,seedMode:'ZERO'},terminal:()=>[100,0]},
 {id:'constant-gate',equations:{f:'z',next:'w'},settings:{iterationEnabled:true,iterationSteps:2,seedMode:'CONSTANT_C',constantReal:.3,constantImag:.7},terminal:()=>[Math.fround(.3),Math.fround(.7)]},
 {id:'cpu-viewport-17-colors',equations:{f:'z'},settings:{iterationEnabled:false,seedMode:'PIXEL_Z',centerX:1.00000002,centerY:-.70000003,rotation:.73,scale:2.6},terminal:p=>p},
 {id:'cpu-running-palette',equations:{f:'z'},settings:{iterationEnabled:false,seedMode:'PIXEL_Z',rotation:-.51,scale:.7},runtime:{running:true,interpolation:'OKLCH'},terminal:p=>p},
 {id:'mixed-selected-rules',equations:{f:'z+1'},settings:{iterationEnabled:false,seedMode:'PIXEL_Z',domainViewportVersion:'local-v1',domainColorVersion:'local-v1',centerX:.19,centerY:-.23,rotation:.43,scale:2.2},terminal:p=>[p[0]+1,p[1]]},
 {id:'same-evaluated-parameter',equations:{f:'z+a'},parameters:{a:.375},settings:{iterationEnabled:false,seedMode:'PIXEL_Z',rotation:.13,scale:1.3},terminal:p=>[p[0]+.375,p[1]]},
];
export function fixtureInput(fixture){
 return {equations:{...fixture.equations},parameters:{...(fixture.parameters??{})},domainSourcePalette:{colors:[...palette17]},settings:{domainRenderPolicy:'source-cpu-on-gpu-failure-v1',domainIterationVersion:'mathart-1.7.8-gpu',domainColorVersion:'mathart-1.7.8-gpu',domainViewportVersion:'mathart-1.7.8-gpu',domainBackend:'gpu',iterationEnabled:false,iterationSteps:1,iterationMaxSteps:64,seedMode:'PIXEL_Z',constantReal:1,constantImag:0,bailout:1e6,centerX:0,centerY:0,scale:2.5,rotation:0,supersampling:1,curveMode:'PHASE_MODULUS',phaseDensity:4.5,modDensity:7.5,phaseSharpness:.7,modSharpness:1.3,curveMix:.61,curveBias:.09,paletteOffset:.123,complexGrid:false,...fixture.settings},...(fixture.runtime?{evaluatedDomainGradient:{running:true,interpolation:fixture.runtime.interpolation.toLowerCase()}}:{})};
}
export function expectedWholeCpu(fixture,width,height,supersampling=1){
 const input=fixtureInput(fixture),s=input.settings,raw=input.domainSourcePalette.colors.map(c=>Number.parseInt(c.slice(1),16)>>>0),curve={mode:['PHASE','MODULUS','PHASE_MODULUS','NONE'].indexOf(s.curveMode),phaseDensity:s.phaseDensity,modDensity:s.modDensity,phaseSharpness:s.phaseSharpness,modSharpness:s.modSharpness,mix:s.curveMix,bias:s.curveBias};
 const pixels=new Uint8ClampedArray(width*height*4);let firstPoint,firstValue;
 for(let row=0;row<height;row++)for(let column=0;column<width;column++){
  const sum=[0,0,0];
  for(let sy=0;sy<supersampling;sy++)for(let sx=0;sx<supersampling;sx++){
   const point=sourceCpuSample({column,row,width,height,offsetX:(sx+.5)/supersampling,offsetY:(sy+.5)/supersampling,centerX:s.centerX,centerY:s.centerY,scale:s.scale,rotation:s.rotation});
   const value=fixture.terminal(point),rgba=shadeSourceCpu(value,raw,curve,s.paletteOffset,fixture.runtime).rgba;
   if(!firstPoint){firstPoint=point;firstValue=value;}
   for(let k=0;k<3;k++)sum[k]+=rgba[k]/255;
  }
  const at=(row*width+column)*4;
  for(let k=0;k<3;k++)pixels[at+k]=Math.round(sum[k]/(supersampling*supersampling)*255);pixels[at+3]=255;
 }
 return {pixels,firstPoint,firstValue};
}
export const policyOracleLimits=[
 'Finite hand-written expressions and independent static-source CPU coordinate/color transcriptions; not original application/JVM execution.',
 'SS>1 is the previously declared local extension. Java Math versus JS Math low-bit equivalence is not established.',
 'This oracle establishes complete effective CPU semantics for selected fixtures, not arbitrary complex expressions or universal cross-driver parity.',
];
