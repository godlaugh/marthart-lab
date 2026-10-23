import {afterEach,describe,it,expect,vi} from 'vitest';
import {createScene,parseScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {formulaPresentation} from '../src/engine/formulas';
import {rootsFormulaViewport} from '../src/engine/rootsFormulaPresentation';
import {Generator} from '../src/engine/client';
import type {GenerationRequest,GenerationResponse} from '../src/engine/generationProtocol';
import type {GenerationInput,SceneOutput} from '../src/types';
class Transport{
 static instances:Transport[]=[];messages:GenerationRequest[]=[];terminated=false;
 onmessage:((event:{data:GenerationResponse})=>void)|null=null;
 constructor(){Transport.instances.push(this);}
 postMessage(m:GenerationRequest){this.messages.push(structuredClone(m));}
 terminate(){this.terminated=true;}
 emit(m:GenerationResponse){this.onmessage?.({data:m});}
}
const viewport={logicalWidth:405,logicalHeight:486,referenceLogicalHeight:486,target:'primary' as const};
const context:GenerationInput={time:0,width:500,height:600,quality:'export',rootsViewport:viewport};
function fixture(){
 const s=createScene(definition('roots'));s.rootsPresentation=defaultRootsPresentationConfiguration();
 s.formulas={layout:'source-surface-centered-v1',main:{visible:true,x:0,y:150,scale:.25,color:'#ffffff',anchor:'center',latex:'x^2'},additional:[]};
 const scene=parseScene(JSON.stringify(s));
 const output:Extract<SceneOutput,{type:'raster'}>={type:'raster',width:500,height:600,pixels:new Uint8ClampedArray(500*600*4),stats:{samples:0,generated:0,invalid:0},formulaPresentation:formulaPresentation(scene,rootsFormulaViewport(viewport)),rootsPresentation:{model:'mathart-1.7.8-v1',mode:'density',clockPolicy:'local-fixed-sample-clock-v1',streamPolicy:'global-ordinal',presentationAlpha:'opaque-framebuffer-rgb',instance:1,restartReason:'initial',attemptedSamples:1,newSamples:1,newRawPoints:2,totalRawPoints:2,physicalSize:[500,600],logicalSize:[405,486],referenceLogicalHeight:486,target:'primary'}};
 return{scene,output};
}
afterEach(()=>vi.unstubAllGlobals());
describe('Roots formula transport contract',()=>{
 it.each(['missing','height','layout'] as const)('rejects %s formulas in final and progress frames',async mutation=>{
  for(const operation of ['generate','generate-progress'] as const){
   const{scene,output}=fixture();if(mutation==='missing')delete output.formulaPresentation;
   else if(mutation==='height')output.formulaPresentation={...output.formulaPresentation!,primaryLogicalHeight:600} as never;
   else output.formulaPresentation={referenceWidth:1280,referenceHeight:720,labels:[]};
   Transport.instances=[];vi.stubGlobal('Worker',Transport);const g=new Generator(),caught=g.generate(scene,context).catch(e=>e),w=Transport.instances[0],r=w.messages[0];
   if(operation==='generate')w.emit({operation,id:r.id,sessionId:r.sessionId,output});else w.emit({operation,id:r.id,sessionId:r.sessionId,output});expect(await caught).toBeInstanceOf(Error);expect(w.terminated).toBe(true);g.dispose();
  }
 });
 it.each(['valid','missing-result','changed-text','enhanced-before-formulas','wrong-scale','wrong-size'] as const)('checks paused capture %s against completed formulas and base-stage image',async mutation=>{
  const{scene,output}=fixture();Transport.instances=[];vi.stubGlobal('Worker',Transport);const g=new Generator(),pending=g.generate(scene,context),w=Transport.instances[0],r=w.messages[0];
  w.emit({operation:'generate',id:r.id,sessionId:r.sessionId,output});await pending;
  const next=g.captureRootsPaused(output,{width:17,height:19},3).catch(e=>e),q=w.messages.at(-1)!;
  const capture:Extract<SceneOutput,{type:'raster'}>={...structuredClone(output),width:17,height:19,pixels:new Uint8ClampedArray(17*19*4),sourceCurrentImage:{model:'local-current-numerical-snapshot',stage:'base-before-formulas',requestedSize:[17,19],logicalSize:[17,19],pixelDensity:1,baseSize:[17,19],scale:3}};
  if(mutation==='changed-text')capture.formulaPresentation!.labels[0].latex='changed';
  if(mutation==='enhanced-before-formulas')delete capture.sourceCurrentImage;
  if(mutation==='wrong-scale')capture.sourceCurrentImage!.scale=5;
  if(mutation==='wrong-size')capture.width=51;
  const result=mutation==='missing-result'?undefined:{capture,preview:structuredClone(output)};
  w.emit({operation:'roots-paused-capture',id:q.id,sessionId:q.sessionId,result} as GenerationResponse);
  const actual=await next;
  if(mutation==='valid'){expect(actual).toBe(result);expect(w.terminated).toBe(false);}else{expect(actual).toBeInstanceOf(Error);expect(w.terminated).toBe(true);}g.dispose();
 });
});
