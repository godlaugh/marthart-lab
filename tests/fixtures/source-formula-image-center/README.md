# Original image CENTER coordinates

`native.json` records calls to the original bundled Processing 4.5.0
`PGraphics.image(PImage,float,float)` method in MathArt 1.7.8.
`CenterProbe.java` only overrides the receiving `imageImpl` method to print its
arguments; it does not reimplement the CENTER calculation. No GL context,
application window, license state, or user settings are needed.

Run with an existing compatible JDK and the caller-selected bundled core JAR:

```sh
javac -cp /absolute/path/core-4.5.0.jar -d /absolute/path/new-output CenterProbe.java
java -cp /absolute/path/new-output:/absolute/path/core-4.5.0.jar CenterProbe
```

The fixture pins the original `processing/core/PGraphics.class` SHA-256.
The first six dimensions are captured native formula textures; the last case
checks an even width and height. Tests apply these recorded rectangles at
multiple scales and separately preserve geometric centering for vector assets.
The binary and generated `.class` files are not distributed in this fixture.
