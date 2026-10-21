import {sourceJavaStringHash} from './sourceJavaHash';
import { sourceJavaDecimalDigit } from './rootsSourceCharacters';
import { sourceNumberTokenValid } from './sourceNumberTokens';
/** Retained JRE String-key HashMap insertion/iteration, used once at native
 * JSON import. This is not JSON member order, sorted order, or JS own-key order.
 * No deletion/access-order map is exposed: JSONObject constructs by putOnce.
 * Evidence: roots-native-solver/{HashMap,JSONObject}.json and
 * roots-native-map-order/HashMap$TreeNode.json (static classfiles, no JVM run). */
export const ROOTS_SOURCE_ORDER_LIMITS = Object.freeze({ members: 65536, characters: 8 * 1024 * 1024 });
export type RootsSourceOrderError =
 | { kind: 'input'; reason: 'non-string-key'; index: number }
 | { kind: 'duplicate-key'; key: string; firstIndex: number; index: number }
 | { kind: 'capacity'; resource: 'members' | 'characters'; actual: number; limit: number };
export type RootsSourceResult<T, E = RootsSourceOrderError> = { ok: true; value: T } | { ok: false; error: E };
export interface RootsSourceMemberOrder {
 readonly keys: readonly string[];
 /** Indices into the supplied textual member list; values are never reparsed. */
 readonly sourceIndices: readonly number[];
 readonly capacity: number;
 readonly treeBins: number;
}
interface Entry {
 key: string; index: number; hash: number; next: Entry | null; prev: Entry | null;
 parent: Entry | null; left: Entry | null; right: Entry | null; red: boolean; tree: boolean;
}
function entry(key: string, index: number): Entry {
 const hash=sourceJavaStringHash(key);
 return { key, index, hash: hash ^ (hash >>> 16), next: null, prev: null, parent: null, left: null, right: null, red: false, tree: false };
}
function compare(a: Entry, b: Entry): number {
 // Both keys are Strings: comparableClassFor's String fast path applies;
 // distinct strings cannot reach the identityHashCode tie-break branch.
 return a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.key < b.key ? -1 : 1;
}
function rotateLeft(root: Entry, p: Entry): Entry {
 const r = p.right!; p.right = r.left;
 if (r.left) r.left.parent = p;
 r.parent = p.parent;
 if (!p.parent) { root = r; r.red = false; }
 else if (p.parent.left === p) p.parent.left = r; else p.parent.right = r;
 r.left = p; p.parent = r; return root;
}
function rotateRight(root: Entry, p: Entry): Entry {
 const l = p.left!; p.left = l.right;
 if (l.right) l.right.parent = p;
 l.parent = p.parent;
 if (!p.parent) { root = l; l.red = false; }
 else if (p.parent.right === p) p.parent.right = l; else p.parent.left = l;
 l.right = p; p.parent = l; return root;
}
function balance(root: Entry, x: Entry): Entry {
 x.red = true;
 for (;;) {
  let p = x.parent;
  if (!p) { x.red = false; return x; }
  let g = p.parent;
  if (!p.red || !g) return root;
  if (p === g.left) {
   const uncle = g.right;
   if (uncle?.red) { uncle.red = false; p.red = false; g.red = true; x = g; continue; }
   if (x === p.right) { x = p; root = rotateLeft(root, x); p = x.parent!; g = p.parent; }
   p.red = false;
   if (g) { g.red = true; root = rotateRight(root, g); }
  } else {
   const uncle = g.left;
   if (uncle?.red) { uncle.red = false; p.red = false; g.red = true; x = g; continue; }
   if (x === p.left) { x = p; root = rotateRight(root, x); p = x.parent!; g = p.parent; }
   p.red = false;
   if (g) { g.red = true; root = rotateLeft(root, g); }
  }
 }
}
function moveRoot(head: Entry, root: Entry): Entry {
 if (head !== root) {
  if (root.next) root.next.prev = root.prev;
  if (root.prev) root.prev.next = root.next;
  head.prev = root; root.next = head; root.prev = null;
 }
 return root;
}
function treeify(head: Entry): Entry {
 let root: Entry | null = null;
 for (let x: Entry | null = head; x; x = x.next) {
  x.tree = true; x.left = x.right = x.parent = null;
  if (!root) { x.red = false; root = x; continue; }
  let p = root;
  for (;;) {
   const left = compare(x, p) <= 0, next = left ? p.left : p.right;
   if (next) { p = next; continue; }
   x.parent = p; if (left) p.left = x; else p.right = x;
   root = balance(root, x); break;
  }
 }
 return moveRoot(head, root!);
}
function insertTree(head: Entry, x: Entry): Entry {
 let root = head; while (root.parent) root = root.parent;
 let p = root;
 for (;;) {
  const left = compare(x, p) <= 0, next = left ? p.left : p.right;
  if (next) { p = next; continue; }
  // TreeNode.putTreeVal splices after the tree parent, not the linked-list tail.
  x.tree = true; x.parent = x.prev = p; x.next = p.next;
  if (p.next) p.next.prev = x;
  p.next = x; if (left) p.left = x; else p.right = x;
  return moveRoot(head, balance(root, x));
 }
}
function untreeify(head: Entry): Entry {
 for (let x: Entry | null = head; x; x = x.next) { x.tree = false; x.parent = x.left = x.right = null; x.red = false; }
 return head;
}
function resize(table: (Entry | null)[]): (Entry | null)[] {
 const old = table.length, out: (Entry | null)[] = Array(old ? old * 2 : 16).fill(null);
 for (let i = 0; i < old; i++) {
  const head = table[i]; if (!head) continue;
  const wasTree = head.tree;
  let lo: Entry | null = null, hi: Entry | null = null, lt: Entry | null = null, ht: Entry | null = null, lc = 0, hc = 0;
  for (let x: Entry | null = head; x;) {
   const next: Entry | null = x.next; x.next = null;
   if ((x.hash & old) === 0) { x.prev = lt; if (lt) lt.next = x; else lo = x; lt = x; lc++; }
   else { x.prev = ht; if (ht) ht.next = x; else hi = x; ht = x; hc++; }
   x = next;
  }
  // List partitions preserve order. A split tree side <=6 becomes a list;
  // larger sides are rebuilt only when the opposite side is nonempty.
  out[i] = wasTree && lo ? lc <= 6 ? untreeify(lo) : hi ? treeify(lo) : lo : lo;
  out[i + old] = wasTree && hi ? hc <= 6 ? untreeify(hi) : lo ? treeify(hi) : hi : hi;
 }
 return out;
}
/** Local memory admission, not a native JSON format limit: at most 65,536
 * nodes, 131,072 bucket references and 8 Mi UTF-16 key units. */
export function prepareRootsSourceMemberOrder(keys: readonly string[]): RootsSourceResult<RootsSourceMemberOrder> {
 if (keys.length > ROOTS_SOURCE_ORDER_LIMITS.members) return { ok: false, error: { kind: 'capacity', resource: 'members', actual: keys.length, limit: ROOTS_SOURCE_ORDER_LIMITS.members } };
 const seen = new Map<string, number>(); let characters = 0;
 for (let i = 0; i < keys.length; i++) {
  const key = keys[i];
  if (typeof key !== 'string') return { ok: false, error: { kind: 'input', reason: 'non-string-key', index: i } };
  characters += key.length;
  if (characters > ROOTS_SOURCE_ORDER_LIMITS.characters) return { ok: false, error: { kind: 'capacity', resource: 'characters', actual: characters, limit: ROOTS_SOURCE_ORDER_LIMITS.characters } };
  const firstIndex = seen.get(key);
  if (firstIndex !== undefined) return { ok: false, error: { kind: 'duplicate-key', key, firstIndex, index: i } };
  seen.set(key, i);
 }
 let table: (Entry | null)[] = [];
 for (let i = 0; i < keys.length; i++) {
  if (!table.length) table = resize(table);
  const x = entry(keys[i], i), bucket = x.hash & (table.length - 1), head = table[bucket];
  if (!head) table[bucket] = x;
  else if (head.tree) table[bucket] = insertTree(head, x);
  else {
   let tail = head, count = 1; while (tail.next) { tail = tail.next; count++; }
   tail.next = x; x.prev = tail;
   if (count >= 8) { if (table.length < 64) table = resize(table); else table[bucket] = treeify(head); }
  }
  if (i + 1 > table.length * .75) table = resize(table);
 }
 const sourceIndices: number[] = []; let treeBins = 0;
 for (const head of table) { if (head?.tree) treeBins++; for (let x = head; x; x = x.next) sourceIndices.push(x.index); }
 return { ok: true, value: Object.freeze({ keys: Object.freeze(sourceIndices.map(i => keys[i])), sourceIndices: Object.freeze(sourceIndices), capacity: table.length, treeBins }) };
}

export type RootsSourceIntegerResult = RootsSourceResult<number, { kind: 'invalid-integer'; raw: string } | { kind: 'capacity'; resource: 'characters'; actual: number; limit: number }>;
/** Integer.parseInt(text,10), without trim, Number coercion or exponent syntax. */
export function parseRootsSourceInteger(raw: string): RootsSourceIntegerResult {
 if (raw.length > ROOTS_SOURCE_ORDER_LIMITS.characters) return { ok: false, error: { kind: 'capacity', resource: 'characters', actual: raw.length, limit: ROOTS_SOURCE_ORDER_LIMITS.characters } };
 const invalid = (): RootsSourceIntegerResult => ({ ok: false, error: { kind: 'invalid-integer', raw } });
 if (!raw.length) return invalid();
 const negative = raw[0] === '-', start = negative || raw[0] === '+' ? 1 : 0, limit = negative ? -2147483648 : -2147483647;
 if (start === raw.length) return invalid();
 let value = 0;
 for (let i = start; i < raw.length; i++) {
  const digit = sourceJavaDecimalDigit(raw[i]);
  if (digit < 0 || value < -214748364) return invalid();
  value *= 10;
  if (value < limit + digit) return invalid();
  value -= digit;
 }
 return { ok: true, value: negative ? value : -value || 0 };
}
export interface RootsSourceCoefficient { readonly exponent: string; readonly expression: string }
export interface RootsSourceEffectiveCoefficient {
 readonly exponent: number; readonly expression: string; readonly firstIndex: number; readonly winningIndex: number; readonly sourceIndices: readonly number[];
}
export type RootsSourceCoefficientError = Exclude<RootsSourceOrderError, { kind: 'input' }> | { kind: 'input'; reason: 'invalid-coefficient'; index: number } | { kind: 'invalid-exponent'; index: number; raw: string };
/** Input is the canonical source-HashMap-ordered array, NOT textual JSON order.
 * LinkedHashMap<Integer,String> overwrites an alias value without moving its
 * first slot. The caller retains the authored array; this returns only facts. */
export function prepareRootsSourceCoefficients(members: readonly RootsSourceCoefficient[]): RootsSourceResult<readonly RootsSourceEffectiveCoefficient[], RootsSourceCoefficientError> {
 if (members.length > ROOTS_SOURCE_ORDER_LIMITS.members) return { ok: false, error: { kind: 'capacity', resource: 'members', actual: members.length, limit: ROOTS_SOURCE_ORDER_LIMITS.members } };
 const rawKeys = new Map<string, number>(), effective = new Map<number, { exponent: number; expression: string; firstIndex: number; winningIndex: number; sourceIndices: number[] }>();
 let characters = 0;
 for (let i = 0; i < members.length; i++) {
  const item = members[i];
  if (!item || typeof item.exponent !== 'string' || typeof item.expression !== 'string') return { ok: false, error: { kind: 'input', reason: 'invalid-coefficient', index: i } };
  characters += item.exponent.length + item.expression.length;
  if (characters > ROOTS_SOURCE_ORDER_LIMITS.characters) return { ok: false, error: { kind: 'capacity', resource: 'characters', actual: characters, limit: ROOTS_SOURCE_ORDER_LIMITS.characters } };
  const firstIndex = rawKeys.get(item.exponent);
  if (firstIndex !== undefined) return { ok: false, error: { kind: 'duplicate-key', key: item.exponent, firstIndex, index: i } };
  rawKeys.set(item.exponent, i);
  const parsed = parseRootsSourceInteger(item.exponent);
  if (!parsed.ok) return { ok: false, error: parsed.error.kind === 'capacity' ? parsed.error : { kind: 'invalid-exponent', index: i, raw: item.exponent } };
  const current = effective.get(parsed.value);
  if (current) { current.expression = item.expression; current.winningIndex = i; current.sourceIndices.push(i); }
  else effective.set(parsed.value, { exponent: parsed.value, expression: item.expression, firstIndex: i, winningIndex: i, sourceIndices: [i] });
 }
 return { ok: true, value: Object.freeze([...effective.values()].map(v => Object.freeze({ ...v, sourceIndices: Object.freeze(v.sourceIndices) }))) };
}

export type RootsSourceLongResult = RootsSourceResult<bigint, { kind: 'invalid-long'; raw: string } | { kind: 'capacity'; resource: 'characters'; actual: number; limit: number }>;
/** Long.parseLong(text,10), preserving the entire signed 64-bit value. */
export function parseRootsSignedLongText(raw: string): RootsSourceLongResult {
 if (raw.length > ROOTS_SOURCE_ORDER_LIMITS.characters) return { ok: false, error: { kind: 'capacity', resource: 'characters', actual: raw.length, limit: ROOTS_SOURCE_ORDER_LIMITS.characters } };
 const invalid = (): RootsSourceLongResult => ({ ok: false, error: { kind: 'invalid-long', raw } });
 if (!raw.length) return invalid();
 const negative = raw[0] === '-', start = negative || raw[0] === '+' ? 1 : 0, limit = negative ? -(1n << 63n) : -((1n << 63n) - 1n);
 if (start === raw.length) return invalid();
 let value = 0n;
 for (let i = start; i < raw.length; i++) {
  const digit = sourceJavaDecimalDigit(raw[i]);
  if (digit < 0 || value < limit / 10n) return invalid();
  value *= 10n;
  if (value < limit + BigInt(digit)) return invalid();
  value -= BigInt(digit);
 }
 return { ok: true, value: negative ? value : -value };
}
type SourceJsonIntegerError = { kind: 'number-token-required' } | { kind: 'invalid-number-token' } | { kind: 'invalid-fallback' } | { kind: 'capacity'; resource: 'characters'; actual: number; limit: number };
export interface RootsSourceJsonIntegerFacts<T> {
 readonly raw: unknown; readonly value: T; readonly canonicalText: string;
 readonly route: 'number' | 'string' | 'fallback';
 readonly numberKind?: 'integer' | 'long' | 'double' | 'equivalent-without-token';
 readonly fallbackReason?: 'missing' | 'unsupported-type' | 'invalid-integer';
}
type NumberFacts = { kind: 'integer' | 'long'; value: bigint } | { kind: 'double'; value: number } | { kind: 'string'; value: string };
function sourceJsonNumber(raw: number, token: string): RootsSourceResult<NumberFacts, SourceJsonIntegerError> {
 if (token.length > ROOTS_SOURCE_ORDER_LIMITS.characters) return { ok: false, error: { kind: 'capacity', resource: 'characters', actual: token.length, limit: ROOTS_SOURCE_ORDER_LIMITS.characters } };
 // Metadata is supplied by the authoritative JSON producer, but validate the
 // binding so a stale/forged token cannot silently change the chosen number.
 if (!sourceNumberTokenValid(token) || !Object.is(Number(token), raw)) return { ok: false, error: { kind: 'invalid-number-token' } };
 if (/[.eE]/.test(token)) return { ok: true, value: Number.isFinite(raw) ? { kind: 'double', value: raw } : { kind: 'string', value: token } };
 const parsed = parseRootsSignedLongText(token);
 if (!parsed.ok) return parsed.error.kind === 'capacity' ? { ok: false, error: parsed.error } : { ok: true, value: { kind: 'string', value: token } };
 return { ok: true, value: { kind: parsed.value >= -2147483648n && parsed.value <= 2147483647n ? 'integer' : 'long', value: parsed.value } };
}
function sourceJsonInteger(raw: unknown, fallback: bigint, bits: 32 | 64, numberToken?: string): RootsSourceResult<RootsSourceJsonIntegerFacts<bigint>, SourceJsonIntegerError> {
 const minimum = -(1n << BigInt(bits - 1)), maximum = (1n << BigInt(bits - 1)) - 1n;
 if (fallback < minimum || fallback > maximum) return { ok: false, error: { kind: 'invalid-fallback' } };
 const facts = (value: bigint, route: 'number' | 'string' | 'fallback', extra: Partial<RootsSourceJsonIntegerFacts<bigint>> = {}): RootsSourceResult<RootsSourceJsonIntegerFacts<bigint>, SourceJsonIntegerError> => ({ ok: true, value: Object.freeze({ raw, value, canonicalText: value.toString(), route, ...extra }) });
 const parse = (text: string, route: 'number' | 'string'): RootsSourceResult<RootsSourceJsonIntegerFacts<bigint>, SourceJsonIntegerError> => {
  const result = bits === 32 ? parseRootsSourceInteger(text) : parseRootsSignedLongText(text);
  if (result.ok) return facts(BigInt(result.value), route);
  return result.error.kind === 'capacity' ? { ok: false, error: result.error } : facts(fallback, 'fallback', { fallbackReason: 'invalid-integer' });
 };
 if (typeof raw === 'string') return parse(raw, 'string');
 if (typeof raw !== 'number') return facts(fallback, 'fallback', { fallbackReason: raw === undefined ? 'missing' : 'unsupported-type' });
 if (numberToken === undefined) {
  // For these values Integer/Long/Double have the same narrowing result. An
  // unsafe integer or a large int narrowing requires its retained JSON token.
  if (Number.isSafeInteger(raw) && (bits === 64 || raw >= -2147483648 && raw <= 2147483647)) return facts(BigInt(raw), 'number', { numberKind: 'equivalent-without-token' });
  return { ok: false, error: { kind: 'number-token-required' } };
 }
 const source = sourceJsonNumber(raw, numberToken); if (!source.ok) return source;
 const number = source.value;
 if (number.kind === 'string') return parse(number.value, 'string');
 if (number.kind !== 'double') return facts(BigInt.asIntN(bits, number.value), 'number', { numberKind: number.kind });
 const n = number.value;
 const value = Number.isNaN(n) ? 0n : n >= Number(maximum) ? maximum : n <= Number(minimum) ? minimum : BigInt(Math.trunc(n));
 return facts(value, 'number', { numberKind: 'double' });
}
/** JSONObject.getInt(key, default): Number.intValue differs from parseInt and
 * Long.intValue wraps, whereas Double.intValue truncates/saturates. */
export function prepareRootsSourceJsonInt(raw: unknown, fallback: number, numberToken?: string): RootsSourceResult<RootsSourceJsonIntegerFacts<number>, SourceJsonIntegerError> {
 if (!Number.isInteger(fallback) || fallback < -2147483648 || fallback > 2147483647) return { ok: false, error: { kind: 'invalid-fallback' } };
 const result = sourceJsonInteger(raw, BigInt(fallback), 32, numberToken);
 return result.ok ? { ok: true, value: Object.freeze({ ...result.value, value: Number(result.value.value) }) } : result;
}
/** JSONObject.getLong(key, default), with exact original integral token facts. */
export function prepareRootsSourceJsonLong(raw: unknown, fallback: bigint, numberToken?: string): RootsSourceResult<RootsSourceJsonIntegerFacts<bigint>, SourceJsonIntegerError> {
 return sourceJsonInteger(raw, fallback, 64, numberToken);
}
export type RootsSourceJsonStringFacts = { readonly raw: unknown; readonly status: 'known'; readonly value: string; readonly route: 'string' | 'boolean' | 'integral-number' | 'fallback' } | {
 readonly raw: unknown; readonly status: 'unknown'; readonly reason: 'number-token-required' | 'java-double-format' | 'container-stringification';
};
/** JSONObject.getString(key,default) uses Object.toString; unlike getString(key),
 * it accepts nonstrings. Metadata-only consumers preserve unknown formatting
 * rather than using JS number/JSON serialization as a claimed Java spelling. */
export function prepareRootsSourceJsonString(raw: unknown, fallback: string, numberToken?: string): RootsSourceResult<RootsSourceJsonStringFacts, SourceJsonIntegerError> {
 const known = (value: string, route: 'string' | 'boolean' | 'integral-number' | 'fallback'): RootsSourceResult<RootsSourceJsonStringFacts, SourceJsonIntegerError> => ({ ok: true, value: Object.freeze({ raw, status: 'known', value, route }) });
 const unknown = (reason: 'number-token-required' | 'java-double-format' | 'container-stringification'): RootsSourceResult<RootsSourceJsonStringFacts, SourceJsonIntegerError> => ({ ok: true, value: Object.freeze({ raw, status: 'unknown', reason }) });
 if (raw === undefined || raw === null) return known(fallback, 'fallback');
 if (typeof raw === 'string') return known(raw, 'string');
 if (typeof raw === 'boolean') return known(raw ? 'true' : 'false', 'boolean');
 if (typeof raw !== 'number') return unknown('container-stringification');
 if (numberToken === undefined) return unknown('number-token-required');
 const number = sourceJsonNumber(raw, numberToken); if (!number.ok) return number;
 if (number.value.kind === 'string') return known(number.value.value, 'string');
 if (number.value.kind === 'double') return unknown('java-double-format');
 return known(number.value.value.toString(), 'integral-number');
}
