# RLCareer Overhaul

RLCareer Overhaul is Ettyg99’s Windows mod for **RL Career Hub**. Manage club staff and player development, outfit your team, and play or watch career series with a broadcast presentation and updated bot gameplay.

[Download v0.10.2](https://github.com/ettygdev/RLCareer-Overhaul/releases/tag/v0.10.2) · [Full changelog](docs/releases/v0.10.2.md) · [Hub tour and full BO7](https://youtu.be/x7Wgc_EX07s) · [Source and build guide](Overhaul/) · [MIT License](LICENSE)

## Install and launch

1. Complete the Rocket League, BakkesMod and RLBot setup in RL Career Hub.
2. Close the Hub and download **RLCareer-Overhaul.exe** from Releases.
3. Place it beside **RL Career Hub.exe** and replace any older copy with the same name. Launch **RLCareer-Overhaul.exe**. The executable includes the match integration.
4. Check for **Overhaul v0.10.2** in the Hub. Restart Rocket League if it was already running when you updated the mod.

The launcher supports **Windows x64** and Hub **0.2.0-beta.33** and **0.2.0-beta.34**. The beta.34 startup and Quick Chat hook installation were verified locally. Career and match behavior on beta.34 still needs in-game validation. The launcher can detect FilstaNet Modifier beside the Hub and show its installed version in a shared badge. Modifier **0.11.5** is a previously validated compatibility target.

Existing careers receive the new player data when loaded. The launcher keeps a fixed filename, so shortcuts that point to it can be reused. Epic players using a non-Steam shortcut can configure the Steam Input proxy in **Settings → RLCareer Overhaul**.

## Club management

| Feature | What you can do |
| --- | --- |
| Player ratings | See Overall, Composure, Attack, Defense, Mechanics, Passing, Bumps, Game Sense, Ball Control and Communication. Overall is calculated from the eight attributes. |
| Scouting | Hire and manage up to three scouts independently of transfer windows. Assign reports to reveal external ratings. Scout ability affects precision, turnaround and potential assessment. |
| Coaching | Search and sign coaches during transfer windows. Coaches influence training and Composure and can propose timeouts. Coach profiles can have a bio, followers and posts in the Hub’s social world. |
| Training | Open a player’s training card and choose up to three technical exercises per week. Each targets a specific attribute and uses the Hub’s progression curve. Mental training develops Composure separately. |
| Equipment | Spend club funds on controllers, monitors, PCs, headsets and peripherals per player. Browse brands and compare models by rating. Equipment quality can affect player performance. |
| Facilities | Evaluate the facility’s Wi-Fi reliability and choose a paid monthly connection plan. Connection reliability affects the risk of incidents in online matches. |
| World Editor | Create players with individual attributes and Composure, and add custom coaches. |

## Inventory and titles

Buy game cosmetics with club funds, browse owned items, and equip compatible painted variants. Set custom car colors and enable them per preset through the included BakkesMod integration. Select an owned player title or use titles awarded through career results. The catalogue covers future RLCS seasons and repeat World Champions. Item previews use cached thumbnails when available.

## Playing and watching matches

- **Broadcast presentation.** A compact scoreboard for played matches. The spectator layout adds team crests, event and stage details, series wins, overtime, player boosts, event pictograms and a tracked-player stats panel. Pro camera settings apply where a profile is available.
- **Intermissions.** See the score, overtime duration, MVP and player stats after a game, including the series finale. The intermission includes music and a countdown, and can cover loading between games.
- **Match officials.** Request a tactical timeout in eligible series. Coaches can propose one for your confirmation, and opponents can call their own. Online technical pauses can lead to a resumption, a kickoff or a restart. Timeouts and technical pauses have their own presentation.
- **Team Quick Chat.** Configure preset messages on the D-pad, disable individual categories or turn the feature off. Bots can respond to team calls and announce plays, including kickoffs, challenges, rotations, defensive coverage and bumps.
- **Bot play.** Career bots retain their native policies and use additional logic for kickoff roles, first touches, carries, ground and wall setups, passes, redirects, double taps, flip resets, ceiling plays and recoveries. Performance varies with player attributes, Composure, pressure, fatigue and equipment. Mechanical execution and frequency vary by situation.
- **Simulated fixtures.** Career simulation accounts for player attributes and club effects, including staff, equipment and facilities where applicable.
- **Replays.** The match integration can capture the native save request for export at match end. F9 remains available as a fallback. Native export can depend on the Rocket League build.

## Settings, updates and support

Settings has a dedicated Overhaul section. The Hub’s main menu includes an expandable changelog. The launcher checks GitHub for updates and can install a newer release when you approve it. Restart the Hub from its own executable to use the base UI. Run Overhaul with `--restore-bot-hooks` to restore the native RLBot hooks as well.

For a bug report, include the Hub, Overhaul and Modifier versions, and whether the match was played or spectated. A replay or screenshot helps identify the issue.

## Source, credit and maintenance

The [Overhaul source](Overhaul/) includes the launcher, Hub integration, overlay plugin, bot logic, build scripts and tests. The release tag identifies the source snapshot. Experimental PPO training and its checkpoints are outside the released career mod.

**Ettyg99** maintains RLCareer Overhaul. Updates will continue to include fixes, balance changes and new features as they are ready. You can use, edit and republish the original source under the [MIT License](LICENSE), provided you retain Ettyg99’s copyright credit and the license notice. Third-party components and media retain their own terms. See the [third-party notices](Overhaul/THIRD-PARTY.md).
