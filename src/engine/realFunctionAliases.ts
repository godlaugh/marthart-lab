/** Resolve call names only. A bare symbol with the same spelling remains a
 * caller parameter, including documents saved before these aliases existed. */
const aliases: Readonly<Record<string, string>> = Object.freeze({
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
});

export const realFunctionAliasNames = Object.freeze(Object.keys(aliases));
export function canonicalRealFunctionName(name: string): string {
  return Object.hasOwn(aliases, name) ? aliases[name] : name;
}
