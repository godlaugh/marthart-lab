/** Original Domain formula parameter maps are case-sensitive dictionaries, not
 * identifiers. Some retained keys cannot be referenced by the formula grammar.
 * Keep them without interpreting dots, aliases, reserved words, or prototypes. */
export function parseDomainNativeParameters(input:unknown):Record<string,number> {
 if(input===null||typeof input!=='object'||Array.isArray(input))throw new Error('源域着色参数必须为对象');
 const entries=Object.entries(input);
 for(const [,value]of entries)if(typeof value!=='number'||!Number.isFinite(value))throw new Error('源域着色参数必须为有限数值');
 return Object.fromEntries(entries) as Record<string,number>;
}
