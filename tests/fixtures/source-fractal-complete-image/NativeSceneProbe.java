import com.jogamp.opengl.*;
import processing.opengl.*;
import processing.core.*;
import processing.data.JSONObject;
import mathart.MathArt;
import mathart.license.LicenseManager;
import mathart.services.*;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlinx.coroutines.BuildersKt;
import java.nio.file.*;
import java.lang.reflect.Method;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;

/** Diagnostic host: original scene, renderer, authorization and export enhancement methods. */
public final class NativeSceneProbe {

 static int observedFrame=-1,drawOrdinal=0;
 static void observeDraw(GL4 gl,Path output,String call)throws Exception {
  if(observedFrame!=3)return;
  if(++drawOrdinal>48)throw new IllegalStateException("draw readback bound");
  int[] vp=new int[4];gl.glGetIntegerv(GL4.GL_VIEWPORT,vp,0);
  JSONObject row=new JSONObject();row.setInt("frame",observedFrame);row.setInt("ordinal",drawOrdinal);row.setString("call",call);row.setJSONArray("viewport",processing.data.JSONArray.parse(jsonValue(vp)));
  int[] program={0};gl.glGetIntegerv(GL4.GL_CURRENT_PROGRAM,program,0);row.setInt("program",program[0]);
  row.setString("stack",java.util.Arrays.toString(Thread.currentThread().getStackTrace()));
  if(vp[2]!=500||vp[3]!=600){Files.writeString(output.resolve("draw-"+drawOrdinal+".json"),row.toString());return;}
  int loc=gl.glGetUniformLocation(program[0],"texMap");
  if(loc>=0){int[] active={0},unit={0},binding={0},w={0},h={0};gl.glGetIntegerv(GL4.GL_ACTIVE_TEXTURE,active,0);gl.glGetUniformiv(program[0],loc,unit,0);
   try{gl.glActiveTexture(GL4.GL_TEXTURE0+unit[0]);gl.glGetIntegerv(GL4.GL_TEXTURE_BINDING_2D,binding,0);gl.glGetTexLevelParameteriv(GL4.GL_TEXTURE_2D,0,GL4.GL_TEXTURE_WIDTH,w,0);gl.glGetTexLevelParameteriv(GL4.GL_TEXTURE_2D,0,GL4.GL_TEXTURE_HEIGHT,h,0);row.setInt("texture",binding[0]);row.setInt("textureWidth",w[0]);row.setInt("textureHeight",h[0]);}
   finally{gl.glActiveTexture(active[0]);}
  }
  int[] draw={0},read={0},readBuffer={0};gl.glGetIntegerv(GL4.GL_DRAW_FRAMEBUFFER_BINDING,draw,0);gl.glGetIntegerv(GL4.GL_READ_FRAMEBUFFER_BINDING,read,0);gl.glGetIntegerv(GL4.GL_READ_BUFFER,readBuffer,0);row.setInt("drawFramebuffer",draw[0]);
  try{gl.glBindFramebuffer(GL4.GL_READ_FRAMEBUFFER,draw[0]);gl.glReadBuffer(GL4.GL_COLOR_ATTACHMENT0);java.nio.ByteBuffer data=java.nio.ByteBuffer.allocateDirect(500*600*4);gl.glReadPixels(0,0,500,600,GL4.GL_RGBA,GL4.GL_UNSIGNED_BYTE,data);byte[] bytes=new byte[data.capacity()];data.get(bytes);Files.write(output.resolve("draw-"+drawOrdinal+".rgba"),bytes);}
  finally{gl.glBindFramebuffer(GL4.GL_READ_FRAMEBUFFER,read[0]);gl.glReadBuffer(readBuffer[0]);}
  Files.writeString(output.resolve("draw-"+drawOrdinal+".json"),row.toString());
 }

 static Object call(MathArt app,String name,Class<?>[] types,Object...args)throws Exception {
  Method m=MathArt.class.getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(app,args);
 }
 static Object field(Object target,String name)throws Exception{Class<?> c=target instanceof Class?(Class<?>)target:target.getClass();while(c!=null){try{java.lang.reflect.Field f=c.getDeclaredField(name);f.setAccessible(true);return f.get(target instanceof Class?null:target);}catch(NoSuchFieldException e){c=c.getSuperclass();}}throw new NoSuchFieldException(name);}
 static String jsonValue(Object v){if(v==null)return "null";if(v instanceof Number||v instanceof Boolean)return v.toString();if(v.getClass().isArray()){StringBuilder b=new StringBuilder("[");for(int i=0;i<java.lang.reflect.Array.getLength(v);i++){if(i>0)b.append(',');b.append(jsonValue(java.lang.reflect.Array.get(v,i)));}return b.append(']').toString();}return "\""+v.toString().replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r").replace("\t","\\t")+"\"";}
 static void dump(MathArt app,GLAutoDrawable drawable,Path output)throws Exception{
  Object object=field(app.currentScene,"fractal");PShader shader=(PShader)field(object,"shader");
  Files.writeString(output.resolve("actual-fragment.glsl"),String.join("\n",(String[])field(shader,"fragmentShaderSource"))+"\n");Files.writeString(output.resolve("actual-vertex.glsl"),String.join("\n",(String[])field(shader,"vertexShaderSource"))+"\n");
  java.util.Map<String,Object> facts=new java.util.LinkedHashMap<>();for(String name:new String[]{"passIndex","lastRenderState","renderMethod","currentTime","zoom","gradientSize","gradientTex","gradientDirty","gradientHash"})facts.put(name,field(object,name));
  GL2ES2 gl=drawable.getGL().getGL2ES2();int[] count={0};gl.glGetProgramiv(shader.glProgram,GL2ES2.GL_ACTIVE_UNIFORMS,count,0);if(count[0]>256)throw new IllegalStateException("Uniform count bound");
  StringBuilder uniforms=new StringBuilder("[\n");for(int i=0;i<count[0];i++){int[] length={0},size={0},type={0};byte[] name=new byte[1024];gl.glGetActiveUniform(shader.glProgram,i,name.length,length,0,size,0,type,0,name,0);String key=new String(name,0,length[0],java.nio.charset.StandardCharsets.UTF_8);if(size[0]>512)throw new IllegalStateException("Uniform array bound");int components=switch(type[0]){case 0x1406,0x1404,0x8B56,0x8B5E->1;case 0x8B50,0x8B53,0x8B57->2;case 0x8B51,0x8B54,0x8B58->3;case 0x8B52,0x8B55,0x8B59,0x8B5A->4;case 0x8B5B->9;case 0x8B5C->16;default->throw new IllegalStateException("Unmapped uniform type "+type[0]);};float[][] values=new float[size[0]][];for(int n=0;n<size[0];n++){String element=size[0]>1?key.replace("[0]","["+n+"]"):key;int location=gl.glGetUniformLocation(shader.glProgram,element);if(location<0)throw new IllegalStateException("No location "+element);values[n]=new float[components];gl.glGetUniformfv(shader.glProgram,location,values[n],0);}if(i>0)uniforms.append(",\n");uniforms.append("{\"name\":").append(jsonValue(key)).append(",\"glType\":").append(type[0]).append(",\"arraySize\":").append(size[0]).append(",\"floatQueryValues\":").append(jsonValue(values)).append('}');}
  Files.writeString(output.resolve("uploaded-uniforms.json"),uniforms.append("\n]\n").toString());StringBuilder b=new StringBuilder("{\n");for(var e:facts.entrySet()){if(b.length()>2)b.append(",\n");b.append(jsonValue(e.getKey())).append(':').append(jsonValue(e.getValue()));}Files.writeString(output.resolve("mobject-fields.json"),b.append("\n}\n").toString());check(drawable,"shaderUniformQuery");System.out.println("shaderOracle=true,uniformCount="+count[0]);
 }

 static void state(MathArt app,String phase)throws Exception{Object f=field(app.currentScene,"fractal");System.out.println("fractalState="+phase+",frameCount="+app.frameCount+",passIndex="+field(f,"passIndex")+",lastRenderState="+field(f,"lastRenderState")+",method="+field(f,"renderMethod")+",time="+field(f,"currentTime")+",zoom="+field(f,"zoom"));}
 static void windows(String phase){java.awt.Window[] ws=java.awt.Window.getWindows();int visible=0;for(java.awt.Window w:ws)if(w.isVisible())visible++;System.out.println("windows="+phase+",objects="+ws.length+",visible="+visible+",toolkit="+java.awt.Toolkit.getDefaultToolkit().getClass().getName());if(ws.length!=0||visible!=0)throw new IllegalStateException("Unexpected Window object at "+phase);}
 static void check(GLAutoDrawable d,String phase){windows(phase);int error=d.getGL().glGetError();if(error!=0)throw new IllegalStateException(phase+" GL="+error);System.out.println("gl="+phase+":0");}
 public static void main(String[] args)throws Exception {
  if(args.length!=3)throw new IllegalArgumentException("scene JSON, new output directory, original app data directory required");
  windows("entry");
  Path output=Path.of(args[1]);JSONObject json=JSONObject.parse(Files.readString(Path.of(args[0])));
  System.setProperty("mathart.app.data.dir",args[2]);System.setProperty("mathart.license.cache.path",Path.of(args[2],"license.dat").toString());System.setProperty("mathart.app.version","1.7.8");
  LicenseManager license=LicenseManager.getInstance();license.init();
  SceneAccessPolicyService policy=SceneAccessPolicyService.INSTANCE;
  SceneAccessPolicyService.RefreshResult policyResult=BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,(scope,continuation)->policy.refreshAtStartup(continuation));
  String sceneType=json.getString("type");
  System.out.println("tier="+license.getCurrentTier()+",watermark="+license.hasWatermark()+",policySource="+policyResult.getSource());
  for(SceneAccessAction action:new SceneAccessAction[]{SceneAccessAction.VIEW,SceneAccessAction.RUN,SceneAccessAction.EXPORT}){
   boolean allowed=policy.evaluate(sceneType,action,license.getCurrentTier()).getAllowed();System.out.println("allowed="+action+":"+allowed);if(!allowed)throw new IllegalStateException("Original policy disallows "+action);
  }
  if(license.getMaxExportResolution()<600)throw new IllegalStateException("Original export size restriction");
  windows("licenseAndPolicyInitialized");
  System.out.println("stage=beforeGLProfile");GLProfile.initSingleton();System.out.println("stage=afterGLProfile");GLCapabilities caps=new GLCapabilities(GLProfile.getGL2ES2());caps.setOnscreen(false);caps.setDoubleBuffered(false);caps.setAlphaBits(8);caps.setDepthBits(24);caps.setStencilBits(8);
  System.out.println("stage=beforeFactory");GLDrawableFactory factory=GLDrawableFactory.getFactory(caps.getGLProfile());System.out.println("stage=afterFactory,beforeCreateDrawable");
  GLOffscreenAutoDrawable drawable=factory.createOffscreenAutoDrawable(null,caps,null,500,600);
  System.out.println("stage=afterCreateDrawable");
  try{drawable.addGLEventListener(new GLEventListener(){
   public void init(GLAutoDrawable d){} public void reshape(GLAutoDrawable d,int x,int y,int w,int h){} public void dispose(GLAutoDrawable d){check(d,"drawableDispose");}
   public void display(GLAutoDrawable d){
    GL4 underlying=d.getGL().getGL4();GL4 checked=(GL4)GLPipelineFactory.create("com.jogamp.opengl.Debug",null,underlying,null);
    GL4 observed=(GL4)java.lang.reflect.Proxy.newProxyInstance(GL4.class.getClassLoader(),new Class<?>[]{GL4.class},(proxy,method,args2)->{
     if(method.getName().startsWith("getGL")&&method.getParameterCount()==0&&method.getReturnType().isInstance(proxy))return proxy;
     try{Object result=method.invoke(checked,args2);if(method.getName().startsWith("glDrawElements")||method.getName().startsWith("glDrawArrays"))observeDraw(underlying,output,method.getName()+java.util.Arrays.toString(args2));return result;}
     catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
    });d.setGL(observed);System.out.println("chosen="+d.getChosenGLCapabilities());
    MathArt app=new MathArt();app.sketchPath();app.width=405;app.height=486;app.pixelWidth=810;app.pixelHeight=972;app.pixelDensity=2;app.frameRate=60;
    app.config.renderWidth=500;app.config.renderHeight=600;app.config.renderFps=60;app.config.saveVideo=false;app.config.showDebugInfo=false;
    app.updateRestrictedBadgeText("FREE Restricted","Upgrade to PRO to unlock");
    PGraphics3D primary=new PGraphics3D();primary.noSmooth();app.g=primary;primary.setParent(app);primary.setPrimary(true);primary.pixelDensity=2;primary.setSize(405,486);((PJOGL)primary.pgl).getGL(d);((PJOGL)primary.pgl).init(d);
    PGraphics3D buffer=null,alternate=null;
    try{
     app.reloadConfig(json);call(app,"initScene",new Class<?>[]{});check(d,"initScene");
     if(app.currentScene==null)throw new IllegalStateException("Original initScene did not create scene");
     System.out.println("scene="+app.currentScene.getClass().getName()+",type="+app.getCurrentSceneType());
     buffer=(PGraphics3D)app.createGraphics(250,300,"processing.opengl.PGraphics3D");buffer.noSmooth();((PJOGL)buffer.pgl).getGL(d);((PJOGL)buffer.pgl).init(d);app.renderBuffer=buffer;
     System.out.printf("primary=%dx%d,density=%d;buffer=%dx%d,pixels=%dx%d,density=%d%n",primary.width,primary.height,primary.pixelDensity,buffer.width,buffer.height,buffer.pixelWidth,buffer.pixelHeight,buffer.pixelDensity);
     // The public frame method performs the original paused update + full render.
     for(int warm=0;warm<7;warm++){
      observedFrame=warm;state(app,"before"+warm);buffer.beginDraw();app.currentScene.runFrame(buffer,true);buffer.endDraw();state(app,"after"+warm);Path facts=output.resolve("frame-"+warm);Files.createDirectory(facts);dump(app,d,facts);
      System.out.println("font="+buffer.textFont.getName()+",ps="+buffer.textFont.getPostScriptName()+",size="+buffer.textFont.getSize()+",smooth="+buffer.textFont.isSmooth()+",native="+buffer.textFont.getNative());
      buffer.loadPixels(); BufferedImage rawFrame=new BufferedImage(buffer.pixelWidth,buffer.pixelHeight,BufferedImage.TYPE_INT_ARGB);rawFrame.setRGB(0,0,buffer.pixelWidth,buffer.pixelHeight,buffer.pixels,0,buffer.pixelWidth);ImageIO.write(rawFrame,"png",output.resolve("raw-frame-"+warm+".png").toFile());
      BufferedImage iteration=(BufferedImage)call(app,"buildEnhancedImage",new Class<?>[]{PGraphics.class,float.class},buffer,1f);call(app,"writePng",new Class<?>[]{BufferedImage.class,java.io.File.class},iteration,output.resolve("enhanced-frame-"+warm+".png").toFile());check(d,"warmFrame"+warm);
     }
observedFrame=-1;alternate=(PGraphics3D)app.createGraphics(405,486,"processing.opengl.PGraphics3D");
     alternate.noSmooth();((PJOGL)alternate.pgl).getGL(d);((PJOGL)alternate.pgl).init(d);alternate.beginDraw();app.currentScene.render(alternate);alternate.endDraw();state(app,"afterAlternateSize");Path alternateFacts=output.resolve("alternate-size");Files.createDirectory(alternateFacts);dump(app,d,alternateFacts);alternate.loadPixels();BufferedImage altRaw=new BufferedImage(alternate.pixelWidth,alternate.pixelHeight,BufferedImage.TYPE_INT_ARGB);altRaw.setRGB(0,0,alternate.pixelWidth,alternate.pixelHeight,alternate.pixels,0,alternate.pixelWidth);ImageIO.write(altRaw,"png",output.resolve("raw-after-alternate-size.png").toFile());check(d,"alternateSize");
     buffer.beginDraw();app.currentScene.render(buffer);buffer.endDraw();state(app,"afterReturnExportSize");Path facts=output.resolve("after-size-reset");Files.createDirectory(facts);dump(app,d,facts);
     BufferedImage reset=(BufferedImage)call(app,"buildEnhancedImage",new Class<?>[]{PGraphics.class,float.class},buffer,1f);call(app,"writePng",new Class<?>[]{BufferedImage.class,java.io.File.class},reset,output.resolve("enhanced-after-size-reset.png").toFile());
check(d,"sceneFrame");buffer.loadPixels();check(d,"readPixels");
     BufferedImage raw=new BufferedImage(buffer.pixelWidth,buffer.pixelHeight,BufferedImage.TYPE_INT_ARGB);raw.setRGB(0,0,buffer.pixelWidth,buffer.pixelHeight,buffer.pixels,0,buffer.pixelWidth);ImageIO.write(raw,"png",output.resolve("raw.png").toFile());
     BufferedImage enhanced=(BufferedImage)call(app,"buildEnhancedImage",new Class<?>[]{PGraphics.class,float.class},buffer,1f);call(app,"writePng",new Class<?>[]{BufferedImage.class,java.io.File.class},enhanced,output.resolve("enhanced.png").toFile());check(d,"originalEnhancement");
     System.out.println("rendered=true");
    }catch(Exception e){throw new RuntimeException(e);}finally{if(app.currentScene!=null)app.currentScene.dispose();if(buffer!=null)buffer.dispose();if(alternate!=null)alternate.dispose();primary.dispose();check(d,"resourcesDisposed");}
   }
  });System.out.println("stage=beforeDisplay");drawable.display();System.out.println("stage=afterDisplay");}finally{drawable.destroy();GLProfile.shutdown();System.out.println("drawableDestroyed=true");windows("drawableDestroyed");}
 }
}
