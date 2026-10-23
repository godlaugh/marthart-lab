import com.jogamp.opengl.GL4;
import processing.data.JSONObject;
import java.nio.file.*;

/** Bounded diagnostic replay for the four captured residual states; never used by the product. */
public final class NativeBlendDiagnostic {
 static void capture(GL4 gl,Path output,int frame)throws Exception {
  int pixelY=403-((frame-8)/15)*16;
  int[] ids={2403,4288,15775,20538,29302,35411,36948,44017,60694,86020,87415,92527,107870,128441,129379,130854,158905,163008,187526,188205,198240,215868,240945,246401,256686,262259,269855,278543,288268,289685,299254,345190,350561,354289,359368,374748,387055,390565,392738,404933,428902,431610,444140,446192,449648,459172,463632,503587,535596,536608,550975,553106,589675,616446,644709,654034,660753,689460,692480,699836,704173,715660,730006,755232,784502,800102,816213,823133,838318,843296,848167,849932,850026,865214,874583,874842,880100,884221,891500,894979,911292,915601,918054,922297,923284,927255,933102,965091,972116,991556,995052,995246,998934,1001600,1004792,1017875,1018274,1019135,1037960,1068221,1096443,1100406,1116421,1121196,1145887,1147832,1159610,1171828,1212776,1225239,1239686,1246210,1257909,1274212,1279812,1385530,1387416,1388619,1391410,1396122,1413838,1416434,1416465,1416941,1460809,1471331,1474840,1488018,1491513,1492498,1519502,1522182,1527574,1529368,1531805,1550003,1561061,1626239,1635485,1649927,1656089,1660015,1679331,1682954,1688173,1692940,1694887,1700367,1717764,1719243,1720966,1730334,1757779,1768492,1793615,1804631,1806098,1806156,1807256,1822359,1828364,1845637,1846385,1863973,1876501,1881601,1885510,1894020,1894518,1914411,1924457,1935300,1941795,1955526,1964319,1973629};
  int[] draw={0},read={0},tex={0};gl.glGetIntegerv(GL4.GL_DRAW_FRAMEBUFFER_BINDING,draw,0);gl.glGetIntegerv(GL4.GL_READ_FRAMEBUFFER_BINDING,read,0);gl.glGetIntegerv(GL4.GL_TEXTURE_BINDING_2D,tex,0);
  float[] clear=new float[4];gl.glGetFloatv(GL4.GL_COLOR_CLEAR_VALUE,clear,0);boolean blend=gl.glIsEnabled(GL4.GL_BLEND);
  int[] f={0},t={0};gl.glGenFramebuffers(1,f,0);gl.glGenTextures(1,t,0);
  JSONObject report=new JSONObject();report.setString("renderer",gl.glGetString(GL4.GL_RENDERER));report.setBoolean("dither",gl.glIsEnabled(GL4.GL_DITHER));
  try {
   gl.glBindFramebuffer(GL4.GL_FRAMEBUFFER,f[0]);gl.glBindTexture(GL4.GL_TEXTURE_2D,t[0]);gl.glTexParameteri(GL4.GL_TEXTURE_2D,GL4.GL_TEXTURE_MIN_FILTER,GL4.GL_NEAREST);gl.glTexParameteri(GL4.GL_TEXTURE_2D,GL4.GL_TEXTURE_MAG_FILTER,GL4.GL_NEAREST);
   gl.glTexImage2D(GL4.GL_TEXTURE_2D,0,GL4.GL_RGBA8,500,600,0,GL4.GL_RGBA,GL4.GL_UNSIGNED_BYTE,null);gl.glFramebufferTexture2D(GL4.GL_FRAMEBUFFER,GL4.GL_COLOR_ATTACHMENT0,GL4.GL_TEXTURE_2D,t[0],0);
   // Restore source state texture while retaining the owned diagnostic attachment.
   gl.glBindTexture(GL4.GL_TEXTURE_2D,tex[0]);
   if(gl.glCheckFramebufferStatus(GL4.GL_FRAMEBUFFER)!=GL4.GL_FRAMEBUFFER_COMPLETE)throw new IllegalStateException("Diagnostic RGBA8 incomplete");
   gl.glClearColor(0,0,0,1);gl.glClear(GL4.GL_COLOR_BUFFER_BIT);gl.glEnable(GL4.GL_BLEND);
   processing.data.JSONArray cumulative=new processing.data.JSONArray();int next=0;
   for(int id:ids){if(id>next)gl.glDrawArrays(GL4.GL_POINTS,next,id-next);gl.glDrawArrays(GL4.GL_POINTS,id,1);java.nio.ByteBuffer b=java.nio.ByteBuffer.allocateDirect(4);gl.glReadPixels(264,pixelY,1,1,GL4.GL_RGBA,GL4.GL_UNSIGNED_BYTE,b);JSONObject r=new JSONObject();r.setInt("id",id);processing.data.JSONArray a=new processing.data.JSONArray();for(int i=0;i<4;i++)a.append(b.get(i)&255);r.setJSONArray("rgba",a);cumulative.append(r);next=id+1;}
   gl.glDrawArrays(GL4.GL_POINTS,next,2000000-next);java.nio.ByteBuffer b=java.nio.ByteBuffer.allocateDirect(4);gl.glReadPixels(264,pixelY,1,1,GL4.GL_RGBA,GL4.GL_UNSIGNED_BYTE,b);processing.data.JSONArray finalPixel=new processing.data.JSONArray();for(int i=0;i<4;i++)finalPixel.append(b.get(i)&255);report.setJSONArray("finalPixel",finalPixel);report.setJSONArray("cumulative",cumulative);
   gl.glBindTexture(GL4.GL_TEXTURE_2D,t[0]);gl.glTexImage2D(GL4.GL_TEXTURE_2D,0,GL4.GL_RGBA32F,500,600,0,GL4.GL_RGBA,GL4.GL_FLOAT,null);gl.glBindTexture(GL4.GL_TEXTURE_2D,tex[0]);
   if(gl.glCheckFramebufferStatus(GL4.GL_FRAMEBUFFER)!=GL4.GL_FRAMEBUFFER_COMPLETE)throw new IllegalStateException("Diagnostic RGBA32F incomplete");
   gl.glDisable(GL4.GL_BLEND);gl.glClearColor(0,0,0,0);processing.data.JSONArray separate=new processing.data.JSONArray();
   for(int id:ids){gl.glClear(GL4.GL_COLOR_BUFFER_BIT);gl.glDrawArrays(GL4.GL_POINTS,id,1);java.nio.FloatBuffer b2=java.nio.ByteBuffer.allocateDirect(16).order(java.nio.ByteOrder.nativeOrder()).asFloatBuffer();gl.glReadPixels(264,pixelY,1,1,GL4.GL_RGBA,GL4.GL_FLOAT,b2);JSONObject r=new JSONObject();r.setInt("id",id);processing.data.JSONArray a=new processing.data.JSONArray();for(int i=0;i<4;i++)a.append(b2.get(i));r.setJSONArray("rgba",a);separate.append(r);}report.setJSONArray("separate",separate);
   
   processing.data.JSONArray blends=new processing.data.JSONArray();
   for(int format:new int[]{GL4.GL_RGBA8,GL4.GL_RGBA32F}){
    gl.glBindTexture(GL4.GL_TEXTURE_2D,t[0]);gl.glTexImage2D(GL4.GL_TEXTURE_2D,0,format,500,600,0,GL4.GL_RGBA,format==GL4.GL_RGBA8?GL4.GL_UNSIGNED_BYTE:GL4.GL_FLOAT,null);gl.glBindTexture(GL4.GL_TEXTURE_2D,tex[0]);
    for(int green=138;green<=142;green++){
     gl.glEnable(GL4.GL_BLEND);gl.glClearColor(134f/255f,green/255f,188f/255f,198f/255f);gl.glClear(GL4.GL_COLOR_BUFFER_BIT);gl.glDrawArrays(GL4.GL_POINTS,1973629,1);
     java.nio.FloatBuffer value=java.nio.ByteBuffer.allocateDirect(16).order(java.nio.ByteOrder.nativeOrder()).asFloatBuffer();gl.glReadPixels(264,pixelY,1,1,GL4.GL_RGBA,GL4.GL_FLOAT,value);
     JSONObject item=new JSONObject();item.setInt("format",format);item.setInt("destinationGreen",green);processing.data.JSONArray rgba=new processing.data.JSONArray();for(int i=0;i<4;i++)rgba.append(value.get(i));item.setJSONArray("rgba",rgba);blends.append(item);
    }
   }
   report.setJSONArray("blendControl",blends);
   Files.writeString(output.resolve("fragment-diagnostic-frame-"+frame+".json"),report.toString(),StandardOpenOption.CREATE_NEW);
  }finally{gl.glBindFramebuffer(GL4.GL_DRAW_FRAMEBUFFER,draw[0]);gl.glBindFramebuffer(GL4.GL_READ_FRAMEBUFFER,read[0]);gl.glBindTexture(GL4.GL_TEXTURE_2D,tex[0]);gl.glClearColor(clear[0],clear[1],clear[2],clear[3]);if(blend)gl.glEnable(GL4.GL_BLEND);else gl.glDisable(GL4.GL_BLEND);gl.glDeleteFramebuffers(1,f,0);gl.glDeleteTextures(1,t,0);}
 }

}
