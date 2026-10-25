import processing.core.PMatrix3D;
import processing.data.JSONArray;
import processing.data.JSONObject;
import java.nio.file.*;

/** Diagnostic pure-math caller. Runs the pinned Processing class without a
 * PApplet, window, GL context or MathArt application. Inputs/outputs are bits. */
public class MatrixOracle {
 public static void main(String[] args)throws Exception {
  JSONArray input=JSONArray.parse(Files.readString(Path.of(args[0]))),out=new JSONArray();
  for(int i=0;i<input.size();i++){
   JSONObject row=input.getJSONObject(i);JSONArray words=row.getJSONArray("inputBits");float[] values=new float[16];
   for(int j=0;j<16;j++)values[j]=Float.intBitsToFloat((int)words.getLong(j));
   PMatrix3D matrix=new PMatrix3D();matrix.set(values);float determinant=matrix.determinant();boolean inverted=matrix.invert();
   JSONObject result=new JSONObject();result.setString("name",row.getString("name"));result.setJSONArray("inputBits",words);result.setBoolean("inverted",inverted);result.setLong("determinantBits",Integer.toUnsignedLong(Float.floatToRawIntBits(determinant)));JSONArray output=new JSONArray();for(float value:matrix.get(null))output.append(Integer.toUnsignedLong(Float.floatToRawIntBits(value)));result.setJSONArray("outputBits",output);out.append(result);
  }
  Files.writeString(Path.of(args[1]),out.toString(),StandardOpenOption.CREATE_NEW);
 }
}
