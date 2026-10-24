/** MathArt 1.7.8 inspector conversions. UI degrees and stored simulation
 * radians are distinct values; preserve each Float32 multiply/divide boundary. */
const F=Math.fround,PI=F(Math.PI);
export function sourceBouncingRadiansToDegrees(value:number):number{return F(F(F(value)*180)/PI);}
export function sourceBouncingDegreesToRadians(value:number):number{return F(F(F(value)*PI)/180);}
