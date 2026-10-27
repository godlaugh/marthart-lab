import type {ControlSpec,SceneDocument} from '../types';
import {sourceImplicitMeshRoute} from './sourceImplicitIdentity';

/** These inspector labels describe the selected source mesh route. The
 * generated frame remains the authority for actual computation and drawing. */
export function sourceImplicitAuthoringMetadata(scene:SceneDocument){
 if(!sourceImplicitMeshRoute(scene))return undefined;
 return{
  description:'按原版 Marching Cubes 生成等值面；当前使用 CPU 计算网格，可选择原版 CPU 绘制或 GPU 材质。',
  backend:{
   label:'网格绘制',group:'网格材质',
   help:'两种绘制方式均使用本机 CPU 网格计算。GPU 与自动模式使用原版光照和程序纹理材质。',
   options:[{value:'cpu',label:'CPU · 原版绘制'},{value:'webgl2',label:'GPU · 原版材质'},{value:'auto',label:'自动 · 原版 GPU 材质'}],
  } satisfies Pick<ControlSpec,'label'|'group'|'help'|'options'>,
  continuationHelp:'录制结束后从当前动画继续运行。暂停保留进度；暂存的场景和时间线编辑需点击“应用场景”生效。调色板改动直接生效；返回起点按已应用配置重启并恢复原配色。',
 };
}
