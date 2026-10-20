/** Source ownership is explicit; old local Perlin documents keep their model. */
export function usesSourcePerlinCpu(scene:{kind:string;perlinCpuSource?:unknown}):boolean{return scene.kind==='perlin'&&scene.perlinCpuSource!==undefined;}
export function usesSourcePerlin(scene:{kind:string;perlinCpuSource?:unknown;perlinGpuSource?:unknown}):boolean{return scene.kind==='perlin'&&(scene.perlinCpuSource!==undefined||scene.perlinGpuSource!==undefined);}
