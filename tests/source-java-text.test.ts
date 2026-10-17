import {expect,it} from 'vitest';
import {isJavaBlank,isJavaWhitespace,javaTrim} from '../src/engine/sourceJavaText';
import {isJavaBlank as retainedDomainBlank,normalizeDomainNativeNext} from '../src/engine/domainSourceIteration';
it('keeps Java trim and blank distinct at source parameter names',()=>{
 expect(javaTrim('\0\x1f name \x20')).toBe('name');
 expect(isJavaBlank('\0')).toBe(false);
 expect(javaTrim('\0')).toBe('');
 expect(isJavaBlank('\u3000')).toBe(true);
 expect(javaTrim('\u3000')).toBe('\u3000');
 expect(isJavaBlank('')).toBe(true);
});
it('retains exact Domain predicate and normalization for every UTF-16 code unit',()=>{
 const before=/^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]*$/;
 for(let code=0;code<=0xffff;code++){
  const character=String.fromCharCode(code);
  expect(isJavaWhitespace(character)).toBe(before.test(character));
  expect(retainedDomainBlank(character)).toBe(before.test(character));
  const oldTrim=character.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'');
  expect(javaTrim(character)).toBe(oldTrim);
  expect(normalizeDomainNativeNext(character)).toBe(before.test(oldTrim)?undefined:oldTrim);
 }
});
it('does not use JavaScript whitespace or partial-string matches',()=>{
 for(const text of ['\u00a0','\u2007','\u202f','\ufeff','\u0085',' x ','\t\n'])expect(isJavaWhitespace(text)).toBe(false);
 expect(isJavaBlank('\t\n')).toBe(true);
 expect(javaTrim('\ufeffx\ufeff')).toBe('\ufeffx\ufeff');
 expect(normalizeDomainNativeNext(undefined)).toBeUndefined();
});
