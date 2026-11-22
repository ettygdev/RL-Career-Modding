# Y Social v0.1.0

**Historical test preview** for RL Career Hub **0.2.0-beta.31** on Windows x64. For the current launcher and features, see the [RL Career Modding README](../README.md).

This preview adds a pinned sample post at the top of Y. It is displayed in the feed for the session and leaves your save data untouched.

## Using the preview

1. Close the Hub and, if open, the FilstaNet launcher.
2. Extract the archive for the mode you want to test.
3. For standalone mode, run **Y-Autonome.exe**. For a custom Hub path, set `hubExe` in `Y-config.json`.
4. For the FilstaNet test, place **Y-FilstaNet.exe** next to `Y-config.json` and set `hubExe` and `filstaExe`. See the [example configuration](Y-config.example.json).
5. Open Y and look for the pinned sample post. Switch tabs and return to the feed to check that it stays pinned. In FilstaNet mode, the Tier B standings should still be available.

Closing the Hub ends the preview. A full window reload can remove the sample post until the next launch. The launch paths were checked both with and without FilstaNet on the supported Hub version.

[Historical release](https://github.com/ettygdev/RL-Career-Modding/releases/tag/v0.1.0)
