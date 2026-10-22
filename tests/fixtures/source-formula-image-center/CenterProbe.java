import processing.core.*;
public class CenterProbe extends PGraphics {
 protected void imageImpl(PImage image,float x1,float y1,float x2,float y2,int u1,int v1,int u2,int v2){System.out.printf("{\"width\":%d,\"height\":%d,\"rect\":[%s,%s,%s,%s],\"uv\":[%d,%d,%d,%d]}%n",image.width,image.height,x1,y1,x2,y2,u1,v1,u2,v2);}
 public static void main(String[] args){CenterProbe g=new CenterProbe();g.imageMode(CENTER);for(int[] d:new int[][]{{1100,259},{952,323},{1038,353},{1344,229},{1343,319},{820,229},{170,72}})g.image(new PImage(d[0],d[1]),0,0);}
}
