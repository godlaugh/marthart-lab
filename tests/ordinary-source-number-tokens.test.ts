import {describe,it,expect} from 'vitest';
import {parseSourceNumberTokens,MAX_SOURCE_NUMBER_TOKEN_TEXT} from '../src/engine/sourceNumberTokens';
import {SOURCE_JSON_LIMITS} from '../src/engine/sourceJson';
const token=(path:string[],value='-0')=>({path,token:value});
describe('ordinary camera numeric provenance admission',()=>{
 it.each(['surface','implicit','attractor','perlin'] as const)('preserves exact registered lexemes for %s',kind=>{
  const rows=[token(['resolution','width'],'800'),token(['camera','phi']),token(['parameters','a.b'],'9007199254740993'),token(['timeline','999','target_gamma'],'1e-999'),token(['timeline','0','duration'],'1.00'),token(['timeline','999','actions','63','args','2'],'2e-1')];
  const result=parseSourceNumberTokens(rows,kind);expect(result).toEqual(rows);expect(result[0].path).not.toBe(rows[0].path);
 });
 it('keeps unrelated fields, families, duplicate slots, arity and index bounds closed',()=>{
  for(const path of [['camera','zoom'],['timeline','0','actions','0','args','3'],['timeline','1000','duration'],['timeline','0','actions','64','args','0'],['timeline','00','duration'],['parameters','a','nested']])expect(()=>parseSourceNumberTokens([token(path)],'surface')).toThrow('字段路径');
  for(const path of [['camera',['phi']],['timeline','0',['duration']]])expect(()=>parseSourceNumberTokens([{path,token:'1'}],'surface')).toThrow('字段路径');
  expect(()=>parseSourceNumberTokens([token(['camera','phi'])],'fractal')).toThrow('字段路径');
  expect(()=>parseSourceNumberTokens([token(['camera','phi']),token(['camera','phi'])],'surface')).toThrow('重复');
 });
 it('bounds record expansion by source nodes, scope members and retained text',()=>{
  expect(()=>parseSourceNumberTokens(new Array(SOURCE_JSON_LIMITS.nodes+1),'surface')).toThrow('最多');
  expect(()=>parseSourceNumberTokens(Array.from({length:8193},(_,i)=>token(['parameters','p'+i])),'surface')).toThrow('参数成员容量');
  expect(()=>parseSourceNumberTokens([token(['parameters','x'.repeat(40000)]),token(['parameters','y'.repeat(40000)])],'surface')).toThrow('参数名总文本');
  expect(()=>parseSourceNumberTokens([token(['camera','phi'],'1'.repeat(MAX_SOURCE_NUMBER_TOKEN_TEXT+1))],'surface')).toThrow('8 MiB');
 });
 it('admits only the Surface-selected direct or first-object gradient payload',()=>{
  const base=['timeline','0','actions','0','args'];
  for(const path of [[...base,'speed'],[...base,'0','mode'],base])expect(parseSourceNumberTokens([token(path,'1e999')],'surface')).toEqual([token(path,'1e999')]);
  for(const suffix of [['1','speed'],['00','speed'],['0','unknown'],['0','speed','nested']])expect(()=>parseSourceNumberTokens([token([...base,...suffix])],'surface')).toThrow('字段路径');
  for(const family of ['implicit','perlin'] as const)expect(()=>parseSourceNumberTokens([token([...base,'speed'])],family)).toThrow('字段路径');
  expect(parseSourceNumberTokens([token([...base,'speed'])],'attractor')).toHaveLength(1);
  // Roots retains its distinct scan-for-first-object contract.
  expect(parseSourceNumberTokens([token([...base,'2','speed'])],'roots')).toHaveLength(1);
 });
 it('rejects mixed selected payloads within one Surface action while preserving independent actions',()=>{
  const first=token(['timeline','0','actions','0','args','speed']);
  const mixed=token(['timeline','0','actions','0','args','0','mode']);
  expect(()=>parseSourceNumberTokens([first,mixed],'surface')).toThrow('一个源动画动作');
  expect(parseSourceNumberTokens([first,{...mixed,path:['timeline','0','actions','1','args','0','mode']}],'surface')).toHaveLength(2);
 });

});
