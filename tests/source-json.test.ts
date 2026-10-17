import {describe, expect, it, vi} from 'vitest';
import {parseSourceJson, SOURCE_JSON_LIMITS} from '../src/engine/sourceJson';

describe('JSON source identity before Java object-map import', () => {
  it('lets the format adapter skip metadata after one syntax parse without changing values',()=>{
    const text='{"canonical":[1e999,-0,1.0]}',parse=vi.spyOn(JSON,'parse');
    try{
      const retain=vi.fn(()=>false),result=parseSourceJson(text,{retainMetadata:retain});
      expect(parse).toHaveBeenCalledTimes(1);expect(retain).toHaveBeenCalledOnce();
      expect(retain).toHaveBeenCalledWith(result.value);expect(result.metadata.has(result.value as object)).toBe(false);
      expect(result.value).toEqual({canonical:[Infinity,-0,1]});
    }finally{parse.mockRestore();}
  });
  it('applies lexical node limits only when requested, but always validates syntax and text capacity',()=>{
    const text='['+Array(SOURCE_JSON_LIMITS.nodes).fill('0').join(',')+']';
    expect(()=>parseSourceJson(text)).toThrow(/200,000/);
    expect((parseSourceJson(text,{retainMetadata:()=>false}).value as unknown[]).length).toBe(SOURCE_JSON_LIMITS.nodes);
    expect(()=>parseSourceJson('[1,]',{retainMetadata:()=>false})).toThrow(SyntaxError);
    expect(()=>parseSourceJson(' '.repeat(SOURCE_JSON_LIMITS.characters+1),{retainMetadata:()=>false})).toThrow('8 MiB');
  });
  it('retains integer-key text order independently of JavaScript enumeration', () => {
    const {value, metadata} = parseSourceJson('{"01":"first","1":"second","+1":"third","0":"fourth"}');
    expect(Object.keys(value as object)).toEqual(['0', '1', '01', '+1']);
    expect(metadata.get(value as object)?.keys).toEqual(['01', '1', '+1', '0']);
  });
  it('keeps signed-long and floating spelling before numeric precision is lost', () => {
    const {value, metadata} = parseSourceJson('{"seed":9223372036854775807,"neg":-9223372036854775808,"background_color":1.0,"exp":1e+00,"zero":-0,"overflow":1e400}');
    expect(metadata.get(value as object)?.numberTokens).toEqual(new Map([
      ['seed', '9223372036854775807'], ['neg', '-9223372036854775808'], ['background_color', '1.0'], ['exp', '1e+00'], ['zero', '-0'], ['overflow', '1e400'],
    ]));
    expect(Object.is((value as Record<string, number>).zero, -0)).toBe(true);
    expect((value as Record<string, number>).overflow).toBe(Infinity);
  });
  it('records decoded escaped names and leaves quoted numeric text as a string', () => {
    const text = String.raw`{"\u0031":"12","a\"b":2,"\\":3,"𝑥":4,"line\nname":5}`;
    const {value, metadata} = parseSourceJson(text);
    expect(metadata.get(value as object)?.keys).toEqual(['1', 'a"b', '\\', '𝑥', 'line\nname']);
    expect(metadata.get(value as object)?.numberTokens.has('1')).toBe(false);
    expect(value).toEqual(JSON.parse(text));
  });
  it('binds metadata to nested final objects, including objects inside arrays', () => {
    const text = '{"a":[1,{"02":2,"2":2.0},null,[{"seed":-1e2}]],"b":{"x":true}}';
    const {value, metadata} = parseSourceJson(text);
    const data = value as {a: [number, object, null, [object]]; b: object};
    expect(metadata.get(data.a[1])?.keys).toEqual(['02', '2']);
    expect(metadata.get(data.a[1])?.numberTokens.get('2')).toBe('2.0');
    expect(metadata.get(data.a[3][0])?.numberTokens.get('seed')).toBe('-1e2');
    expect(metadata.get(data.b)?.keys).toEqual(['x']);
    expect(metadata.get(data.a)?.keys).toEqual(['0','1','2','3']);
    expect(metadata.get(data.a)?.numberTokens).toEqual(new Map([['0','1']]));
    expect(value).toEqual(JSON.parse(text));
  });
  it('retains positional numeric spellings and exact value spans without reformatting arrays',()=>{
    const text='[ -0, 1.0, 9007199254740993, -1e999, "2", null, [3e+0] ]';
    const {value,metadata}=parseSourceJson(text),data=value as unknown[],facts=metadata.get(data)!;
    expect(facts.numberTokens).toEqual(new Map([['0','-0'],['1','1.0'],['2','9007199254740993'],['3','-1e999']]));
    expect(text.slice(...facts.valueRanges.get('4')!)).toBe('"2"');expect(text.slice(...facts.valueRanges.get('5')!)).toBe('null');
    expect(text.slice(...facts.valueRanges.get('6')!)).toBe('[3e+0]');
    expect(metadata.get(data[6] as object)?.numberTokens.get('0')).toBe('3e+0');
    expect(value).toEqual(JSON.parse(text));
  });
  it('does not retain array tokens from a superseded object member occurrence',()=>{
    const text='{"a":[1e999,2.0,3],"a":["one",-0]}',parsed=parseSourceJson(text),data=parsed.value as {a:unknown[]};
    expect(parsed.metadata.get(data.a)?.keys).toEqual(['0','1']);
    expect(parsed.metadata.get(data.a)?.numberTokens).toEqual(new Map([['1','-0']]));
    expect(text.slice(...parsed.metadata.get(data.a)!.valueRanges.get('0')!)).toBe('"one"');
  });
  it('retains duplicate evidence without changing standard JSON last-value semantics', () => {
    const text = '{"k":1.0,"k":"1","a":{"ghost":1,"x":{"old":2}},"a":{"x":{"new":3.0}},"k":null}';
    const {value, metadata} = parseSourceJson(text), data = value as {a: {x: object}};
    expect(value).toEqual(JSON.parse(text));
    expect(metadata.get(value as object)?.keys).toEqual(['k', 'k', 'a', 'a', 'k']);
    expect(metadata.get(value as object)?.numberTokens.has('k')).toBe(false);
    expect(metadata.get(data.a)?.keys).toEqual(['x']);
    expect(metadata.get(data.a.x)?.keys).toEqual(['new']);
    expect(metadata.get(data.a.x)?.numberTokens.get('new')).toBe('3.0');
  });
  it.each([
    '{"a":{"old":1},"a":2}',
    '{"a":2,"a":{"new":1.0}}',
    '{"a":[{"old":1}],"a":{"new":2}}',
    '{"a":{"old":1},"a":[{"new":2.0}]}',
  ])('does not attach superseded container metadata: %s', text => {
    const {value, metadata} = parseSourceJson(text), data = value as {a: unknown};
    expect(value).toEqual(JSON.parse(text));
    const object = Array.isArray(data.a) ? data.a[0] : data.a;
    if (object && typeof object === 'object') expect(metadata.get(object)?.keys).toEqual(['new']);
  });
  it('treats prototype-like names as own JSON data only', () => {
    const {value, metadata} = parseSourceJson('{"__proto__":{"polluted":1},"constructor":{"prototype":2},"toString":3}');
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    const data = value as Record<string, object>;
    expect(metadata.get(data.__proto__)?.keys).toEqual(['polluted']);
    expect(metadata.get(data.constructor)?.numberTokens.get('prototype')).toBe('2');
  });
  it('preserves lexical boundaries across generated escaped strings and nested containers', () => {
    const pieces = ['"', '\\', '\u0000', '\t', '\n', '🧮', '} ] , :', '-12e5', '\\u0031', '/'];
    for (let i = 0; i < 128; i++) {
      const key = pieces[i % pieces.length] + pieces[Math.floor(i / pieces.length) % pieces.length] + i;
      const text = '{"01":0,"1":1,' + JSON.stringify(key) + ':[' + JSON.stringify(key + '"\\') + ',{"'+i+'":-0.00e+2}]}';
      const {value, metadata} = parseSourceJson(text), data = value as Record<string, unknown>;
      expect(value).toEqual(JSON.parse(text));
      expect(metadata.get(data)?.keys).toEqual(['01', '1', key]);
      expect(metadata.get((data[key] as unknown[])[1] as object)?.numberTokens.get(String(i))).toBe('-0.00e+2');
    }
  });
  it.each(['null', 'true', 'false', '-1.25e+2', '"escaped \\" quote"', '[]', '{}'])('uses standard parsed values: %s', text => {
    expect(parseSourceJson(' \n\t' + text + '\r ' ).value).toEqual(JSON.parse(text));
  });
  it.each(['{"x":01}', '{"x":NaN}', '{"x":1,}', '[1,]', '{unquoted:1}', '{"x":1} trailing', '"unclosed', '{/*comment*/"x":1}'])('does not loosen JSON syntax: %s', text => {
    expect(() => parseSourceJson(text)).toThrow(SyntaxError);
  });
  it('retains exact final member value ranges through duplicates and nested arrays',()=>{
    const text=' {"v": {"old":1}, "v" : [1e309, {"label": "a\\\"b", "n":1.0}] ,"last":null} ';
    const parsed=parseSourceJson(text),data=parsed.value as {v:[number,object]};
    const range=parsed.metadata.get(data)?.valueRanges.get('v')!;expect(text.slice(...range)).toBe('[1e309, {"label": "a\\\"b", "n":1.0}]');
    const nested=parsed.metadata.get(data.v[1])!;expect(text.slice(...nested.valueRanges.get('n')!)).toBe('1.0');expect(text.slice(...nested.valueRanges.get('label')!)).toBe('"a\\\"b"');
    expect(parsed.metadata.get(data)?.keys).toEqual(['v','v','last']);expect(text.slice(...parsed.metadata.get(data)!.valueRanges.get('last')!)).toBe('null');
  });
  it('distinguishes a member JSON null from a nested numeric overflow by original spans',()=>{
    const text='{"label":{"value":1e309},"empty":null}',{value,metadata}=parseSourceJson(text),data=value as {label:object};
    expect(text.slice(...metadata.get(data)!.valueRanges.get('label')!)).toBe('{"value":1e309}');expect(text.slice(...metadata.get(data.label)!.valueRanges.get('value')!)).toBe('1e309');expect(text.slice(...metadata.get(data)!.valueRanges.get('empty')!)).toBe('null');
  });
  it('bounds source depth even when an earlier duplicate is later replaced', () => {
    expect(() => parseSourceJson('['.repeat(65) + '0' + ']'.repeat(65))).toThrow(/64/);
    expect(() => parseSourceJson('{"x":' + '['.repeat(64) + '0' + ']'.repeat(64) + ',"x":0}')).toThrow(/64/);
    expect(parseSourceJson('['.repeat(64) + '0' + ']'.repeat(64)).value).toBeInstanceOf(Array);
  });
  it('bounds scanned nodes and character storage before retaining metadata', () => {
    expect(() => parseSourceJson('[' + Array(SOURCE_JSON_LIMITS.nodes).fill('0').join(',') + ']')).toThrow(/200,000/);
    expect(() => parseSourceJson(' '.repeat(SOURCE_JSON_LIMITS.characters + 1))).toThrow(/8 MiB/);
  });
});
