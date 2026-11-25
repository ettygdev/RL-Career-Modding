# RLCareer Overhaul

RLCareer Overhaul is Ettyg99’s Windows mod for **RL Career Hub**. It expands club management, changes how career bots play and adds a broadcast-style presentation for played and spectated series.

[Download v0.9.14](https://github.com/ettygdev/RL-Career-Modding/releases/tag/v0.9.14) · [Watch the Hub tour and full BO7](https://youtu.be/x7Wgc_EX07s) · [What changed since v0.3.12](docs/releases/v0.9.14.md) · [Source code](Overhaul/) · [License](LICENSE)

## Install and launch

1. Install RL Career Hub and complete its Rocket League, BakkesMod and RLBot setup.
2. Download **RLCareer-Overhaul.exe** from Releases. It is the single installer-free download and includes the match integration.
3. Place the file beside **RL Career Hub.exe**, then start your career through **RLCareer-Overhaul.exe**. The launcher installs the required local RLBot hooks and loads the included BakkesMod plugin when a career match is prepared.
4. Check for **Overhaul v0.9.14** in the Hub. Restart Rocket League if it was already running and the overlays do not appear.

This release targets **Windows x64** and **RL Career Hub 0.2.0-beta.33**. It can start the Hub on its own or alongside **FilstaNet Modifier 0.11.4**, when the Modifier is installed beside the Hub. The Hub, Rocket League and the optional Modifier are separate products. Existing careers receive the new career data when loaded.

If you used the previous Career+ launcher, switch to the new executable. For an Epic installation using the optional Steam Input proxy, edit the existing non-Steam entry's target to point to the new executable and keep `--steam-input-proxy` in its launch options. In **Setup → Steam Input**, import the entry’s Steam shortcut if it needs to be linked again.

## Club management

- **Player profiles and scouting.** Player cards show Overall, Composure and eight attributes covering attack, defense, mechanics, passing, bumps, game sense, ball control and communication. Scout players outside your club to reveal their ratings. You can hire and manage up to three scouts. Scout quality affects report precision and turnaround, and older reports can be refreshed.
- **Coaches and mental training.** Search for and sign coaches during transfer windows. Coaches can affect training and composure and recommend tactical timeouts. Mental training improves composure gradually. Composure helps players manage pressure in important matches.
- **Equipment and facilities.** Buy and equip individual setups using the club budget. PCs, monitors, controllers, headsets and peripherals affect player performance in the simulation. Facilities have Wi-Fi reliability and optional monthly subscriptions that affect the risk of technical issues in online events.
- **World Editor.** Set player attributes and composure when creating players, and create custom coaches. Overall is calculated from the eight attributes.
- **Garage and inventory.** Buy and equip cosmetics, browse owned items, switch titles and optionally apply custom car colors through BakkesMod. The club budget pays for purchases.

## On the field

- **Bot mechanics and coordination.** Bots can take assigned kickoff roles, cover teammates, rotate out of crowded plays and recover onto the floor, walls or ceiling. Depending on the situation they may attempt air dribbles, flicks, flip resets, double taps, pinches, aerial passes and other mechanics. Ratings affect control precision. Fatigue, pressure, composure and equipment can influence performance.
- **Optional Team Quick Chat.** Configure preset team and kickoff messages in the Hub. Bots can react to calls such as *I got it*, *Go for it* and *Center*, and send their own play calls. The feature can be switched off in the Hub.
- **Broadcast presentation.** Watch with a spectator HUD featuring team logos, score, overtime and series status, live boost, player statistics and event indicators. Pro camera settings are used where available. Played matches use a compact scoreboard. Between games, the post-match screen shows the stats, series progress and a countdown with music.
- **Match officials and timeouts.** Eligible series support tactical timeouts requested by the player or proposed by a coach. Online events can have referee-managed technical pauses tied to facility connection reliability.

Mechanical attempts vary by match situation, and bot execution is still being tuned. If you find an issue, include your Hub and Modifier versions and say whether you were playing or spectating. A replay, screenshot or showcase timestamp helps.

## Source and maintenance

The [Overhaul source folder](Overhaul/) includes the launcher, Hub integration, overlay plugin, bot logic and build and test scripts. See the [build guide](Overhaul/README.md). The version history keeps the earlier Y Social work available for reference. The current release focuses on career management, match presentation and bots.

This mod is actively maintained by **Ettyg99**. Fixes, balancing changes and new features will continue to arrive.

## License

Original RLCareer Overhaul source code is available under the [MIT License](LICENSE). You can use, edit, fork and republish it, including modified versions, provided you retain the copyright credit to **Ettyg99** and the license notice in copies or substantial portions. Third-party software and media retain their own terms. See [Third-party notices](Overhaul/THIRD-PARTY.md).
