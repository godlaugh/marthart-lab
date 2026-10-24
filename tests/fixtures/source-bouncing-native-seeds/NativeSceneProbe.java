import processing.core.PApplet;
import processing.data.*;
import mathart.bouncing.BouncingParticlesMobject;
import mathart.bouncing.config.JsonBouncingParticlesConfig;
import mathart.license.LicenseManager;
import mathart.services.*;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlinx.coroutines.BuildersKt;
import com.jogamp.opengl.GL4;
import java.nio.*;
import java.nio.file.*;
import java.lang.reflect.*;

/** Numerical producer probe. Original config, constructor, samplers and upload
 * loop execute unchanged; only the final GL upload is captured without a GPU. */
public final class NativeSceneProbe {
 public static void main(String[] args)throws Exception {
  if(args.length!=3)throw new IllegalArgumentException("input, new output, original app data required");
  Path out=Path.of(args[1]);JSONArray cases=JSONArray.parse(Files.readString(Path.of(args[0])));
  if(cases.size()<1||cases.size()>200)throw new IllegalArgumentException("case capacity");
  System.setProperty("mathart.app.data.dir",args[2]);System.setProperty("mathart.license.cache.path",Path.of(args[2],"license.dat").toString());System.setProperty("mathart.app.version","1.7.8");
  LicenseManager license=LicenseManager.getInstance();license.init();
  SceneAccessPolicyService policy=SceneAccessPolicyService.INSTANCE;
  SceneAccessPolicyService.RefreshResult policyResult=BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,(scope,continuation)->policy.refreshAtStartup(continuation));
  if(!policy.evaluate("BOUNCING_PARTICLES",SceneAccessAction.RUN,license.getCurrentTier()).getAllowed())throw new IllegalStateException("Original policy disallows RUN");
  JSONObject report=new JSONObject();report.setString("javaVersion",System.getProperty("java.version"));report.setString("javaHome",System.getProperty("java.home"));report.setString("policySource",policyResult.getSource().toString());report.setString("tier",license.getCurrentTier().toString());JSONArray results=new JSONArray();
  Method upload=BouncingParticlesMobject.class.getDeclaredMethod("uploadInitialState",GL4.class);upload.setAccessible(true);
  PApplet app=new PApplet();
  for(int index=0;index<cases.size();index++){
   JSONObject item=cases.getJSONObject(index),row=new JSONObject();row.setString("name",item.getString("name"));results.append(row);
   try{
    JsonBouncingParticlesConfig config=new JsonBouncingParticlesConfig(app,item.getJSONObject("raw"));
    int count=config.getParticleCount();if(count<1||count>1000)throw new IllegalArgumentException("particle capacity");
    row.setInt("count",count);row.setString("seed",Long.toString(config.getSeed()));row.setInt("subSteps",config.getSubSteps());row.setFloat("timeStep",config.getTimeStep());row.setString("initialPositionMode",config.getInitialPositionMode());row.setString("initialVelocityMode",config.getInitialVelocityMode());
    BouncingParticlesMobject object=new BouncingParticlesMobject(app,config);final float[][] state={null};final int[] calls={0};
    GL4 sink=(GL4)Proxy.newProxyInstance(GL4.class.getClassLoader(),new Class<?>[]{GL4.class},(proxy,method,values)->{
     if(method.getName().equals("glBindTexture")){if((int)values[0]!=GL4.GL_TEXTURE_2D)throw new IllegalStateException("Unexpected target");calls[0]++;return null;}
     if(method.getName().equals("glTexSubImage2D")){
      if(state[0]!=null||values.length!=9||(int)values[0]!=GL4.GL_TEXTURE_2D||(int)values[1]!=0||(int)values[2]!=0||(int)values[3]!=0||(int)values[6]!=GL4.GL_RGBA||(int)values[7]!=GL4.GL_FLOAT)throw new IllegalStateException("Unexpected upload");
      int width=(int)values[4],height=(int)values[5];if(width!=height||width!=(int)Math.ceil(Math.sqrt(count)))throw new IllegalStateException("Unexpected padded size");
      FloatBuffer buffer=((FloatBuffer)values[8]).duplicate();if(buffer.remaining()!=width*height*4)throw new IllegalStateException("Unexpected state length");
      state[0]=new float[buffer.remaining()];buffer.get(state[0]);calls[0]++;return null;
     }
     throw new IllegalStateException("Unexpected GL call "+method.getName());
    });
    upload.invoke(object,sink);if(state[0]==null||calls[0]!=3)throw new IllegalStateException("Incomplete original upload");
    JSONArray words=new JSONArray();for(float value:state[0])words.append(Integer.toUnsignedLong(Float.floatToRawIntBits(value)));row.setJSONArray("words",words);row.setInt("uploadCalls",calls[0]);row.setString("status","passed");
   }catch(Exception error){Throwable cause=error instanceof InvocationTargetException?error.getCause():error;row.setString("status","error");row.setString("errorType",cause.getClass().getName());row.setString("error",String.valueOf(cause.getMessage()));}
  }
  if(java.awt.Window.getWindows().length!=0)throw new IllegalStateException("Unexpected windows");
  report.setJSONArray("cases",results);report.setInt("windowCount",0);Files.writeString(out.resolve("numerics.json"),report.toString(),StandardOpenOption.CREATE_NEW);System.out.println("numericalCases="+results.size());
 }
}
