/** Syntax is owned by JSON.parse. This additional lexical pass retains facts
 * which JavaScript values lose: object-member order and number spellings.
 * Metadata describes surviving parsed objects and arrays; it is not persisted unless
 * a format consumer explicitly selects one of these facts as provenance. */
export interface SourceJsonObjectMetadata {
  /** Object text order (including repeats) or array indices in source order. */
  keys: readonly string[];
  /** The final occurrence wins, exactly as for the associated parsed value. */
  numberTokens: ReadonlyMap<string, string>;
  /** Half-open range of each final member value, excluding surrounding whitespace. */
  valueRanges: ReadonlyMap<string, readonly [number,number]>;
}
export const SOURCE_JSON_LIMITS = {characters: 8 * 1024 * 1024, nodes: 200000, depth: 64} as const;

export class SourceJsonCapacityError extends Error {
 constructor(readonly resource:'characters'|'nodes'|'depth',readonly actual:number,readonly limit:number){super(resource==='characters'?'JSON 文件超过 8 MiB 字符容量':'JSON 文档超过 200,000 个节点或 64 层嵌套');this.name='SourceJsonCapacityError';}
}

export function parseSourceJson(text: string, options: {retainMetadata?:(value:unknown)=>boolean} = {}): {
  value: unknown;
  metadata: WeakMap<object, SourceJsonObjectMetadata>;
} {
  if (text.length > SOURCE_JSON_LIMITS.characters) throw new SourceJsonCapacityError('characters',text.length,SOURCE_JSON_LIMITS.characters);
  const value: unknown = JSON.parse(text);
  const metadata = new WeakMap<object, SourceJsonObjectMetadata>();
  // The format adapter decides whether lexical facts are needed after the one
  // syntax parse. A canonical document already owns its saved provenance;
  // counting/scanning its expanded records again would apply source budgets to
  // an unrelated representation. This parser does not identify file formats.
  if(options.retainMetadata?.(value)===false)return {value,metadata};
  let at = 0, nodes = 0;
  const whitespace = () => {while (at < text.length && text.charCodeAt(at) <= 32) at++;};
  const child = (parent: unknown, key: string): unknown =>
    parent !== null && typeof parent === 'object' && Object.hasOwn(parent, key)
      ? (parent as Record<string, unknown>)[key] : undefined;
  const stringEnd = () => {
    at++; // Opening quote; JSON.parse has already validated escape syntax.
    while (text[at] !== '"') at += text[at] === '\\' ? 2 : 1;
    at++;
  };
  function scan(target: unknown, depth: number): string | undefined {
    if (++nodes > SOURCE_JSON_LIMITS.nodes)throw new SourceJsonCapacityError('nodes',nodes,SOURCE_JSON_LIMITS.nodes);
    if(depth > SOURCE_JSON_LIMITS.depth)throw new SourceJsonCapacityError('depth',depth,SOURCE_JSON_LIMITS.depth);
    whitespace();
    const start = at, first = text[at];
    if (first === '{') {
      // A repeated member's earlier object may have a different shape from
      // its final value. Scan its bytes, but never invent a surviving object.
      const owner = target !== null && typeof target === 'object' && !Array.isArray(target) ? target : undefined;
      const keys: string[] = [], numberTokens = new Map<string, string>(),valueRanges=new Map<string,readonly [number,number]>();
      at++; whitespace();
      if (text[at] !== '}') for (;;) {
        const keyStart = at; stringEnd();
        const key: string = JSON.parse(text.slice(keyStart, at));
        whitespace(); at++; // Colon.
        whitespace();const valueStart=at;
        const token = scan(child(owner, key), depth + 1);
        if (owner) {
          keys.push(key);valueRanges.set(key,[valueStart,at]);
          if (token === undefined) numberTokens.delete(key); else numberTokens.set(key, token);
        }
        whitespace();
        if (text[at] !== ',') break;
        at++; whitespace();
      }
      at++;
      if (owner) metadata.set(owner, {keys, numberTokens,valueRanges});
      return;
    }
    if (first === '[') {
      const owner = Array.isArray(target) ? target : undefined;
      const keys:string[]=[],numberTokens=new Map<string,string>(),valueRanges=new Map<string,readonly [number,number]>();
      at++; whitespace();
      if (text[at] !== ']') for (let index = 0;; index++) {
        whitespace();const valueStart=at,key=String(index),token=scan(owner?.[index], depth + 1);
        if(owner){keys.push(key);valueRanges.set(key,[valueStart,at]);if(token!==undefined)numberTokens.set(key,token);}
        whitespace();
        if (text[at] !== ',') break;
        at++;
      }
      at++;
      if(owner)metadata.set(owner,{keys,numberTokens,valueRanges});
      return;
    }
    if (first === '"') {stringEnd(); return;}
    while (at < text.length && text.charCodeAt(at) > 32 && !',]}'.includes(text[at])) at++;
    if (first === '-' || first >= '0' && first <= '9') return text.slice(start, at);
  }
  scan(value, 0);
  return {value, metadata};
}
