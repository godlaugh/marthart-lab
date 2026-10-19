/** Java Character.isWhitespace on a UTF-16 char. Unlike JavaScript whitespace,
 * this excludes NBSP, figure space, narrow NBSP, BOM and next-line U+0085. */
const whitespace = /^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]$/;
export function isJavaWhitespace(character: string): boolean {return whitespace.test(character);}
export function isJavaBlank(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (!isJavaWhitespace(value[i])) return false;
  return true;
}
/** String.trim removes code units <= U+0020, independently of isWhitespace. */
export function javaTrim(value: string): string {
  let start = 0, end = value.length;
  while (start < end && value.charCodeAt(start) <= 32) start++;
  while (end > start && value.charCodeAt(end - 1) <= 32) end--;
  return value.slice(start, end);
}

/** Java String.equalsIgnoreCase against an ASCII literal only. Java's simple
 * character case mapping also equates dotted/dotless I, long S and Kelvin sign
 * with ASCII I/S/K. Do not apply JS full-string casing (which can expand chars)
 * or use this as a general Unicode case comparator. Non-ASCII expected literals
 * are outside this contract and return false. */
export function javaEqualsIgnoreCaseAscii(value: string, expected: string): boolean {
  if (value.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    let right = expected.charCodeAt(i), left = value.charCodeAt(i);
    if (right > 127) return false;
    if (right >= 97 && right <= 122) right -= 32;
    if (left >= 97 && left <= 122) left -= 32;
    else if (left === 0x130 || left === 0x131) left = 73;
    else if (left === 0x17f) left = 83;
    else if (left === 0x212a) left = 75;
    if (left !== right) return false;
  }
  return true;
}
