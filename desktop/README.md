# MathArt Lab desktop

From `studio/`:

```sh
npm ci
node node_modules/electron/install.js
npm run desktop:dev
npm run desktop:build
npm run desktop:smoke
```

The build creates `dist-desktop/MathArt Lab-darwin-arm64/MathArt Lab.app` on an Apple Silicon Mac. Open that app directly; it includes the built interface and local export service. Build output is ignored by Git. The package is for local use; distribution signing and notarization are not configured.

For a separate local workspace, launch the executable with `--mathart-user-data=/absolute/path/to/workspace`. This also isolates downloads and preferences and does not run the smoke test.

The interface and API use random ports on `127.0.0.1`. Workspace snapshots, exports, and downloads live in `~/Library/Application Support/MathArt Lab/`. Workspace snapshots have a backup and survive changing ports. Closing the app stops both servers and its active encoders. Web development still uses the existing `npm run dev` and `npm run server` commands.

Video exports use an existing FFmpeg executable from `PATH`, `/opt/homebrew/bin`, or `/usr/local/bin`. Set `MATHART_FFMPEG` to an absolute executable path when needed. The desktop build does not install or bundle FFmpeg. Image export works without it.

For a packaged runtime check:

```sh
npm run desktop:smoke -- --packaged="dist-desktop/MathArt Lab-darwin-arm64/MathArt Lab.app/Contents/MacOS/MathArt Lab"
```

Smoke checks run a hidden application with a separate workspace under `studio/.cache/`, verify rendering and image persistence, restart across random ports, and confirm both ports and active encoders close. Reports and screenshots remain beside the test workspace.
