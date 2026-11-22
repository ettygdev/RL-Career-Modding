<div align="center">

# RL Career Modding

**A more personal Rocket League career, starting with Y.**

Write to teammates, follow the conversation after a big series, and see how relationships can carry over into your next match.

[**Download for Windows**](https://github.com/ettygdev/RL-Career-Modding/releases/tag/v0.3.12) · [Features](#features) · [Installation](#installation) · [Troubleshooting](#troubleshooting)

**v0.3.12** · **Windows x64** · **RL Career Hub 0.2.0-beta.33**

</div>

## Features

### A more interactive Y feed

- **Open profiles from mentions.** Select a recognized `@handle` in a post to jump directly to that account.
- **Repost and undo a repost.** Shared posts appear in the **Reposts** tab on your profile. A check mark shows what you have already shared, and your repost does not add a second copy of the original to the same feed.
- **Read and join comment threads.** Open a post’s comments, add your own, reply to someone, or follow one more reply within that branch. Collapse the thread or hide individual branches when you are done. Comments keep actions like likes, reposts and view counts close at hand.
- **Get responses from the career world.** Some posts attract relevant comments from familiar faces, such as teammates or followers, and occasionally from players outside that circle. An author can respond directly to your comment or react after a repost. Whether someone responds depends in part on their personality and how well known you are.
- **Give your own posts more reach.** Original posts have higher engagement targets and can pick up views, likes, reposts and replies sooner. Mentioned players can answer, with familiar teammates generally more responsive than big names outside your circle.
- **Copy a post.** Use the copy action to grab its text without selecting the whole card.

### Direct messages that affect relationships

- **Start a conversation from a player’s profile.** Write your own message or revisit existing conversations from the in-game **Chat** list, where each conversation has a preview and date.
- **Use a tone preset when you want a starting point.** Choose **Plain**, **Respect**, **Thanks**, **Joke**, **Hype**, **Cocky**, **Callout** or **Apology**. The preset puts an editable draft in the composer, so you can change it before sending.
- **Get replies that fit the conversation.** A teammate responds, but their morale can make the reply warm or curt. Other players may answer briefly or leave you on read, depending on their personality, fame and relationship with you. A greeting, a compliment and a complaint about a loss can draw different replies.
- **See trust and morale change immediately.** The meters stay visible at the top of the conversation as you scroll. Support, apologies and hostility can affect trust and, for teammates, morale. When a message has an effect, the chat shows the change beneath it. Repeating the same kind of message can run into a daily limit.
- **Take a private rivalry public.** If you repeatedly antagonize a player, they may call out the behavior in a public Y post. The post can mention you while keeping your actual messages private.

### Series recaps and match highlights

- **Follow the story of a series.** Your club can post the score and call out a comeback, upset, sweep, decider, overtime or standout performance. A follower may comment on a memorable result.
- **See individual plays mentioned by name.** With the optional **Match Add-on**, recaps can include goals, saves and probable flip resets. The post can name the player and game, and it can link a probable reset to a goal scored shortly afterward by the same player.
- **Read the recap even when detailed match data is unavailable.** Y can still use the result and the stats recorded by the Hub.

### Match Add-on · Optional

| Factor | What you can notice in a played career match |
| --- | --- |
| **Trust and team coordination** | Very low trust can make an affected teammate more willing to challenge when you and the bot are similarly placed for the ball. It can also drag down the trio’s form. |
| **Pressure** | High-stakes matches and deciders can weigh more heavily at the start. Some players settle faster than others, especially after playing together for a while. |
| **Fatigue** | Repeated games and overtime add to the workload. Fatigue can build during play and eases with rest between career days. |
| **Post-series feedback** | The Y recap can show when the mod changed challenge priority, how often teammates approached the ball together and which factors affected form. An approach is an observation, and players can still back out before a double commit. |

## Compatibility

| Setup | What loads |
| --- | --- |
| **RL Career Hub 0.2.0-beta.33 without the Modifier** | RL Career Modding launches the Hub and enables Y. The Match Add-on is available separately. |
| **FilstaNet Modifier installed beside the Hub** | The same launcher opens the Modifier automatically. The RL Career Modding badge still appears, while the Y changes and their match effects are switched off for that session. Tested with Modifier **0.7.0**. |

The **RL Career Modding** badge sits below the existing badges at the top right of the Hub before a career is loaded. It hides once you enter a career.

## Installation

### Install the launcher

1. Close the Hub and the Modifier if either is open.
2. [Download the Windows x64 ZIP](https://github.com/ettygdev/RL-Career-Modding/releases/download/v0.3.12/RL-Career-Modding-v0.3.12-win-x64.zip) and extract it.
3. Copy **RL-Career-Modding.exe** into the folder containing **RL Career Hub.exe**. The default location is `%LOCALAPPDATA%\Programs\RL Career Hub`.
4. Start **RL-Career-Modding.exe**. Look for the badge in the Hub.

The [standalone EXE](https://github.com/ettygdev/RL-Career-Modding/releases/download/v0.3.12/RL-Career-Modding.exe) is enough for the launcher and core Y features. Keep the extracted ZIP folder if you want to install the Match Add-on.

### Install the optional Match Add-on

Close the Hub and Rocket League. Open PowerShell **inside the extracted ZIP folder** and run the following. If your Hub is installed elsewhere, set `$hub` to that folder.

```powershell
$hub = Join-Path $env:LOCALAPPDATA 'Programs\RL Career Hub'
& (Join-Path $hub 'resources\python\python.exe') .\install-coordination.py $hub
```

Keep the `backup` folder created by the installer. Start the career again through **RL-Career-Modding.exe**. If you want to compare matches with the match effects turned off, start the launcher with `--neutral` in standalone mode.

## Updates and removal

- **Update the launcher.** Close the Hub and replace the EXE with the one from the latest release. If you used a previous launcher named `Y-Social.exe`, start using `RL-Career-Modding.exe`.
- **Update the Match Add-on.** If you installed it from a previous version, restore it using that version’s installer and backup first, then install the new version.
- **Remove the Match Add-on.** Close the Hub and Rocket League. From the folder containing the installer and its `backup` directory, run the same PowerShell commands with `--restore` added to the second line.
- **Play without RL Career Modding.** Open the Hub or the Modifier directly. To remove the launcher, delete `RL-Career-Modding.exe` from the Hub folder. Existing messages and posts written to your career save stay there.

## Troubleshooting

| If you see this | Try this |
| --- | --- |
| The launcher cannot find the Hub | Move `RL-Career-Modding.exe` next to `RL Career Hub.exe`. |
| The badge is visible, but the new Y features are missing | Check for the FilstaNet badge. RL Career Modding disables its Y changes when the Modifier is loaded. |
| The badge disappears when a career loads | This is expected. The badge is shown in the Hub before loading a career. |
| A recap shows the result without individual plays | Install the optional Match Add-on and play another series in standalone mode. Detailed highlights only appear when the relevant match data is available. |
| The add-on installer reports an unexpected Hub file | Check the supported Hub version. If an older add-on is installed, restore it with its original backup and installer before trying again. |

For launch errors, check `%TEMP%\RL-Career-Modding.log`. If you [report an issue](https://github.com/ettygdev/RL-Career-Modding/issues), include your Hub version, whether FilstaNet was loaded, and what you did immediately before the problem.

## Credits

Maintained by [ettygdev](https://github.com/ettygdev). The Modifier is a separate project by **FilstaNet**. Thanks to the creators of RL Career Hub and Rocket League.

[Source code](https://github.com/ettygdev/RL-Career-Modding/tree/main/RL%20Career%20Modding) · [Release history](https://github.com/ettygdev/RL-Career-Modding/releases)
