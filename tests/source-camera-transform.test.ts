import { describe, expect, it } from 'vitest';
import fixture from './fixtures/source-camera/transforms.json';
import { prepareSourceCamera, SOURCE_CAMERA_MODEL } from '../src/engine/sourceCamera';

function prepare(row: (typeof fixture.cases)[number]) {
 const result = prepareSourceCamera({model: SOURCE_CAMERA_MODEL, configuration: {kind: 'absent'}, frame: row.frame}, row.viewport);
 if (!result.ok) throw result.error;
 if (result.value.kind !== 'known') throw new Error(result.value.reason);
 return result.value.plan;
}
const canonicalZeros = (values: readonly number[]) => values.map(value => value === 0 ? 0 : value);

describe('source combined projection/modelview upload', () => {
 for (const row of fixture.cases) it(`matches retained source Float32 operation sequence: ${row.id}`, () => {
  const plan = prepare(row);
  // Goldens come from the independent Python bytecode oracle, not product
  // matrix code or a rendering result. Signed zero is not a fixture claim.
  for (const key of ['projection', 'modelView', 'transform'] as const) {
   expect(canonicalZeros(plan[key].rowMajor)).toEqual(canonicalZeros(row.expected[key]));
   for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    expect(plan[key].columnMajor[c * 4 + r]).toBe(plan[key].rowMajor[r * 4 + c]);
   }
  }
 });
 it('preserves center translation rounding that a final Float32 P*M product loses', () => {
  const witnesses = fixture.cases.filter(row => row.expected.transform.some((value, index) => value !== row.expected.finalProduct[index]));
  expect(witnesses.length).toBe(5);
  expect(witnesses.some(row => row.viewport.target === 'offscreen')).toBe(true);
  expect(witnesses.some(row => row.viewport.projectionPass === 'scene-fade-orthographic')).toBe(true);
  for (const row of witnesses) expect(canonicalZeros(prepare(row).transform.rowMajor)).not.toEqual(canonicalZeros(row.expected.finalProduct));
 });
 it('keeps the fade ortho projection active while restoring perspective camera modelview', () => {
  for (const target of ['primary', 'offscreen']) {
   const perspective = prepare(fixture.cases.find(row => row.id === `${target}-perspective-center`)!);
   const fade = prepare(fixture.cases.find(row => row.id === `${target}-scene-fade-orthographic-center`)!);
   expect(fade.modelView).toEqual(perspective.modelView);
   expect(fade.transform).not.toEqual(perspective.transform);
   expect(fade.projection.rowMajor[15]).toBe(1);
   expect(fade.transform.rowMajor.slice(12)).toEqual([0, 0, 0, 1]);
  }
 });
 it('owns independent immutable facts and detached upload arrays for every prepared plan', () => {
  const row = fixture.cases.find(row => row.id === 'offscreen-perspective-center')!;
  const plan = prepare(row), other = prepare(row), before = [...plan.transform.rowMajor];
  expect(Object.isFrozen(plan.transform.rowMajor)).toBe(true);
  expect(plan.transform.columnMajor.buffer).not.toBe(plan.modelView.columnMajor.buffer);
  expect(plan.transform.columnMajor.buffer).not.toBe(plan.projection.columnMajor.buffer);
  plan.transform.columnMajor.fill(NaN);
  expect(plan.transform.rowMajor).toEqual(before);
  expect([...other.transform.columnMajor].every(Number.isFinite)).toBe(true);
  expect(other.transform.rowMajor).toEqual(before);
 });
});
