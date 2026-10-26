import java.lang.reflect.Method;
import java.nio.file.*;
import java.util.Locale;
import kotlin.Unit;
import kotlin.jvm.functions.Function1;
import processing.data.JSONObject;
import processing.data.JSONArray;
import mathart.bouncing.config.JsonBouncingParticlesConfig;

/** Finite original pure-method calls. The Function1 below is an explicitly
 * diagnostic JSON sink, not ProjectState, Compose or a GUI commit callback. */
public final class SpeedConfigProbe {
 static final processing.core.PApplet app=new processing.core.PApplet();
 static JSONObject floating(float value){
  return new JSONObject().setString("text",Float.toString(value))
   .setString("bits",String.format(Locale.ROOT,"%08x",Float.floatToRawIntBits(value)));
 }
 static JSONObject doubleValue(double value){
  return new JSONObject().setString("text",Double.toString(value))
   .setString("bits",String.format(Locale.ROOT,"%016x",Double.doubleToRawLongBits(value)));
 }
 static JSONObject construct(JSONObject authored){
  String serialized=authored.toString();
  JSONObject reparsed=JSONObject.parse(serialized);
  JsonBouncingParticlesConfig config=new JsonBouncingParticlesConfig(app,reparsed);
  return new JSONObject().setString("authoredJson",serialized)
   .setString("jsonAfterConstructor",reparsed.toString())
   .setJSONObject("canonicalInitialSpeed",floating(config.getInitialSpeed()));
 }
 public static void main(String[] args)throws Exception {
  if(args.length!=1)throw new IllegalArgumentException("New output JSON required");
  Class<?> controls=Class.forName("mathart.ui.components.NumberDraggerKt",false,SpeedConfigProbe.class.getClassLoader());
  Method parse=controls.getDeclaredMethod("NumericStepperInputCore_oI3XNZo$parseNumber",boolean.class,double.class,double.class,String.class);parse.setAccessible(true);
  Method floatCallback=controls.getDeclaredMethod("NumericStepperInput_xYaah8o$lambda$0$0",Function1.class,double.class);floatCallback.setAccessible(true);
  JSONArray rows=new JSONArray();
  String[] inputs={"0","100","101","102",Float.toString(Float.MAX_VALUE),"100+1","1/20","2^10"};
  for(String input:inputs){
   Double parsed=(Double)parse.invoke(null,false,0d,(double)Float.MAX_VALUE,input);
   if(parsed==null)throw new IllegalStateException("Original helper rejected "+input);
   JSONObject settings=new JSONObject();float[] delivered={Float.NaN};int[] callbackCount={0};
   Function1<Float,Unit> sink=value->{delivered[0]=value;callbackCount[0]++;settings.setFloat("initial_speed",value);return Unit.INSTANCE;};
   floatCallback.invoke(null,sink,parsed.doubleValue());
   if(callbackCount[0]!=1)throw new IllegalStateException("Callback count");
   JSONObject row=construct(new JSONObject().setJSONObject("settings",settings));
   row.setString("kind","original-helper-and-float-wrapper-to-diagnostic-json-sink")
    .setString("inputText",input).setJSONObject("parsedDouble",doubleValue(parsed))
    .setJSONObject("callbackFloat",floating(delivered[0])).setInt("callbackCount",callbackCount[0]);rows.append(row);
  }
  float[] direct={0,100,101,102,Float.MAX_VALUE};
  for(float value:direct){
   JSONObject row=construct(new JSONObject().setJSONObject("settings",new JSONObject().setFloat("initial_speed",value)));
   row.setString("kind","direct-original-json-float").setJSONObject("authoredFloat",floating(value));rows.append(row);
  }
  for(String value:new String[]{"100+1","1/20","2^10"}){
   JSONObject row=construct(new JSONObject().setJSONObject("settings",new JSONObject().setString("initial_speed",value)));
   row.setString("kind","direct-original-json-expression").setString("authoredExpression",value);rows.append(row);
  }
  if(app.g!=null||app.getSurface()!=null)throw new IllegalStateException("Unexpected renderer or surface");
  int windows=java.awt.Window.getWindows().length;
  if(windows!=0||!java.awt.GraphicsEnvironment.isHeadless())throw new IllegalStateException("Unexpected graphical state");
  JSONObject report=new JSONObject().setString("scope","Original NumberDragger parse and Float-wrapper methods, diagnostic JSON sink, original JSON round trip, original config constructor/getter; no GUI commit or file save.")
   .setBoolean("headless",true).setBoolean("rendererAbsent",app.g==null).setBoolean("surfaceAbsent",app.getSurface()==null).setInt("windowCount",windows).setJSONArray("cases",rows);
  Files.writeString(Path.of(args[0]),report.toString()+"\n",StandardOpenOption.CREATE_NEW);
  System.out.println("speedConfigCases="+rows.size()+",windowCount="+windows);
 }
}
