/** Work per particle for one source-prefix advance: prefixes 1..N each run
 * from the frozen input, then one classifier observes each completed prefix.
 * A zero-step reset touches metadata once without running the clamped math
 * program; an unchanged zero-step checkpoint performs no GPU work. */
export function sourceIteratedPrefixWork(steps:number,reset=false):number {
 if(!Number.isInteger(steps)||steps<0||steps>16||typeof reset!=='boolean')throw Error('源迭代每次推进最多 16 步，重置标志须为布尔值');
 return steps>0?steps*(steps+1)/2+steps:reset?1:0;
}
