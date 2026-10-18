import {javaTrim} from './sourceJavaText';
/** Source Domain scalar input, independent of the real/complex formula parsers.
 * Static contract: JsonDomainColoringConfig.parseParamValue(JSONObject,...),
 * JsonDomainColoringConfig.getJsonFloat and FastExpressionParser (1.7.8). No target execution.
 * Java Math transcendental last bits and locale-specific case conversion are not
 * claimed bit-identical to this JavaScript implementation. */
/** Local admission budgets, not source-format limits: cap retained input and
 * transient normalized/BigInt text at 64 Ki UTF-16 units, AST allocation at
 * 8,192 nodes, and recursive parser nesting at 128 frames. Evaluation itself
 * is iterative. Exceeding a budget is reported, never converted to a default. */
export const DOMAIN_SOURCE_SCALAR_LIMITS = Object.freeze({ characters: 65536, nodes: 8192, depth: 128 });
export type DomainSourceScalarClassification = 'finite' | 'nan' | 'positive-infinity' | 'negative-infinity';
export interface DomainSourceScalarFacts {
 raw: unknown;
 route: 'direct' | 'expression' | 'fallback';
 /** Before the requested final binary32 conversion; may be nonfinite. */
 parsedValue: number;
 value: number;
 precision: 'float64' | 'float32';
 classification: DomainSourceScalarClassification;
 fallbackReason?: 'missing' | 'unsupported-type' | 'invalid-expression';
}
export type DomainSourceScalarResult = { ok: true; facts: DomainSourceScalarFacts } | {
 ok: false; error: { kind: 'capacity'; resource: 'characters' | 'nodes' | 'depth'; limit: number; actual: number };
};
class Capacity extends Error {
 constructor(readonly resource: 'characters' | 'nodes' | 'depth', readonly actual: number) { super('Source scalar capacity exceeded'); }
}
class InvalidExpression extends Error {}
const invalid = (): never => { throw new InvalidExpression('Invalid source scalar expression'); };
const classify = (value: number): DomainSourceScalarClassification => Number.isNaN(value) ? 'nan' : value === Infinity ? 'positive-infinity' : value === -Infinity ? 'negative-infinity' : 'finite';

/** Double.parseDouble accepts Java decimal/hex floating literals, including a
 * type suffix (which does NOT turn Double.parseDouble into Float.parseFloat).
 * Hex conversion rounds the integer significand once, including subnormals. */
function javaDouble(text: string): number | undefined {
 const s = javaTrim(text);
 if (/^[+-]?NaN$/.test(s)) return NaN;
 if (/^[+-]?Infinity$/.test(s)) return s[0] === '-' ? -Infinity : Infinity;
 if (/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[fFdD]?$/.test(s)) return Number(s.replace(/[fFdD]$/, ''));
 const hex = /^([+-]?)0[xX]([0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?|\.[0-9a-fA-F]+)[pP]([+-]?[0-9]+)[fFdD]?$/.exec(s);
 if (!hex) return undefined;
 const sign = hex[1] === '-' ? -1 : 1, point = hex[2].indexOf('.');
 const integer = BigInt('0x' + hex[2].replace('.', ''));
 if (integer === 0n) return sign * 0;
 const exponent = Number(hex[3]) - (point < 0 ? 0 : 4 * (hex[2].length - point - 1));
 const top = integer.toString(2).length - 1 + exponent;
 if (top > 1023) return sign * Infinity;
 if (top < -1075) return sign * 0;
 const quantum = Math.max(-1074, top - 52), shift = quantum - exponent;
 let rounded: bigint;
 if (shift <= 0) rounded = integer << BigInt(-shift);
 else {
  const bits = BigInt(shift), floor = integer >> bits, remainder = integer - (floor << bits), half = 1n << (bits - 1n);
  rounded = floor + (remainder > half || remainder === half && (floor & 1n) === 1n ? 1n : 0n);
 }
 return sign * (Number(rounded) * 2 ** quantum);
}

export type DomainSourceDoubleResult = { ok: true; value: number; classification: DomainSourceScalarClassification } | {
 ok: false; error: { kind: 'invalid-literal' } | { kind: 'capacity'; resource: 'characters'; limit: number; actual: number };
};
/** Direct Java literal conversion for source fields which do not admit expressions. */
export function parseDomainSourceDouble(text: string): DomainSourceDoubleResult {
 if (text.length > DOMAIN_SOURCE_SCALAR_LIMITS.characters) return { ok: false, error: { kind: 'capacity', resource: 'characters', limit: DOMAIN_SOURCE_SCALAR_LIMITS.characters, actual: text.length } };
 const value = javaDouble(text);
 return value === undefined ? { ok: false, error: { kind: 'invalid-literal' } } : { ok: true, value, classification: classify(value) };
}

/** Float.parseFloat literal route. Decimal and hexadecimal literals are rounded
 * directly to binary32, not via binary64 (which can double-round midpoints).
 * The same text budget bounds BigInt work. Used by Surface/Implicit parseValue;
 * ConfigUtils deliberately keeps Double.parseDouble followed by float. */
export function parseDomainSourceFloat(text: string): DomainSourceDoubleResult {
 if (text.length > DOMAIN_SOURCE_SCALAR_LIMITS.characters) return { ok:false,error:{kind:'capacity',resource:'characters',limit:DOMAIN_SOURCE_SCALAR_LIMITS.characters,actual:text.length} };
 const s=javaTrim(text);
 if (/^[+-]?NaN$/.test(s)) return {ok:true,value:NaN,classification:'nan'};
 if (/^[+-]?Infinity$/.test(s)) {const value=s[0]==='-'?-Infinity:Infinity;return{ok:true,value,classification:classify(value)};}
 const decimal=/^([+-]?)([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE]([+-]?[0-9]+))?[fFdD]?$/.exec(s);
 const hex=/^([+-]?)0[xX]([0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?|\.[0-9a-fA-F]+)[pP]([+-]?[0-9]+)[fFdD]?$/.exec(s);
 const match=decimal??hex;if(!match)return{ok:false,error:{kind:'invalid-literal'}};
 const sign=match[1]==='-'?-1:1,point=match[2].indexOf('.'),fraction=point<0?0:match[2].length-point-1;
 const digits=match[2].replace('.','').replace(/^0+/,'');
 if(!digits)return{ok:true,value:sign*0,classification:'finite'};
 let numerator:bigint,denominator=1n;
 if(decimal){
  const exponent=Number(match[3]??0)-fraction,order=digits.length-1+exponent;
  if(order>39)return{ok:true,value:sign*Infinity,classification:classify(sign*Infinity)};
  if(order< -46)return{ok:true,value:sign*0,classification:'finite'};
  numerator=BigInt(digits);
  if(exponent>=0)numerator*=10n**BigInt(exponent);else denominator=10n**BigInt(-exponent);
 }else{
  numerator=BigInt('0x'+digits);const exponent=Number(match[3])-4*fraction,order=numerator.toString(2).length-1+exponent;
  if(order>128)return{ok:true,value:sign*Infinity,classification:classify(sign*Infinity)};
  if(order< -150)return{ok:true,value:sign*0,classification:'finite'};
  if(exponent>=0)numerator<<=BigInt(exponent);else denominator<<=BigInt(-exponent);
 }
 let exponent=numerator.toString(2).length-denominator.toString(2).length;
 if(exponent>=0?numerator<(denominator<<BigInt(exponent)):(numerator<<BigInt(-exponent))<denominator)exponent--;
 const quantum=Math.max(-149,exponent-23);
 if(quantum>=0)denominator<<=BigInt(quantum);else numerator<<=BigInt(-quantum);
 const whole=numerator/denominator,remainder=numerator%denominator,twice=remainder*2n;
 const rounded=whole+(twice>denominator||twice===denominator&&(whole&1n)===1n?1n:0n);
 const value=Math.fround(sign*Number(rounded)*2**quantum);
 return{ok:true,value,classification:classify(value)};
}

const constants: Readonly<Record<string, number>> = Object.freeze({ PI: Math.PI, TWO_PI: 2 * Math.PI, TAU: 2 * Math.PI, HALF_PI: Math.PI / 2, E: Math.E });
const functions = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sqrt', 'abs', 'log', 'ln', 'log10', 'exp', 'floor', 'ceil', 'round', 'sign', 'pow', 'min', 'max', 'atan2']);
function normalize(text: string): string {
 // Retain the source's fast-path test: U+22C5 is replaced only if another
 // listed character first triggers normalization (method offsets 0..134).
 if (!/[−–—×÷·（），＋－π［］]/.test(text)) return text;
 const replacements: Readonly<Record<string, string>> = { '−': '-', '–': '-', '—': '-', '－': '-', '＋': '+', '×': '*', '·': '*', '⋅': '*', '÷': '/', '（': '(', '）': ')', '，': ',', '［': '[', '］': ']', 'π': 'pi' };
 return text.replace(/[−–—－＋×·⋅÷（），［］π]/g, char => replacements[char]);
}
type Node = { kind: 'number'; value: number } | { kind: 'unary'; op: string; argument: Node } | { kind: 'binary'; op: string; left: Node; right: Node } | { kind: 'call'; name: string; args: Node[] };
const letter = (char: string) => char !== '' && /\p{L}/u.test(char);
const letterOrDigit = (char: string) => char !== '' && /[\p{L}\p{Nd}]/u.test(char);
class Parser {
 private pos = 0; private nodes = 0; private depth = 0;
 constructor(private readonly source: string, private readonly bindings?: ReadonlyMap<string, number>) {}
 private char() { return this.source[this.pos] ?? ''; }
 private skip() { while (this.char() === ' ') this.pos++; }
 private eat(char: string) { this.skip(); if (this.char() !== char) return false; this.pos++; return true; }
 private node<T extends Node>(node: T): T { if (++this.nodes > DOMAIN_SOURCE_SCALAR_LIMITS.nodes) throw new Capacity('nodes', this.nodes); return node; }
 parse(): Node { const result = this.expression(); this.skip(); if (this.pos !== this.source.length) invalid(); return result; }
 private expression(): Node {
  let left = this.term();
  while (true) { if (this.eat('+')) left = this.node({ kind: 'binary', op: '+', left, right: this.term() }); else if (this.eat('-')) left = this.node({ kind: 'binary', op: '-', left, right: this.term() }); else return left; }
 }
 private term(): Node {
  let left = this.factor();
  while (true) {
   let op: string | undefined;
   if (this.eat('*')) op = '*'; else if (this.eat('/')) op = '/'; else if (this.eat('%')) op = '%';
   else { this.skip(); const c = this.char(); if (c === '(' || c === '.' || c >= '0' && c <= '9' || letter(c) || c === '_') op = '*'; }
   if (!op) return left;
   left = this.node({ kind: 'binary', op, left, right: this.factor() });
  }
 }
 private factor(): Node {
  if (++this.depth > DOMAIN_SOURCE_SCALAR_LIMITS.depth) throw new Capacity('depth', this.depth);
  try {
   if (this.eat('+')) return this.node({ kind: 'unary', op: '+', argument: this.factor() });
   if (this.eat('-')) return this.node({ kind: 'unary', op: '-', argument: this.factor() });
   let value: Node;
   if (this.eat('|')) { const argument = this.expression(); if (!this.eat('|')) invalid(); value = this.node({ kind: 'call', name: 'abs', args: [argument] }); }
   else if (this.eat('(')) { value = this.expression(); if (!this.eat(')')) invalid(); }
   else {
    const start = this.pos, c = this.char();
    if (c === '.' || c >= '0' && c <= '9') {
     while (this.char() === '.' || this.char() >= '0' && this.char() <= '9') this.pos++;
     const number = javaDouble(this.source.slice(start, this.pos)); if (number === undefined) invalid(); value = this.node({ kind: 'number', value: number! });
    } else if (letter(c) || c === '_') {
     while (letterOrDigit(this.char()) || this.char() === '_') this.pos++;
     const name = this.source.slice(start, this.pos), lower = name.toLowerCase();
     // No skipSpaces here: source recognizes sin(0), but not sin (0).
     if (this.char() === '(' && functions.has(lower)) {
      this.pos++; const args: Node[] = [];
      if (this.char() !== ')') { do { args.push(this.expression()); } while (this.eat(',')); }
      if (!this.eat(')')) invalid();
      value = this.node({ kind: 'call', name: ({ arcsin: 'asin', arccos: 'acos', arctan: 'atan' } as Record<string,string>)[lower] ?? lower, args });
     } else {
      // Source parseFactor checks exact varMap membership before named constants.
      if (this.bindings?.has(name)) value = this.node({ kind: 'number', value: this.bindings.get(name)! });
      else { const key = name.toUpperCase(); if (!Object.hasOwn(constants, key)) invalid(); value = this.node({ kind: 'number', value: constants[key] }); }
     }
    } else return invalid();
   }
   if (this.eat('^')) value = this.node({ kind: 'binary', op: '^', left: value, right: this.factor() });
   return value;
  } finally { this.depth--; }
 }
}
function javaRound(value: number): number {
 if (Number.isNaN(value)) return 0;
 if (value >= 2 ** 63) return 2 ** 63;
 if (value <= -(2 ** 63)) return -(2 ** 63);
 return Math.round(value) || 0;
}
function call(name: string, values: number[]): number {
 const a = values[0];
 switch (name) {
  case 'sin': return Math.sin(a); case 'cos': return Math.cos(a); case 'tan': return Math.tan(a);
  case 'asin': return Math.asin(a); case 'acos': return Math.acos(a); case 'atan': return Math.atan(a);
  case 'sinh': return Math.sinh(a); case 'cosh': return Math.cosh(a); case 'tanh': return Math.tanh(a);
  case 'sqrt': return Math.sqrt(a); case 'abs': return Math.abs(a); case 'log': case 'ln': return Math.log(a);
  case 'log10': return Math.log10(a); case 'exp': return Math.exp(a); case 'floor': return Math.floor(a); case 'ceil': return Math.ceil(a);
  case 'round': return javaRound(a); case 'sign': return Math.sign(a);
 }
 if (values.length < 2) return 0;
 if (name === 'pow') return Math.pow(a, values[1]);
 if (name === 'atan2') return Math.atan2(a, values[1]);
 let result = a; for (let i = 1; i < values.length; i++) result = name === 'min' ? Math.min(result, values[i]) : Math.max(result, values[i]);
 return result;
}
/** Iterative evaluation bounds stack growth for long left-associated sums.
 * FunctionCall evaluates its first argument unconditionally. Unary functions
 * ignore extras; pow/atan2 use two; min/max use all only when at least two. */
function evaluate(root: Node): number {
 const frames: { node: Node; expanded: boolean; count: number }[] = [{ node: root, expanded: false, count: 0 }], values: number[] = [];
 while (frames.length) {
  const frame = frames.pop()!, node = frame.node;
  if (node.kind === 'number') { values.push(node.value); continue; }
  if (!frame.expanded) {
   let children: Node[];
   if (node.kind === 'unary') children = [node.argument];
   else if (node.kind === 'binary') children = [node.left, node.right];
   else {
    if (!node.args.length) invalid();
    const count = node.name === 'min' || node.name === 'max' ? node.args.length : node.name === 'pow' || node.name === 'atan2' ? Math.min(2, node.args.length) : 1;
    children = node.args.slice(0, count);
   }
   frames.push({ node, expanded: true, count: children.length });
   for (let i = children.length - 1; i >= 0; i--) frames.push({ node: children[i], expanded: false, count: 0 });
   continue;
  }
  const args = values.splice(values.length - frame.count, frame.count), [a, b] = args;
  if (node.kind === 'unary') values.push(node.op === '-' ? -a : a);
  else if (node.kind === 'call') values.push(call(node.name, args));
  else values.push(node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : node.op === '/' ? a / b : node.op === '%' ? a % b : Math.pow(a, b));
 }
 return values[0];
}
type ScalarOptions = { fallback: number; precision: 'float64' | 'float32'; /** Exact source variable names; caller owns source binding construction. */ bindings?: ReadonlyMap<string, number> };
function prepareScalar(raw: unknown, options: ScalarOptions, directStrings: boolean): DomainSourceScalarResult {
 let route: DomainSourceScalarFacts['route'] = 'direct', parsedValue: number, fallbackReason: DomainSourceScalarFacts['fallbackReason'];
 try {
  if (typeof raw === 'number') parsedValue = raw;
  else if (typeof raw === 'string') {
   if (raw.length > DOMAIN_SOURCE_SCALAR_LIMITS.characters) throw new Capacity('characters', raw.length);
   const direct = directStrings ? javaDouble(raw) : undefined;
   if (direct !== undefined) parsedValue = direct;
   else {
    route = 'expression';
    try { parsedValue = javaTrim(raw) === '' ? 0 : evaluate(new Parser(normalize(raw), options.bindings).parse()); }
    catch (error) { if (!(error instanceof InvalidExpression)) throw error; route = 'fallback'; fallbackReason = 'invalid-expression'; parsedValue = options.fallback; }
   }
  } else { route = 'fallback'; fallbackReason = raw == null ? 'missing' : 'unsupported-type'; parsedValue = options.fallback; }
 } catch (error) {
  if (error instanceof Capacity) return { ok: false, error: { kind: 'capacity', resource: error.resource, limit: DOMAIN_SOURCE_SCALAR_LIMITS[error.resource], actual: error.actual } };
  throw error;
 }
 const value = options.precision === 'float32' ? Math.fround(parsedValue) : parsedValue;
 return { ok: true, facts: { raw, route, parsedValue, value, precision: options.precision, classification: classify(value), ...(fallbackReason ? { fallbackReason } : {}) } };
}
/** JSONObject field / getJsonFloat path: try Double.parseDouble first. */
export function prepareDomainSourceScalar(raw: unknown, options: ScalarOptions): DomainSourceScalarResult {
 return prepareScalar(raw, options, true);
}
/** Object / JSONArray argument path: source strings go directly to the same
 * FastExpressionParser, without Double.parseDouble. Thus number 1000 is valid,
 * string "1e3" falls back, and string "1/0" is a successful nonfinite result. */
export function prepareDomainSourceObjectScalar(raw: unknown, options: ScalarOptions): DomainSourceScalarResult {
 return prepareScalar(raw, options, false);
}
