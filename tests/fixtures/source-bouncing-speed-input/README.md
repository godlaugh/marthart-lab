# Bouncing speed input / effective configuration oracle

Captured from the pinned MathArt 1.7.8 package on this Apple Silicon Mac on 2026-10-26. `source.json` records class hashes, output/probe hashes, and the complete local command/dependency/cleanup report. `SpeedConfigProbe.java` is the executed diagnostic source; `native.json` contains all 16 results.

Eight cases invoke the original NumberDragger parser and its actual Float callback wrapper, deliver that Float to a diagnostic `JSONObject.setFloat` sink, serialize/reparse using the original JSONObject implementation, and construct the original JsonBouncingParticlesConfig. Another eight feed numeric values or expressions directly to that constructor. All input JSON remains unchanged after construction. The original configuration clamps speed to 100; the Float callback and JSON can hold 101, 102, or the maximum finite Float32.

This is not an original GUI save or ProjectState execution. A lazy PApplet provides color parsing; it has no renderer or surface. The process ran headless with zero AWT windows. Original ProjectState import accepts literals, whereas direct ConfigUtils import accepts expressions; the product retains its existing direct-render import route. Local inspector author state is initialized from finite pre-clamp results, not claimed to reproduce the full ProjectState import path.

The regression consumes these results through actual product input parsing, document editing, public serialization/reopen, and direct source import. Pixel/simulation checks use the separate real App verifier, not this pure configuration probe.
