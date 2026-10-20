import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  prepareSourcePerlinCpuDisplay,
  type SourcePerlinCpuDisplayInput,
} from '../src/engine/sourcePerlinDisplay';
import type fixtureShape from './fixtures/source-perlin/display.json';

// Preserve the oracle's -0.0 projection entries; Vite's JSON module transform
// drops their sign. These are static instruction goldens, not native pixels.
const fixture: typeof fixtureShape = JSON.parse(
  readFileSync(new URL('./fixtures/source-perlin/display.json', import.meta.url), 'utf8'),
);
const methodOnlyCase = 'offscreen-zero-source-explicit-line-scale';
const displayCases = fixture.cases.filter(c => c.name !== methodOnlyCase);
function inputFor(c: typeof fixture.cases[number]): SourcePerlinCpuDisplayInput {
  const input = c.input;
  if (input.target !== 'primary' && input.target !== 'offscreen') throw new Error('Unknown fixture target');
  return {
    width: input.targetWidth, height: input.targetHeight,
    sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight,
    sourcePixelDensity: input.pixelDensity, target: input.target,
    lineWeight: input.lineWeight, dotSize: input.dotSize,
  };
}
function columnMajor(rowMajor: readonly number[]): number[] {
  return Array.from({ length: 16 }, (_, i) => rowMajor[(i % 4) * 4 + Math.floor(i / 4)]);
}

describe('source Perlin CPU display transforms and stroke widths', () => {
  it('declares static evidence and the one excluded method-only diagnostic', () => {
    expect(fixture.provenance.nativeExecution).toBe(false);
    expect(fixture.provenance.kind).toBe('independent-static-instruction-transcription');
    expect(fixture.provenance.processingJarSha256).toBe('89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a');
    expect(displayCases).toHaveLength(13);
    expect(fixture.cases.filter(c => c.name === methodOnlyCase)).toHaveLength(1);
  });

  for (const c of displayCases) {
    it(`matches independent model/view, projection and widths: ${c.name}`, () => {
      const actual = prepareSourcePerlinCpuDisplay(inputFor(c));
      expect(actual.modelView.rowMajor).toEqual(c.expected.modelView);
      expect([...actual.modelView.columnMajor]).toEqual(columnMajor(c.expected.modelView));
      expect(actual.projection.rowMajor).toEqual(c.expected.projection);
      expect([...actual.projection.columnMajor]).toEqual(columnMajor(c.expected.projection));
      expect(actual.lineScale).toBe(c.expected.lineScale);
      expect(actual.lineWidth).toBe(c.expected.trailWidth);
      expect(actual.pointWidth).toBe(c.expected.pointWidth);
      expect(actual.viewport).toEqual([0, 0, c.input.targetWidth, c.input.targetHeight]);
      expect(actual.lineShaderScale).toEqual([1, 1, Math.fround(.999)]);
    });
  }

  it('rejects zero-height offscreen admission instead of using a method-only supplied scale', () => {
    const c = fixture.cases.find(c => c.name === methodOnlyCase)!;
    // The independent method diagnostic injects lineScaleArg=1. A real display
    // computes targetHeight/sourceHeight, which is nonfinite here. It therefore
    // cannot establish a successful Scene render or count as a display match.
    expect(c.input.lineScaleArg).toBe(1);
    expect(c.input.sourceHeight).toBe(0);
    expect(() => prepareSourcePerlinCpuDisplay(inputFor(c)))
      .toThrow(expect.objectContaining({ code: 'nonfinite' }));
  });

  it('rejects dimensions outside the Java int32 contract and invalid target kinds', () => {
    const input = inputFor(displayCases[0]);
    for (const change of [
      { width: 0 }, { height: -1 }, { width: 1.5 }, { sourceHeight: NaN },
      { sourceWidth: 2147483648 }, { sourcePixelDensity: -2147483649 },
      { target: 'unknown' },
    ]) {
      expect(() => prepareSourcePerlinCpuDisplay({ ...input, ...change } as SourcePerlinCpuDisplayInput))
        .toThrow(expect.objectContaining({ code: 'input' }));
    }
  });

  it('rejects nonfinite Float32 widths and nonfinite offscreen scaling', () => {
    const input = inputFor(displayCases[0]);
    for (const change of [
      { lineWeight: NaN }, { dotSize: Infinity }, { lineWeight: 1e40 },
      { target: 'offscreen' as const, sourceHeight: -1 },
    ]) {
      expect(() => prepareSourcePerlinCpuDisplay({ ...input, ...change }))
        .toThrow(expect.objectContaining({ code: 'nonfinite' }));
    }
  });
});
