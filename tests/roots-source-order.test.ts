import { sourceJavaDecimalDigit, sourceJavaIsLetter } from '../src/engine/rootsSourceCharacters';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseRootsSignedLongText, parseRootsSourceInteger, prepareRootsSourceCoefficients, prepareRootsSourceJsonInt, prepareRootsSourceJsonLong, prepareRootsSourceJsonString, prepareRootsSourceMemberOrder } from '../src/engine/rootsSourceOrder';

const order = (keys: readonly string[]) => { const r = prepareRootsSourceMemberOrder(keys); if (!r.ok) throw Error(JSON.stringify(r.error)); return r.value; };
describe('retained String HashMap producing order', () => {
 it('preserves a numeric member collision which JS own-keys would reorder', () => {
  // HashMap.hash("12")=1569 and hash("1")=49: both bucket1 at capacity16.
  expect(Object.keys(JSON.parse('{"12":0,"1":1}'))).toEqual(['1', '12']);
  expect(order(['12', '1']).keys).toEqual(['12', '1']);
  expect(order(['1', '12']).keys).toEqual(['1', '12']);
 });
 it('preserves prototype-like and UTF-16 keys without object lookup collisions', () => {
  const keys = ['__proto__', 'constructor', '', 'toString', '\ud800', '😀', 'Aa', 'BB'];
  const out = order(keys); expect(new Set(out.keys)).toEqual(new Set(keys));
  expect(out.sourceIndices.map(i => keys[i])).toEqual(out.keys);
  expect(out.keys.indexOf('Aa')).toBeLessThan(out.keys.indexOf('BB'));
 });
 it('splits a list stably at resize instead of reinserting/sorting', () => {
  // At size13, capacity16→32. "1"(49) splits high, "12"(1569) low.
  const keys = ['1', '12', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c'];
  expect(order(keys).capacity).toBe(32);
  expect(order(keys).keys).toEqual(['12', 'a', 'b', 'c', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
 });
 it('performs source tree-root front movement after collision-triggered resizes', () => {
  // All 16 eight-character Aa/BB words have hash -540425984 before spreading.
  // Eleven ascending insertions: ninth→resize32, tenth→resize64, eleventh
  // treeifies; red-black insertion root is rank3, moved to list front.
  const keys = Array.from({ length: 16 }, (_, n) => Array.from({ length: 4 }, (_, bit) => n & 1 << (3 - bit) ? 'BB' : 'Aa').join(''));
  expect(order(keys.slice(0, 9)).capacity).toBe(32);
  expect(order(keys.slice(0, 10)).capacity).toBe(64);
  const eleven = order(keys.slice(0, 11));
  expect(eleven.treeBins).toBe(1);
  expect(eleven.sourceIndices).toEqual([3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10]);
  // Inserting a middle key into an existing tree splices after tree parent.
  const gap = [...keys.slice(0, 11).filter((_, i) => i !== 6), keys[11], keys[6]];
  const result = order(gap);
  // The retained insertion tree has rank7 as rank6's parent (left child),
  // so the linked list inserts after 7, not after the sorted predecessor 5.
  expect(result.keys.indexOf(keys[6])).toBe(result.keys.indexOf(keys[7]) + 1);
 });
 it('splits tree bins, untreeifies small sides and rebuilds only the large side', () => {
  // Independent hash arithmetic gives bucket0 at64 for all these increasing
  // signed hashes. Eleven nodes split 5 low/6 high; thirteen split 6/7.
  const collision = ['22', '44', '66', '88', '709', '808', '907', '929', '1080', '2070', '2092', '2191', '2290'];
  for (const n of [11, 13]) {
   const keys = collision.slice(0, n), all = [...keys, ...Array.from({ length: 49 - n }, (_, i) => String.fromCharCode(0x101 + i))];
   const result = order(all), kept = result.keys.filter(k => keys.includes(k));
   expect(result.capacity).toBe(128);
   if (n === 11) {
    expect(result.treeBins).toBe(0);
    expect(kept).toEqual(['88', '44', '709', '907', '2070', '22', '66', '808', '929', '1080', '2092']);
   } else {
    expect(result.treeBins).toBe(1);
    // The seven ascending high-side hashes rebuild with rank1 at the front.
    expect(kept).toEqual(['88', '44', '709', '907', '2070', '2191', '66', '22', '808', '929', '1080', '2092', '2290']);
   }
  }
 });
 it('replays a cleared HashMap with its retained bucket capacity',()=>{
  expect(prepareRootsSourceMemberOrder(['exponent','exponent_im'],{initialCapacity:64})).toMatchObject({ok:true,value:{capacity:64,keys:['exponent','exponent_im']}});
  expect(order(['exponent','exponent_im']).keys).toEqual(['exponent_im','exponent']);
  expect(prepareRootsSourceMemberOrder([],{initialCapacity:64})).toMatchObject({ok:true,value:{capacity:64,keys:[]}});
  for(const initialCapacity of [-1,1,8,15,17,24,Infinity,NaN,262144])expect(prepareRootsSourceMemberOrder([],{initialCapacity})).toEqual({ok:false,error:{kind:'input',reason:'invalid-initial-capacity'}});
 });
 it('does not fabricate order after duplicate input or resource overflow', () => {
  expect(prepareRootsSourceMemberOrder(['x', 'x'])).toEqual({ ok: false, error: { kind: 'duplicate-key', key: 'x', firstIndex: 0, index: 1 } });
  expect(prepareRootsSourceMemberOrder(Array(65537).fill('x'))).toMatchObject({ ok: false, error: { kind: 'capacity', resource: 'members' } });
  expect(prepareRootsSourceMemberOrder(['a'.repeat(8 * 1024 * 1024 + 1)])).toMatchObject({ ok: false, error: { kind: 'capacity', resource: 'characters' } });
 });
});

describe('source coefficient aliases and integer narrowing', () => {
 it('matches all 65,536 retained BMP property facts', () => {
  // SHA independently decoded from original constant tables; not generated by
  // these production predicates. byte=letterFlag128+(decimalDigit+1 or 0).
  const bytes = Uint8Array.from({ length: 65536 }, (_, code) => {
   const c = String.fromCharCode(code); return (sourceJavaIsLetter(c) ? 128 : 0) + sourceJavaDecimalDigit(c) + 1;
  });
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('66890a797ed31f0bf557bc7655abd518d5c5d0d015e9574281a32d9225702d88');
 });
 it('uses retained UTF-16 letter classes rather than the host Unicode version', () => {
  for (const letter of ['A', 'é', '字', 'α', 'ſ', '\u02b0']) expect(sourceJavaIsLetter(letter)).toBe(true);
  // Roman numeral is Letter_Number, not one of Java isLetter's types 1..5.
  for (const other of ['Ⅲ', '1', '_', '\u0301', '\ud800', '𝒜', '']) expect(sourceJavaIsLetter(other)).toBe(false);
 });
 it.each([['+1', 1], ['01', 1], ['-0', 0], ['-2147483648', -2147483648], ['2147483647', 2147483647], ['１２', 12], ['١۲', 12]])('parses Java int %s', (raw, value) => expect(parseRootsSourceInteger(raw)).toEqual({ ok: true, value }));
 it.each([' 1', '1 ', '1.0', '1e1', '', '+', '2147483648', '-2147483649', '𝟙', '²', '\u00001'])('rejects invalid Java int %s', raw => expect(parseRootsSourceInteger(raw).ok).toBe(false));
 it('shares retained BMP digits and preserves alias first-slot/last-value facts', () => {
  expect(sourceJavaDecimalDigit('٩')).toBe(9); expect(sourceJavaDecimalDigit('９')).toBe(9); expect(sourceJavaDecimalDigit('𝟡')).toBe(-1);
  const raw = [{ exponent: '+1', expression: 'a' }, { exponent: '2', expression: '0' }, { exponent: '01', expression: 'b' }, { exponent: '１', expression: 'c' }];
  expect(prepareRootsSourceCoefficients(raw)).toEqual({ ok: true, value: [
   { exponent: 1, expression: 'c', firstIndex: 0, winningIndex: 3, sourceIndices: [0, 2, 3] },
   { exponent: 2, expression: '0', firstIndex: 1, winningIndex: 1, sourceIndices: [1] },
  ] });
  expect(raw[0].expression).toBe('a');
 });
 it('preserves all 64 seed bits and distinguishes Long wrap from Double saturation', () => {
  expect(parseRootsSignedLongText('9223372036854775807')).toEqual({ ok: true, value: 9223372036854775807n });
  expect(parseRootsSignedLongText('-9223372036854775808')).toEqual({ ok: true, value: -9223372036854775808n });
  expect(parseRootsSignedLongText('9223372036854775808').ok).toBe(false);
  expect(prepareRootsSourceJsonInt(4294967296, 5, '4294967296')).toMatchObject({ ok: true, value: { value: 0, numberKind: 'long' } });
  expect(prepareRootsSourceJsonInt(4294967296, 5, '4294967296.0')).toMatchObject({ ok: true, value: { value: 2147483647, numberKind: 'double' } });
  expect(prepareRootsSourceJsonLong(Number('9223372036854775807'), 5n, '9223372036854775807')).toMatchObject({ ok: true, value: { value: 9223372036854775807n, canonicalText: '9223372036854775807' } });
 });
 it('keeps JSONObject fallbacks separate from missing numeric identity', () => {
  expect(prepareRootsSourceJsonInt('1.0', 5)).toMatchObject({ ok: true, value: { value: 5, route: 'fallback' } });
  expect(prepareRootsSourceJsonLong(Infinity, 7n, '1e309')).toMatchObject({ ok: true, value: { value: 7n, route: 'fallback' } });
  expect(prepareRootsSourceJsonLong(Number('9223372036854775808'), 7n, '9223372036854775808')).toMatchObject({ ok: true, value: { value: 7n, route: 'fallback' } });
  expect(prepareRootsSourceJsonInt(4294967296, 5)).toEqual({ ok: false, error: { kind: 'number-token-required' } });
  expect(prepareRootsSourceJsonLong(Number('9223372036854775807'), 5n)).toEqual({ ok: false, error: { kind: 'number-token-required' } });
  expect(prepareRootsSourceJsonInt(1, 5, '2')).toEqual({ ok: false, error: { kind: 'invalid-number-token' } });
  expect(prepareRootsSourceJsonInt(null, 9)).toMatchObject({ ok: true, value: { value: 9, fallbackReason: 'unsupported-type' } });
 });
 it('preserves metadata-only unknown Java spelling instead of inventing JS strings', () => {
  expect(prepareRootsSourceJsonString(null, 'x')).toMatchObject({ ok: true, value: { status: 'known', value: 'x', route: 'fallback' } });
  expect(prepareRootsSourceJsonString(false, 'x')).toMatchObject({ ok: true, value: { status: 'known', value: 'false' } });
  expect(prepareRootsSourceJsonString(Number('9223372036854775807'), 'x', '9223372036854775807')).toMatchObject({ ok: true, value: { status: 'known', value: '9223372036854775807' } });
  expect(prepareRootsSourceJsonString(Infinity, 'x', '1e309')).toMatchObject({ ok: true, value: { status: 'known', value: '1e309', route: 'string' } });
  expect(prepareRootsSourceJsonString(1, 'x', '1.0')).toMatchObject({ ok: true, value: { status: 'unknown', reason: 'java-double-format' } });
  expect(prepareRootsSourceJsonString(1, 'x')).toMatchObject({ ok: true, value: { status: 'unknown', reason: 'number-token-required' } });
  expect(prepareRootsSourceJsonString({ a: 1 }, 'x')).toMatchObject({ ok: true, value: { status: 'unknown', reason: 'container-stringification' } });
 });
});
