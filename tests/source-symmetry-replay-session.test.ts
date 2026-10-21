import {describe,it,expect} from 'vitest';
import native from './fixtures/symmetry/replay-runtime.json';
import {sourceSymmetryReplayBudget,SourceSymmetryReplaySession} from '../src/engine/sourceSymmetryReplaySession';
import {prepareSourceSymmetryReplayFrame} from '../src/engine/sourceSymmetryFramePlan';
describe('source replay GPU boundary',()=>{
 for(const row of native.rows.filter(r=>r.method==='computeReplayBudgetForFrame'&&r.args[0]>=0&&r.args[0]<=256))it(`matches original JVM helper ${row.id}`,()=>{
  expect(sourceSymmetryReplayBudget(row.args[0],row.args[1],row.args[2])).toBe(row.result);
 });
 it('requires an explicit host frame rate without borrowing the timeline sampling rate',()=>{
  for(const value of [NaN,Infinity,.5,2147483648])expect(()=>new SourceSymmetryReplaySession(value)).toThrow('renderFps');
  const owner=new SourceSymmetryReplaySession(0);expect(owner.diagnostics().renderFps).toBe(0);owner.reset();
 });
 it('rejects work outside the supported replay domain before GPU allocation',()=>{
  for(const n of [-1,257,Infinity,NaN,.5])expect(()=>sourceSymmetryReplayBudget(n,30,0)).toThrow();
  for(const [frame,burn,iterations]of [[-1,0,0],[0,100001,0],[0,0,17],[0,0,-1],[0,NaN,0]])expect(()=>prepareSourceSymmetryReplayFrame(frame,burn,iterations)).toThrow();
  expect(prepareSourceSymmetryReplayFrame(4,12,0)).toMatchObject({phase:'replay',objectUpdates:0,warmupSteps:12,iterationSteps:0});
 });
});
