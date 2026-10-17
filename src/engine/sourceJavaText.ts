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
