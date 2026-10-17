import type {ControlSpec,SceneDocument} from '../types';
export const attractorBackendControl:ControlSpec={key:'attractorBackend',label:'连续积分后端',group:'积分',type:'select',options:[{value:'cpu',label:'CPU · 支持历史拖尾'},{value:'auto',label:'自动 · 大粒子云使用 GPU'},{value:'gpu',label:'GPU · 持久粒子云'}],help:'GPU 支持最多200万个无历史粒子；Euler/RK4 在 GPU 执行。拖尾使用现有 CPU 路径；回退超过 CPU 预算时明确报错，保留请求粒子数。'};
export function visibleAttractorControls(settings:SceneDocument['settings'],controls:ControlSpec[]):ControlSpec[]{
 const continuous=settings.simulationMode==='continuous';return controls.filter(c=>continuous||c.key!=='attractorBackend').map(c=>c.key==='particleCount'?{...c,max:continuous?2_000_000:10000,label:continuous?'粒子数':'轨迹数量',help:continuous?'GPU 点云最多200万；CPU最多1万且受积分和历史预算约束。':c.help}:c);
}
