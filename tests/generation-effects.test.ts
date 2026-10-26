import {describe, expect, it, vi} from 'vitest';
import {runGenerationEffects, runGenerationEffectsAsync} from '../src/engine/generationEffects';

describe('generation effect runners', () => {
  it('feeds synchronous acknowledgements back into the generator and preserves its return value', () => {
    const result = {frames: 3};
    const effects: string[] = [];
    function* generate(): Generator<string, typeof result, number> {
      const first = yield 'first frame';
      const second = yield `frame after ${first}`;
      expect([first, second]).toEqual([1, 2]);
      return result;
    }

    expect(runGenerationEffects(generate(), effect => effects.push(effect))).toBe(result);
    expect(effects).toEqual(['first frame', 'frame after 1']);
  });

  it('performs effects yielded from catch and finally after a synchronous handler failure', () => {
    const failure = new Error('frame failed');
    const effects: string[] = [];
    const acknowledgements: string[] = [];
    let caught: unknown;
    function* generate(): Generator<string, string, string> {
      try {
        yield 'frame';
        throw new Error('failed frame was acknowledged');
      } catch (error) {
        caught = error;
        acknowledgements.push(yield 'recover');
        return 'recovered';
      } finally {
        acknowledgements.push(yield 'cleanup');
      }
    }

    const result = runGenerationEffects(generate(), effect => {
      effects.push(effect);
      if (effect === 'frame') throw failure;
      return `${effect} acknowledged`;
    });
    expect(result).toBe('recovered');
    expect(caught).toBe(failure);
    expect(effects).toEqual(['frame', 'recover', 'cleanup']);
    expect(acknowledgements).toEqual(['recover acknowledged', 'cleanup acknowledged']);
  });

  it.each(['promise', 'thenable'] as const)('rejects a synchronous %s result through generator catch and finally', kind => {
    const then = vi.fn();
    const invalid = kind === 'promise' ? Promise.resolve('late acknowledgement') : {then};
    const effects: string[] = [];
    let caught: unknown;
    let frameAcknowledged = false;
    let cleanupAcknowledgement: string | undefined;
    function* generate(): Generator<string, string, string> {
      try {
        yield 'frame';
        frameAcknowledged = true;
        return 'unexpected success';
      } catch (error) {
        caught = error;
        return 'rejected asynchronous handler';
      } finally {
        cleanupAcknowledgement = yield 'cleanup';
      }
    }

    const result = runGenerationEffects(generate(), effect => {
      effects.push(effect);
      // Runtime validation still applies when an adapter violates its declared contract.
      return effect === 'frame' ? invalid as unknown as string : 'released';
    });
    expect(result).toBe('rejected asynchronous handler');
    expect(caught).toBeInstanceOf(Error);
    expect(frameAcknowledged).toBe(false);
    expect(effects).toEqual(['frame', 'cleanup']);
    expect(cleanupAcknowledgement).toBe('released');
    expect(then).not.toHaveBeenCalled();
  });

  it('waits for each asynchronous acknowledgement before advancing the generator', async () => {
    const effects: string[] = [];
    const acknowledgements: string[] = [];
    let acknowledgeFirst!: (value: string) => void;
    let acknowledgeSecond!: (value: string) => void;
    const first = new Promise<string>(resolve => { acknowledgeFirst = resolve; });
    const second = new Promise<string>(resolve => { acknowledgeSecond = resolve; });
    const result = {frames: 2};
    function* generate(): Generator<string, typeof result, string> {
      acknowledgements.push(yield 'first');
      acknowledgements.push(yield 'second');
      return result;
    }

    const running = runGenerationEffectsAsync(generate(), effect => {
      effects.push(effect);
      return effect === 'first' ? first : second;
    });
    await Promise.resolve();
    expect(effects).toEqual(['first']);
    expect(acknowledgements).toEqual([]);

    acknowledgeFirst('first presented');
    await Promise.resolve();
    expect(effects).toEqual(['first', 'second']);
    expect(acknowledgements).toEqual(['first presented']);
    await Promise.resolve();
    expect(acknowledgements).toEqual(['first presented']);

    acknowledgeSecond('second presented');
    expect(await running).toBe(result);
    expect(acknowledgements).toEqual(['first presented', 'second presented']);
  });

  it.each(['throw', 'reject'] as const)('recovers and awaits yielded cleanup when an asynchronous handler uses %s', async kind => {
    const failure = new Error('presentation failed');
    const effects: string[] = [];
    const acknowledgements: string[] = [];
    let caught: unknown;
    let release!: (value: string) => void;
    const released = new Promise<string>(resolve => { release = resolve; });
    let cleanupStarted!: () => void;
    const cleanup = new Promise<void>(resolve => { cleanupStarted = resolve; });
    function* generate(): Generator<string, string, string> {
      try {
        yield 'frame';
        throw new Error('failed frame was acknowledged');
      } catch (error) {
        caught = error;
        acknowledgements.push(yield 'recover');
        return 'recovered';
      } finally {
        acknowledgements.push(yield 'cleanup');
      }
    }

    const running = runGenerationEffectsAsync(generate(), effect => {
      effects.push(effect);
      if (effect === 'frame') {
        if (kind === 'throw') throw failure;
        return Promise.reject(failure);
      }
      if (effect === 'cleanup') {
        cleanupStarted();
        return released;
      }
      return 'recovered acknowledgement';
    });
    await cleanup;
    expect(caught).toBe(failure);
    expect(effects).toEqual(['frame', 'recover', 'cleanup']);
    expect(acknowledgements).toEqual(['recovered acknowledgement']);
    release('cleanup acknowledgement');
    expect(await running).toBe('recovered');
    expect(acknowledgements).toEqual(['recovered acknowledgement', 'cleanup acknowledgement']);
  });

  it.each(['sync', 'async'] as const)('propagates an uncaught generator error after yielded cleanup in the %s runner', async kind => {
    const failure = new Error('invalid generated frame');
    const effects: string[] = [];
    function* generate(): Generator<string, never, void> {
      try {
        yield 'frame';
        throw failure;
      } finally {
        yield 'cleanup';
      }
    }
    const perform = (effect: string) => { effects.push(effect); };

    if (kind === 'sync') {
      let caught: unknown;
      try { runGenerationEffects(generate(), perform); } catch (error) { caught = error; }
      expect(caught).toBe(failure);
    } else {
      await expect(runGenerationEffectsAsync(generate(), perform)).rejects.toBe(failure);
    }
    expect(effects).toEqual(['frame', 'cleanup']);
  });
});
