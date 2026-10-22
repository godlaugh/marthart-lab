package mathartlab.glyph;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.scilab.forge.jlatexmath.TeXConstants;
import org.scilab.forge.jlatexmath.TeXFormula;
import org.scilab.forge.jlatexmath.TeXIcon;

/** Private, single-request worker. No MathArt or Processing dependency. */
public final class FormulaGlyph {
    private static final int MAGIC = 0x4d414731; // MAG1, big endian
    private static final int MAX_TEXT_BYTES = 32768;
    private static final long MAX_PIXELS = 16_000_000;
    // This is a mathematical annotation language, not the full library's TeX
    // language. In particular, file/image loading and macro definitions are
    // outside this interface. Validate before constructing the TeX parser.
    private static final Set<String> COMMANDS = Set.of(
        "text", "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathbb",
        "frac", "dfrac", "tfrac", "sqrt", "left", "right", "begin", "end",
        "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
        "sinh", "cosh", "tanh", "coth", "exp", "log", "ln", "lg", "min", "max",
        "abs", "lim", "sum", "prod", "int", "iint", "oint", "infty", "partial",
        "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
        "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron",
        "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi",
        "varphi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi",
        "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
        "cdot", "times", "div", "pm", "mp", "le", "leq", "ge", "geq", "ne", "neq",
        "approx", "equiv", "to", "rightarrow", "leftarrow", "mapsto", "in", "notin",
        "cup", "cap", "emptyset", "forall", "exists", "nabla", "ldots", "cdots",
        "overline", "underline", "hat", "bar", "vec", "dot", "ddot", "tilde",
        "lbrace", "rbrace", "langle", "rangle", "lvert", "rvert", "vert", "Vert",
        "lfloor", "rfloor", "lceil", "rceil", "quad", "qquad", "displaystyle",
        "textstyle", "scriptstyle", "scriptscriptstyle", "operatorname"
    );
    private static final Set<String> ENVIRONMENTS = Set.of(
        "cases", "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "aligned"
    );
    private static final class InputFailure extends Exception {
        final int code;
        InputFailure(int code, String message) { super(message); this.code = code; }
    }
    private static void validateMath(String text) throws InputFailure {
        int depth = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '%' || c == '$' || c == '#' || (c < 32 && c != '\n' && c != '\r' && c != '\t'))
                throw new InputFailure(1, "Unsupported TeX control character");
            if (c == '^' && i + 1 < text.length() && text.charAt(i + 1) == '^')
                throw new InputFailure(1, "TeX character rewriting is unsupported");
            if (c == '{' && ++depth > 64) throw new InputFailure(3, "Formula nesting exceeds 64 groups");
            if (c == '}' && --depth < 0) throw new InputFailure(2, "Unbalanced formula groups");
            if (c != '\\') continue;
            if (++i >= text.length()) throw new InputFailure(2, "Incomplete TeX command");
            int start = i;
            while (i < text.length() && ((text.charAt(i) >= 'a' && text.charAt(i) <= 'z') ||
                    (text.charAt(i) >= 'A' && text.charAt(i) <= 'Z'))) i++;
            if (i == start) {
                if ("\\{},;!_%$#&|: ".indexOf(text.charAt(i)) < 0)
                    throw new InputFailure(1, "Unsupported TeX control symbol");
                continue;
            }
            String command = text.substring(start, i);
            if (!COMMANDS.contains(command)) throw new InputFailure(1, "Unsupported TeX command");
            if (command.equals("begin") || command.equals("end")) {
                int at = i;
                while (at < text.length() && Character.isWhitespace(text.charAt(at))) at++;
                int end = text.indexOf('}', at);
                if (at >= text.length() || text.charAt(at) != '{' || end < 0 ||
                    !ENVIRONMENTS.contains(text.substring(at + 1, end)))
                    throw new InputFailure(1, "Unsupported TeX environment");
            }
            i--;
        }
        if (depth != 0) throw new InputFailure(2, "Unbalanced formula groups");
    }
    private static void failure(DataOutputStream out, int code, String message) throws Exception {
        byte[] bytes = message.getBytes(StandardCharsets.UTF_8);
        out.writeInt(MAGIC); out.writeInt(0); out.writeInt(code); out.writeInt(bytes.length);
        out.write(bytes); out.flush();
    }
    public static void main(String[] args) throws Exception {
        DataOutputStream out = new DataOutputStream(System.out);
        try {
            DataInputStream in = new DataInputStream(System.in);
            if (in.readInt() != MAGIC) throw new InputFailure(2, "Invalid glyph request header");
            int length = in.readInt(), rgb = in.readInt();
            if (length < 1 || length > MAX_TEXT_BYTES || (rgb & 0xff000000) != 0)
                throw new InputFailure(3, "Invalid glyph request size or color");
            byte[] input = in.readNBytes(length);
            if (input.length != length || in.read() != -1) throw new InputFailure(2, "Invalid glyph request length");
            String latex = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(input)).toString();
            if (latex.length() > 8192) throw new InputFailure(3, "Formula exceeds 8192 UTF-16 units");
            validateMath(latex);
            TeXIcon icon = new TeXFormula(latex).createTeXIcon(TeXConstants.STYLE_DISPLAY, 50f);
            icon.setForeground(new Color(rgb));
            int width = icon.getIconWidth(), height = icon.getIconHeight();
            if (width < 1 || height < 1 || width > 16384 || height > 16384 || (long)width * height > MAX_PIXELS)
                throw new InputFailure(3, "Formula image exceeds raster budget");
            BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
            Graphics2D graphics = image.createGraphics();
            try { icon.paintIcon(null, graphics, 0, 0); } finally { graphics.dispose(); }
            out.writeInt(MAGIC); out.writeInt(width); out.writeInt(height); out.writeInt(width * height * 4);
            int[] row = new int[width]; byte[] rgba = new byte[width * 4];
            for (int y = 0; y < height; y++) {
                image.getRGB(0, y, width, 1, row, 0, width);
                for (int x = 0; x < width; x++) {
                    int alpha = row[x] >>> 24, color = alpha == 0 ? 0 : rgb;
                    rgba[x * 4] = (byte)(color >> 16); rgba[x * 4 + 1] = (byte)(color >> 8);
                    rgba[x * 4 + 2] = (byte)color; rgba[x * 4 + 3] = (byte)alpha;
                }
                out.write(rgba);
            }
            out.flush();
        } catch (InputFailure e) { failure(out, e.code, e.getMessage());
        } catch (org.scilab.forge.jlatexmath.ParseException e) { failure(out, 2, "Invalid mathematical formula"); }
    }
}
