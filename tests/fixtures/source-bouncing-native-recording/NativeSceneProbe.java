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

/** Original update -> offscreen render -> VideoRecorder, matching MathArt.draw.
 * The createGraphics bridge only binds newly allocated Processing graphics to
 * this headless JOGL drawable; original sizing, rendering and encoding execute.
 * Normal policy/license checks and branding are never replaced or suppressed. */
public final class NativeSceneProbe {
 static int frame=0;static Path frameOutput;
 static void beforeBranding(GL4 gl)throws Exception {
  if(frameOutput==null)throw new IllegalStateException("Missing frame owner");
  int[] rb={0},rbuf={0},db={0};gl.glGetIntegerv(GL4.GL_READ_FRAMEBUFFER_BINDING,rb,0);gl.glGetIntegerv(GL4.GL_READ_BUFFER,rbuf,0);gl.glGetIntegerv(GL4.GL_DRAW_FRAMEBUFFER_BINDING,db,0);
  try{gl.glBindFramebuffer(GL4.GL_READ_FRAMEBUFFER,db[0]);gl.glReadBuffer(GL4.GL_COLOR_ATTACHMENT0);java.nio.ByteBuffer b=java.nio.ByteBuffer.allocateDirect(384*288*4);gl.glReadPixels(0,0,384,288,GL4.GL_RGBA,GL4.GL_UNSIGNED_BYTE,b);byte[] v=new byte[b.capacity()];b.get(v);Files.write(frameOutput.resolve("before-branding.rgba"),v,StandardOpenOption.CREATE_NEW);Files.writeString(frameOutput.resolve("artwork-boundary.txt"),java.util.Arrays.toString(Thread.currentThread().getStackTrace()),StandardOpenOption.CREATE_NEW);}finally{gl.glBindFramebuffer(GL4.GL_READ_FRAMEBUFFER,rb[0]);gl.glReadBuffer(rbuf[0]);}
 }
 static Object call(MathArt app,String name,Class<?>[] types,Object...args)throws Exception {
  Method m=MathArt.class.getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(app,args);
 }
 static void windows(String phase){java.awt.Window[] ws=java.awt.Window.getWindows();int visible=0;for(java.awt.Window w:ws)if(w.isVisible())visible++;System.out.println("windows="+phase+",objects="+ws.length+",visible="+visible+",toolkit="+java.awt.Toolkit.getDefaultToolkit().getClass().getName());if(ws.length!=0||visible!=0)throw new IllegalStateException("Unexpected Window object at "+phase);}
 static void check(GLAutoDrawable d,String phase){windows(phase);int error=d.getGL().glGetError();if(error!=0)throw new IllegalStateException(phase+" GL="+error);System.out.println("gl="+phase+":0");}
 public static void main(String[] args)throws Exception {
  if(args.length!=3)throw new IllegalArgumentException("scene JSON, new output directory, original app data directory required");
  windows("entry");
  Path output=Path.of(args[1]);JSONObject descriptor=JSONObject.parse(Files.readString(Path.of(args[0]))),json=descriptor.getJSONObject("project");
  System.setProperty("mathart.app.data.dir",args[2]);System.setProperty("mathart.license.cache.path",Path.of(args[2],"license.dat").toString());System.setProperty("mathart.app.version","1.7.8");
  LicenseManager license=LicenseManager.getInstance();license.init();
  SceneAccessPolicyService policy=SceneAccessPolicyService.INSTANCE;
  SceneAccessPolicyService.RefreshResult policyResult=BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,(scope,continuation)->policy.refreshAtStartup(continuation));
  String sceneType=json.getString("type");
  System.out.println("tier="+license.getCurrentTier()+",watermark="+license.hasWatermark()+",policySource="+policyResult.getSource());
  for(SceneAccessAction action:new SceneAccessAction[]{SceneAccessAction.VIEW,SceneAccessAction.RUN,SceneAccessAction.EXPORT}){
   boolean allowed=policy.evaluate(sceneType,action,license.getCurrentTier()).getAllowed();System.out.println("allowed="+action+":"+allowed);if(!allowed)throw new IllegalStateException("Original policy disallows "+action);
  }
  if(license.getMaxExportResolution()<288)throw new IllegalStateException("Original export size restriction");
  windows("licenseAndPolicyInitialized");
  System.out.println("stage=beforeGLProfile");GLProfile.initSingleton();System.out.println("stage=afterGLProfile");GLCapabilities caps=new GLCapabilities(GLProfile.getGL2ES2());caps.setOnscreen(false);caps.setDoubleBuffered(false);caps.setAlphaBits(8);caps.setDepthBits(24);caps.setStencilBits(8);
  System.out.println("stage=beforeFactory");GLDrawableFactory factory=GLDrawableFactory.getFactory(caps.getGLProfile());System.out.println("stage=afterFactory,beforeCreateDrawable");
  GLOffscreenAutoDrawable drawable=factory.createOffscreenAutoDrawable(null,caps,null,384,288);
  System.out.println("stage=afterCreateDrawable");
  try{drawable.addGLEventListener(new GLEventListener(){
   public void init(GLAutoDrawable d){} public void reshape(GLAutoDrawable d,int x,int y,int w,int h){} public void dispose(GLAutoDrawable d){check(d,"drawableDispose");}
   public void display(GLAutoDrawable d){
    GL debug=GLPipelineFactory.create("com.jogamp.opengl.Debug",null,d.getGL(),null);
    final GL4 underlying=debug.getGL4();final int[] ordinal={0},updates={0};
    GL4 observed=(GL4)java.lang.reflect.Proxy.newProxyInstance(GL4.class.getClassLoader(),new Class<?>[]{GL4.class},(proxy,method,args2)->{
      if(method.getName().startsWith("getGL")&&method.getParameterCount()==0&&method.getReturnType().isInstance(proxy))return proxy;
      boolean pointDraw=method.getName().equals("glDrawArrays")&&(int)args2[0]==GL4.GL_POINTS;
      int[] program={0};underlying.glGetIntegerv(GL4.GL_CURRENT_PROGRAM,program,0);
      boolean updateDraw=method.getName().equals("glDrawArrays")&&program[0]>0&&underlying.glGetUniformLocation(program[0],"timeStep")>=0&&underlying.glGetUniformLocation(program[0],"subSteps")>=0;
      JSONObject draw=null;int index=ordinal[0];
      if(pointDraw){
       draw=new JSONObject();draw.setInt("simulationUpdates",updates[0]);draw.setInt("frame",frame);draw.setInt("first",(int)args2[1]);draw.setInt("count",(int)args2[2]);
       for(int key:new int[]{GL4.GL_CURRENT_PROGRAM,GL4.GL_DRAW_FRAMEBUFFER_BINDING,GL4.GL_READ_FRAMEBUFFER_BINDING,GL4.GL_DRAW_BUFFER,GL4.GL_READ_BUFFER,GL4.GL_VERTEX_ARRAY_BINDING,GL4.GL_ACTIVE_TEXTURE,GL4.GL_TEXTURE_BINDING_2D,GL4.GL_BLEND_SRC_RGB,GL4.GL_BLEND_DST_RGB}){int[]v={0};underlying.glGetIntegerv(key,v,0);draw.setInt("int_"+key,v[0]);}
       for(int key:new int[]{GL4.GL_BLEND,GL4.GL_DEPTH_TEST,GL4.GL_SCISSOR_TEST,GL4.GL_RASTERIZER_DISCARD,GL4.GL_PROGRAM_POINT_SIZE,GL4.GL_CULL_FACE})draw.setBoolean("enabled_"+key,underlying.glIsEnabled(key));
       int[] viewport=new int[4];underlying.glGetIntegerv(GL4.GL_VIEWPORT,viewport,0);processing.data.JSONArray vp=new processing.data.JSONArray();for(int v:viewport)vp.append(v);draw.setJSONArray("viewport",vp);
       byte[] mask=new byte[4];underlying.glGetBooleanv(GL4.GL_COLOR_WRITEMASK,mask,0);processing.data.JSONArray cm=new processing.data.JSONArray();for(byte v:mask)cm.append((int)v);draw.setJSONArray("colorMask",cm);
      }
      Object result;try{result=method.invoke(debug,args2);}catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
      if(updateDraw)updates[0]++;
      if(method.getName().equals("glDisable")&&((Integer)args2[0])==GL4.GL_DEPTH_TEST&&java.util.Arrays.stream(Thread.currentThread().getStackTrace()).anyMatch(f->f.getClassName().equals("mathart.scene.Scene")&&f.getMethodName().equals("drawWatermark")))beforeBranding(underlying);
      if(pointDraw){
       for(String key:new String[]{"projection","modelview","scale","offset","radius","speedScale","paletteCount","particleCount","texSize"}){
        int loc=underlying.glGetUniformLocation(program[0],key);float[] values=new float[(key.equals("projection")||key.equals("modelview"))?16:(key.equals("scale")||key.equals("offset"))?3:1];underlying.glGetUniformfv(program[0],loc,values,0);processing.data.JSONArray a=new processing.data.JSONArray();for(float v:values)a.append(v);draw.setJSONArray(key,a);
       }
       if(frame==1||frame==3||frame==4||frame==7||frame==8||frame==12||frame==23||frame==32||frame==38||frame==53||frame==62){
        int[] active={0},binding={0},unit={0};underlying.glGetIntegerv(GL4.GL_ACTIVE_TEXTURE,active,0);underlying.glGetUniformiv(program[0],underlying.glGetUniformLocation(program[0],"stateTex"),unit,0);underlying.glActiveTexture(GL4.GL_TEXTURE0+unit[0]);underlying.glGetIntegerv(GL4.GL_TEXTURE_BINDING_2D,binding,0);
        try{int[] w={0},h={0};underlying.glGetTexLevelParameteriv(GL4.GL_TEXTURE_2D,0,GL4.GL_TEXTURE_WIDTH,w,0);underlying.glGetTexLevelParameteriv(GL4.GL_TEXTURE_2D,0,GL4.GL_TEXTURE_HEIGHT,h,0);if(w[0]*h[0]*16>128*1024*1024)throw new IllegalStateException("state byte bound");java.nio.ByteBuffer state=java.nio.ByteBuffer.allocateDirect(w[0]*h[0]*16).order(java.nio.ByteOrder.nativeOrder());underlying.glGetTexImage(GL4.GL_TEXTURE_2D,0,GL4.GL_RGBA,GL4.GL_FLOAT,state);byte[] v=new byte[state.capacity()];state.get(v);Files.write(frameOutput.resolve("state.f32"),v);draw.setInt("stateWidth",w[0]);draw.setInt("stateHeight",h[0]);}finally{underlying.glBindTexture(GL4.GL_TEXTURE_2D,binding[0]);underlying.glActiveTexture(active[0]);}
       }
       Files.writeString(frameOutput.resolve("point-draw.json"),draw.toString());ordinal[0]++;
      }
      return result;
    });d.setGL(observed);System.out.println("chosen="+d.getChosenGLCapabilities());
    MathArt app=new MathArt(){
     @Override public PGraphics createGraphics(int width,int height,String renderer){
      PGraphics graphics=super.createGraphics(width,height,renderer);
      if(graphics instanceof PGraphicsOpenGL pg){((PJOGL)pg.pgl).getGL(d);((PJOGL)pg.pgl).init(d);}
      return graphics;
     }
    };app.sketchPath();app.width=405;app.height=486;app.pixelWidth=810;app.pixelHeight=972;app.pixelDensity=2;app.frameRate=60;
    float fps=descriptor.getInt("fps",12);if(fps<1||fps>120)throw new IllegalArgumentException("Recording fps outside 1–120");
    app.config.renderWidth=128;app.config.renderHeight=96;app.config.renderFps=(int)fps;app.config.saveVideo=false;app.config.showDebugInfo=false;
    app.updateRestrictedBadgeText("FREE Restricted","Upgrade to PRO to unlock");
    PGraphics3D primary=new PGraphics3D();primary.noSmooth();app.g=primary;primary.setParent(app);primary.setPrimary(true);primary.pixelDensity=2;primary.setSize(405,486);((PJOGL)primary.pgl).getGL(d);((PJOGL)primary.pgl).init(d);
    PGraphics3D buffer=null;mathart.utils.VideoRecorder recorder=null;
    try{
     app.reloadConfig(json);call(app,"initScene",new Class<?>[]{});check(d,"initScene");
     if(app.currentScene==null)throw new IllegalStateException("Original initScene did not create scene");
     System.out.println("scene="+app.currentScene.getClass().getName()+",type="+app.getCurrentSceneType());
     call(app,"ensureRenderBuffer",new Class<?>[]{});buffer=(PGraphics3D)app.renderBuffer;
     if(buffer.pixelWidth!=384||buffer.pixelHeight!=288)throw new IllegalStateException("Unexpected actual original recording size");
     System.out.printf("primary=%dx%d,density=%d;buffer=%dx%d,pixels=%dx%d,density=%d%n",primary.width,primary.height,primary.pixelDensity,buffer.width,buffer.height,buffer.pixelWidth,buffer.pixelHeight,buffer.pixelDensity);
     app.currentScene.setRenderMode(fps);
     recorder=new mathart.utils.VideoRecorder(app,output.resolve("original.mp4").toString(),fps,buffer.pixelWidth,buffer.pixelHeight,128,96);
     recorder.setQuality(app.config.renderQuality);recorder.setFFmpegPath(descriptor.getString("ffmpegPath"));recorder.start();
     java.lang.reflect.Field processField=mathart.utils.VideoRecorder.class.getDeclaredField("ffmpeg");processField.setAccessible(true);Process encoder=(Process)processField.get(recorder);
     JSONObject encoderFacts=new JSONObject();encoderFacts.setLong("pid",encoder.pid());encoderFacts.setString("command",encoder.info().command().orElse(""));processing.data.JSONArray arguments=new processing.data.JSONArray();for(String argument:encoder.info().arguments().orElseThrow())arguments.append(argument);encoderFacts.setJSONArray("arguments",arguments);encoderFacts.setFloat("exportScaleFactor",app.config.exportScaleFactor);
     Files.writeString(output.resolve("encoder.json"),encoderFacts.toString());
     processing.data.JSONArray frames=new processing.data.JSONArray();boolean complete=false;
     for(frame=0;frame<8;frame++){
      frameOutput=output.resolve("frame-"+frame);Files.createDirectory(frameOutput);
      // MathArt.draw updates the primary scene before beginning its export buffer.
      app.currentScene.update(false);
      buffer.beginDraw();app.currentScene.render(buffer);buffer.endDraw();check(d,"recordingFrame"+frame);
      if(!Files.exists(frameOutput.resolve("point-draw.json")))throw new IllegalStateException("Original particle draw telemetry missing");
      JSONObject point=JSONObject.parse(Files.readString(frameOutput.resolve("point-draw.json")));processing.data.JSONArray viewport=point.getJSONArray("viewport");
      if(viewport.getInt(0)!=0||viewport.getInt(1)!=0||viewport.getInt(2)!=384||viewport.getInt(3)!=288)throw new IllegalStateException("Invalid original active particle viewport: "+viewport);
      if(point.getInt("count")!=json.getJSONObject("settings").getInt("particle_count")||point.getInt("simulationUpdates")!=frame+1)throw new IllegalStateException("Original count or update sequence mismatch");
      if(!Files.exists(frameOutput.resolve("before-branding.rgba")))throw new IllegalStateException("Missing original branding boundary");
      buffer.loadPixels();byte[] rgba=new byte[buffer.pixels.length*4];for(int i=0;i<buffer.pixels.length;i++){int c=buffer.pixels[i];rgba[4*i]=(byte)(c>>16);rgba[4*i+1]=(byte)(c>>8);rgba[4*i+2]=(byte)c;rgba[4*i+3]=(byte)(c>>24);}Files.write(frameOutput.resolve("final.rgba"),rgba);
      BufferedImage raw=new BufferedImage(buffer.pixelWidth,buffer.pixelHeight,BufferedImage.TYPE_INT_ARGB);raw.setRGB(0,0,buffer.pixelWidth,buffer.pixelHeight,buffer.pixels,0,buffer.pixelWidth);ImageIO.write(raw,"png",frameOutput.resolve("final.png").toFile());
      if(frame>0){recorder.recordFrame(buffer);java.lang.reflect.Field bytes=mathart.utils.VideoRecorder.class.getDeclaredField("resampleBuffer");bytes.setAccessible(true);Files.write(frameOutput.resolve("encoder-input.rgba"),((byte[])bytes.get(recorder)).clone());if(!recorder.isRecording)throw new IllegalStateException("Original recorder stopped unexpectedly");}
      complete=app.currentScene.isAutoRecordingComplete();JSONObject row=new JSONObject();row.setInt("frame",frame);row.setFloat("sceneTime",app.currentScene.getTime());row.setFloat("rawDt",app.currentScene.getFrameDeltaTime());row.setBoolean("complete",complete);row.setBoolean("encoded",frame>0);row.setInt("width",buffer.pixelWidth);row.setInt("height",buffer.pixelHeight);frames.append(row);
      if(complete)break;
     }
     if(!complete)throw new IllegalStateException("Original recording did not complete");
     Files.writeString(output.resolve("frames.json"),frames.toString());recorder.finish();recorder=null;
     encoderFacts.setBoolean("aliveAfterFinish",encoder.isAlive());if(!encoder.isAlive())encoderFacts.setInt("exit",encoder.exitValue());Files.writeString(output.resolve("encoder.json"),encoderFacts.toString());if(encoder.isAlive()||encoder.exitValue()!=0)throw new IllegalStateException("Original encoder cleanup failed");
     app.currentScene.disableRenderMode();
     System.out.println("rendered=true");
    }catch(Exception e){throw new RuntimeException(e);}finally{if(recorder!=null)recorder.finish();if(app.currentScene!=null)app.currentScene.dispose();if(buffer!=null)buffer.dispose();primary.dispose();check(d,"resourcesDisposed");}
   }
  });System.out.println("stage=beforeDisplay");drawable.display();System.out.println("stage=afterDisplay");}finally{drawable.destroy();GLProfile.shutdown();System.out.println("drawableDestroyed=true");windows("drawableDestroyed");}
 }
}
