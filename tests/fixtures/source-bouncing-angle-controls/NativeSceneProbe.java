import java.nio.file.*;
import java.lang.reflect.*;
import processing.data.*;
public final class NativeSceneProbe {
 public static void main(String[] args)throws Exception {
  Class<?> type=Class.forName("mathart.ui.panels.inspector.BouncingParticlesSectionKt");
  JSONObject report=new JSONObject();report.setString("javaHome",System.getProperty("java.home"));report.setString("javaVersion",System.getProperty("java.version"));JSONArray rows=new JSONArray();
  float[] inputs={0f,-0f,1f,-1f,5f,45f,90f,180f,270f,360f,720f,-90f,0.1f,(float)Math.PI,(float)(Math.PI/2),1.2345678f,Float.MAX_VALUE,Float.MIN_VALUE};
  for(String name:new String[]{"degreesToRadians","radiansToDegrees"}){
   Method method=type.getDeclaredMethod(name,float.class);method.setAccessible(true);
   for(float input:inputs){float result=(Float)method.invoke(null,input);JSONObject row=new JSONObject();row.setString("method",name);row.setLong("inputBits",Integer.toUnsignedLong(Float.floatToRawIntBits(input)));row.setLong("outputBits",Integer.toUnsignedLong(Float.floatToRawIntBits(result)));rows.append(row);}
  }
  if(java.awt.Window.getWindows().length!=0)throw new IllegalStateException("Unexpected window");report.setInt("windowCount",0);report.setJSONArray("cases",rows);Files.writeString(Path.of(args[1],"numerics.json"),report.toString(),StandardOpenOption.CREATE_NEW);System.out.println("angleCases="+rows.size());
 }
}
