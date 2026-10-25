import {describe,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement,type ReactNode} from 'react';
import {Timeline} from '../src/components/Timeline';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {defaultRootsPendingConfiguration,defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {withRootsSceneTimeline} from '../src/engine/rootsCameraTimeline';
import type {SceneDocument} from '../src/types';

// Exercise the public toolbar callback without mounting an App, Worker or GPU.
// Pause/seek policy belongs to the App owner, not this presentation component.
vi.mock('react',async load=>({...await load<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,vi.fn()],useRef:(current:unknown)=>({current}),useEffect:vi.fn()}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string)=>s})}));
type Props={children?:ReactNode;title?:string;className?:string;onClick?:()=>void};
type Node=ReactElement<Props>;
function nodes(value:ReactNode):Node[]{
 if(Array.isArray(value))return value.flatMap(nodes);if(!isValidElement(value))return[];
 const node=value as Node;return[node,...nodes(node.props.children)];
}
function roots(mode:'density'|'point-cloud'){
 const scene=withRootsSceneTimeline(withRootsPresentation(createScene(definition('roots')),{...defaultRootsPresentationConfiguration(),mode,pending:defaultRootsPendingConfiguration(),previewMode:'live-worker-arrival-v1'}),true);
 scene.timeline.tracks=[];return scene;
}
function toolbar(scene:SceneDocument,playing:boolean){
 const callbacks={onTime:vi.fn(),onPlay:vi.fn(),onRestart:vi.fn(),onChange:vi.fn()},before=structuredClone(scene);
 const tree=Timeline({scene,time:1,playing,...callbacks});
 return{callbacks,before,tree,scene};
}

describe('timeline restart is one App-owned intent',()=>{
 it.each([
  ['density',false],['density',true],['point-cloud',false],['point-cloud',true],
 ] as const)('does not manufacture a pause/seek pair for %s while playing=%s',(mode,playing)=>{
  const f=toolbar(roots(mode),playing),restart=nodes(f.tree).find(node=>node.type==='button'&&node.props.title==='返回起点');
  expect(restart).toBeDefined();restart!.props.onClick!();
  expect(f.callbacks.onRestart).toHaveBeenCalledExactlyOnceWith();
  expect(f.callbacks.onPlay).not.toHaveBeenCalled();expect(f.callbacks.onTime).not.toHaveBeenCalled();expect(f.callbacks.onChange).not.toHaveBeenCalled();expect(f.scene).toEqual(f.before);
 });
 it('leaves ordinary-scene restart policy to the same App owner',()=>{
  const f=toolbar(createScene(definition('spirograph')),true);
  nodes(f.tree).find(node=>node.type==='button'&&node.props.title==='返回起点')!.props.onClick!();
  expect(f.callbacks.onRestart).toHaveBeenCalledOnce();expect(f.callbacks.onPlay).not.toHaveBeenCalled();expect(f.callbacks.onTime).not.toHaveBeenCalled();
 });
 it.each([false,true])('keeps the independent play toggle when playing=%s',playing=>{
  const f=toolbar(roots('point-cloud'),playing);
  nodes(f.tree).find(node=>node.type==='button'&&node.props.className==='play-button')!.props.onClick!();
  expect(f.callbacks.onPlay).toHaveBeenCalledExactlyOnceWith(!playing);expect(f.callbacks.onRestart).not.toHaveBeenCalled();expect(f.callbacks.onTime).not.toHaveBeenCalled();
 });
});
