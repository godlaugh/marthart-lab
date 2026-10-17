import type { SceneDocument } from '../types';
import { random } from './expression';

export const DOMAIN_TEMPLATES = [
  ['soft-phase','柔和相位'], ['rings','环带层级'], ['woven','交叉织构'],
  ['sharp','清晰等值线'], ['random','纯随机'],
] as const;
/** Templates only choose curve parameters; equations and mathematical viewport stay intact. */
export function exploreDomain(scene:SceneDocument, template:string, seed:number):SceneDocument {
  if(scene.kind!=='domain')throw new Error('等值线探索只适用于域着色');
  if(!DOMAIN_TEMPLATES.some(([id])=>id===template))throw new Error('未知探索模板');
  const rng=random(seed),between=(a:number,b:number)=>a+(b-a)*rng();
  const mode=template==='soft-phase'?'PHASE':template==='rings'?'MODULUS':template==='random'?['PHASE','MODULUS','PHASE_MODULUS','NONE'][Math.floor(rng()*4)]:'PHASE_MODULUS';
  const sharp=template==='sharp', soft=template==='soft-phase';
  return {...scene,settings:{...scene.settings,curveMode:mode,
    phaseDensity:Math.round(between(soft?2:4,soft?10:28)*2)/2,
    modDensity:Math.round(between(soft?2:4,template==='rings'?30:18)*2)/2,
    phaseSharpness:between(sharp?4:.4,sharp?12:2),modSharpness:between(sharp?4:.4,sharp?12:2),
    curveBias:between(-.1,.22),curveMix:between(soft?.3:.65,soft?.65:1),
  }};
}
