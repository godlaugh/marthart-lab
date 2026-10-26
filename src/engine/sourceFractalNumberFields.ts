import {SOURCE_FRACTAL_FORMULA_METADATA} from './sourceFractalFormulaRuntime';
import {SOURCE_FRACTAL_ACTION_LIMITS} from './sourceFractalActionConfig';
const parameters=new Set(Object.values(SOURCE_FRACTAL_FORMULA_METADATA).flatMap(items=>items.map(item=>item.name)));
const index=(value:unknown,max:number)=>typeof value==='string'&&/^(?:0|[1-9][0-9]*)$/.test(value)&&Number(value)<max;
const has=(value:unknown,keys:readonly string[])=>typeof value==='string'&&keys.includes(value);
export const SOURCE_FRACTAL_STATIC_NUMBER_FIELDS=23+parameters.size*2;
/** Source adapters retain only consumed scalar tokens. Structural paths stay
 * exact arrays, including names containing dots; no wildcard prefix matching. */
export function sourceFractalNumberField(path:readonly unknown[]):boolean {
 if(path[0]==='main_equation')return path.length===2&&path[1]==='scale'||path.length===3&&path[1]==='position'&&index(path[2],2);
 if(path[0]==='fractal'){
  if(path.length===2)return has(path[1],['formula_id','formulaId','type','power','bailout','rotation','iterations']);
  if(path[1]==='formula_params'&&path.length===3)return has(path[2],['power','param1','param2','param3']);
  if(path[1]==='julia_constant'&&path.length===3)return index(path[2],2);
  if(path[1]==='parameters'&&typeof path[2]==='string'&&parameters.has(path[2]))return path.length===3||path.length===4&&has(path[3],['0','1','re','im']);
 }
 if(path[0]==='settings'&&path[1]==='param_edge_easing'&&path.length===3)return has(path[2],['window','floor','easing']);
 if(path[0]!=='timeline'||!index(path[1],1000)||path[2]!=='actions'||!index(path[3],SOURCE_FRACTAL_ACTION_LIMITS.actions))return false;
 if(path.length===5&&path[4]==='method')return true;
 if(path[4]!=='args')return false;
 let offset=5;if(index(path[offset],3)){if(path.length===6)return true;offset++;}
 if(path.length===offset+1)return has(path[offset],['mode','speed','interpolation','affectInside','affectOutside','targetDomain']);
 if(path[offset]==='edgeEasing'&&path.length===offset+2)return has(path[offset+1],['window','floor','easing']);
 if(path[offset]==='parameters'&&typeof path[offset+1]==='string'){
  if((path[offset+1] as string).length>SOURCE_FRACTAL_ACTION_LIMITS.nameCharacters)return false;
  if(path.length===offset+3)return has(path[offset+2],['min','max','step','enable']);
  if(path.length===offset+4&&path[offset+2]==='edgeEasing')return has(path[offset+3],['window','floor','easing']);
 }
 return false;
}
