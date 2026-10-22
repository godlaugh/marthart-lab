import mathart.fractal.config.ComplexFractalConfig.FractalType;
import mathart.fractal.formula.PerturbationReferenceOrbitService;
import mathart.fractal.math.DoubleDouble;
/** Executes the shipped reference service only; no app, GL, license or UI. */
public class ReferenceProbe {
 public static void main(String[] args) {
  System.out.print("{\"cases\":[");boolean first=true;
  for(int power:new int[]{2,3,7})for(boolean julia:new boolean[]{false,true}){
   if(!first)System.out.print(",");first=false;
   var context=new PerturbationReferenceOrbitService.OrbitContext(julia?FractalType.JULIA:FractalType.MANDELBROT,julia?1:0,0,12,power,new float[]{power,0,0,0},DoubleDouble.ofParts(-.13,1e-19),DoubleDouble.ofParts(.017,-1e-20),-.12,.034,96,72,2048);
   var r=new PerturbationReferenceOrbitService().buildOrbit(context);
   System.out.print("{\"power\":"+power+",\"formula\":\""+(julia?"julia":"mandelbrot")+"\",\"length\":"+r.length()+",\"bits\":[");
   for(int i=0;i<r.packedOrbitData().length;i++){if(i>0)System.out.print(",");System.out.print(Integer.toUnsignedString(Float.floatToRawIntBits(r.packedOrbitData()[i])));}
   System.out.print("]}");
  }
  System.out.println("]}");
 }
}
