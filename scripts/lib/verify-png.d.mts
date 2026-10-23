import type {Buffer} from 'node:buffer';
/** Independent validation decoder; rejects malformed or non-RGBA8 PNG input. */
export function decodePng(bytes:Buffer):{width:number;height:number;rgba:Buffer};
