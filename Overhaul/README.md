# Build RLCareer Overhaul

This directory contains the source shipped for the v0.10.2 release. The regular download is a single Windows x64 executable.

## Build on Windows

1. Install a Node.js x64 build supporting `--build-sea`, Python, and the MSVC x64 toolchain.
2. Obtain the BakkesMod SDK for the plugin. From an MSVC x64 developer prompt, run `build-camera.cmd "<path to BakkesMod SDK>"` in this directory. It builds `bin/rlcareercameras.dll`.
3. Run `node build.cjs`. The launcher is written to `bin/RLCareer-Overhaul.exe`. Run `node test.cjs` for launcher and integration tests.
4. Use the Hub Python runtime with its RLBot resources on `PYTHONPATH` for `test-bot-style.py` and `test-advanced-moves.py`. The other Node test scripts cover coaches, recruitment, training and match officials.

The build can use local WAV files named `assets/rl-music-background.wav` and `assets/timeout-background.wav`. Optional coach portraits are located using `assets/coach-portraits/sources.json`. Add copies you are entitled to use. The public source tree includes the application code and builds without these optional media files.

## Local integration

The launcher uses the Hub’s bundled Python to install the RLBot hooks when started. The Hub supplies the agents and model weights. The launcher installs the embedded BakkesMod plugin during match preparation. The Hub and optional Modifier remain separate installations.

To restore the supported Hub’s original RLBot hooks, close the Hub and run `RLCareer-Overhaul.exe --restore-bot-hooks` from its installation folder. The installer checks its supported hook patterns and skips incompatible files. To run the unmodded Hub, start **RL Career Hub.exe** directly. The integrated plugin stays inactive outside a Career Overhaul session.
