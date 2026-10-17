import {describe,it,expect} from 'vitest';
import {translate} from '../src/i18n';
const prefix='GPU 粒子与累积保留，最终调色回退 CPU：';
describe('density presentation diagnostics locale',()=>{
 it('translates all known precision/capability reasons at the explicit UI boundary',()=>{
  for(const reason of ['调色参数超出 GPU float32 范围','极小对比度需要 CPU 双精度调色','曲线色板保留共享 CPU 分段三次插值调色','大色板周期或偏移需要 CPU 双精度相位','相邻色标位置在 GPU float32 中重合','大余弦色板参数需要 CPU 双精度相位','当前像素位于色板相位或调色边界的 float32 敏感区']){
   const source=prefix+reason,en=translate('en',source);expect(en).toContain('GPU particles and accumulation are preserved');expect(en).not.toMatch(/[\u3400-\u9fff]/);expect(translate('zh',source)).toBe(source);
  }
 });
 it('preserves an unknown diagnostic verbatim while translating its surrounding template',()=>{
  expect(translate('en',prefix+'driver says x=∞')).toBe('GPU particles and accumulation are preserved; final tone mapping fell back to CPU: driver says x=∞');
 });
 it('translates producer preview dimensions while retaining exact CPU/GPU and requested sizes',()=>{
  for(const backend of ['CPU','GPU'])expect(translate('en',`为限制 ${backend} 预览工作量，本次计算 750 × 426 像素（请求 827 × 470）。导出保留请求尺寸。`)).toBe(`To limit ${backend} preview work, this render uses 750 × 426 pixels (requested 827 × 470). Export preserves the requested dimensions.`);
 });

});
