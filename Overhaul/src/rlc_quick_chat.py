"""Opt-in quick-chat tactics for the local human's team."""
import math
import os
from pathlib import Path
import time

from rlbot.flat import MatchPhase

_launch = os.environ.get("RLC_INVENTORY_LAUNCH_TOKEN")
_tactics = os.environ.get("RLCAREER_TACTICS")
_dir = Path(_tactics).parent if _launch and _tactics else None
_cached_at = float("-inf")
_settings = None


def _refresh():
    global _cached_at, _settings
    now = time.monotonic()
    if _dir is None or now - _cached_at < 0.08:
        return _settings
    _cached_at = now
    _settings = None
    try:
        token, enabled, calls, expires = (_dir / "inventory-quick-chat.tsv").read_text(encoding="utf-8").splitlines()[0].split()
        match = (_dir / "inventory-cameras.tsv").read_text(encoding="utf-8").splitlines()[0].split()
        if token == _launch and enabled == "1" and int(expires) >= time.time() * 1000 and match[0].startswith(token + "-") and match[2] == "5":
            command = None
            try:
                target, deadline, group, action = (_dir / "inventory-quick-command.txt").read_text(encoding="utf-8").split()
                if target == match[0] and int(deadline) >= time.time() * 1000:
                    command = (group, action)
            except (OSError, ValueError):
                pass
            _settings = (calls == "1", command, match[0])
    except (OSError, ValueError, IndexError):
        pass
    return _settings


def _announce(match, name, message):
    file = _dir / "inventory-quick-bot.txt"
    lock = _dir / "inventory-quick-bot.lock"
    try:
        if file.exists() and time.time() - file.stat().st_mtime < 6:
            return False
        lock_handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except OSError:
        return
    try:
        now = int(time.time() * 1000)
        if file.exists() and now / 1000 - file.stat().st_mtime < 6:
            return False
        temporary = file.with_suffix("." + str(os.getpid()) + ".tmp")
        clean = " ".join(str(name).split())[:48]
        temporary.write_text(f"{match} {now}\n{clean}\n{message}\n", encoding="utf-8")
        os.replace(temporary, file)
        return True
    except OSError:
        pass
    finally:
        os.close(lock_handle)
        try:
            lock.unlink()
        except OSError:
            pass


def _distance(pos, x, y):
    return math.hypot(pos.x - x, pos.y - y)



def _approach(car, target_x, target_y):
    pos, vel = car.location, car.velocity
    dx, dy = target_x - pos.x, target_y - pos.y
    distance = max(math.hypot(dx, dy), 1.0)
    yaw = car.rotation.yaw
    alignment = (math.cos(yaw) * dx + math.sin(yaw) * dy) / distance
    closing_speed = (vel.x * dx + vel.y * dy) / distance
    return distance, alignment, closing_speed



def _project(physics, seconds):
    pos, vel = physics.location, physics.velocity
    return pos.x + vel.x * seconds, pos.y + vel.y * seconds


def _bump_run(physics, opponents, ball_target):
    _, ball_heading, ball_speed = _approach(physics, *ball_target)
    for opponent in opponents:
        if opponent.physics.location.z > 175:
            continue
        target = _project(opponent.physics, 0.22)
        distance, heading, closing = _approach(physics, *target)
        if (distance < 1300 and heading > 0.88 and closing > 580
                and math.hypot(target[0] - ball_target[0], target[1] - ball_target[1]) > 510
                and (heading > ball_heading + 0.13 or closing > ball_speed + 330)):
            return True
    return False


def _opponent_contests(opponents, ball_target, seconds):
    for opponent in opponents:
        distance, alignment, closing = _approach(opponent.physics, *ball_target)
        touch = opponent.latest_touch
        if distance < 980 and (
            distance < 310 or (alignment > 0.6 and closing > 280)
            or (touch is not None and 0 <= seconds - touch.game_seconds < 0.75)
        ):
            return True
    return False


def _bump_assignment(bots, opponents):
    choices = []
    for index, player in bots:
        if player.boost < 20 or player.physics.location.z >= 175:
            continue
        for opponent in opponents:
            pos = opponent.physics.location
            if pos.y <= -800 or pos.z >= 175:
                continue
            target = _project(opponent.physics, 0.25)
            target = (max(-3850, min(3850, target[0])), max(-4900, min(4900, target[1])))
            distance, heading, _ = _approach(player.physics, *target)
            if distance < 2100:
                choices.append((distance + 380 * (1 - heading), index, target))
    return min(choices) if choices else None

def _read_play(bot, packet, me, human, nearest, danger):
    physics = me.physics
    pos, vel = physics.location, physics.velocity
    ball = packet.balls[0].physics
    b, bv = ball.location, ball.velocity
    touch = me.latest_touch
    if touch is not None and 0 <= packet.match_info.seconds_elapsed - touch.game_seconds < 0.65:
        # A pass requires our recent touch and a plausible receiver along the
        # outgoing ball path. A clear or a shot towards goal isn't a pass.
        opponent_touch = any(p.team != me.team and p.latest_touch is not None
                             and p.latest_touch.game_seconds >= touch.game_seconds for p in packet.players)
        target_x, target_y = b.x + 0.65 * bv.x, b.y + 0.65 * bv.y
        toward_goal = bv.y > 900 and abs(b.x + (5120 - b.y) * bv.x / bv.y) < 1000
        if not opponent_touch and not toward_goal and math.hypot(bv.x, bv.y) > 650 and b.z < 410:
            for index, player in enumerate(packet.players):
                if index == bot.index or player.team != me.team or player.demolished_timeout > 0:
                    continue
                receiver = player.physics.location
                if (_distance(receiver, target_x, target_y) < 1000
                        and _distance(receiver, b.x, b.y) > 575):
                    if abs(b.x) > 1250 and abs(target_x) < abs(b.x) - 600 and abs(target_x) < 1600:
                        return "Passing mid!"
                    return "Passing!"
    ball_target = _project(ball, 0.23)
    distance, alignment, closing = _approach(physics, *ball_target)
    human_dist, human_heading, human_closing = _approach(human.physics, *ball_target)
    opponents = [p for p in packet.players if p.team != me.team and p.demolished_timeout <= 0]
    if danger and pos.y < b.y + 300 and pos.y < -2200 and (closing > 325 or vel.y < -450):
        return "Defending!"
    if _bump_run(physics, opponents, ball_target):
        return "Bumping!"
    if (bot.index == nearest and distance < 1150 and alignment > 0.76 and closing > 420
            and human_dist > distance + 230 and b.z < 330):
        return ("Challenging!" if _opponent_contests(opponents, ball_target, packet.match_info.seconds_elapsed)
                else "I got it!")
    if vel.y < -580 and (alignment < 0.35 or closing < 140) and distance > 550:
        if bot.index == nearest and human_dist < 1200 and human_heading > 0.65 and human_closing > 370:
            return "Go for it!"
        return "Rotating!"
    return ""

def quick_role(bot, packet, me):
    """Return (handled, controls). None controls lets the underlying bot take the ball."""
    settings = _refresh()
    phase = packet.match_info.match_phase
    if settings is None or phase not in (MatchPhase.Active, MatchPhase.Kickoff) or bot.team != 0:
        return False, None
    allies = [(i, p) for i, p in enumerate(packet.players) if p.team == bot.team and p.demolished_timeout <= 0]
    humans = [(i, p) for i, p in allies if not p.is_bot]
    bots = [(i, p) for i, p in allies if p.is_bot]
    if len(humans) != 1 or not bots:
        return False, None
    calls, selection, match = settings
    ball = packet.balls[0].physics
    b = ball.location
    look = (b.x, b.y)
    position = me.physics.location
    nearest, _ = min(bots, key=lambda entry: (_distance(entry[1].physics.location, *look), entry[0]))
    group = "1" if phase == MatchPhase.Kickoff else "0"

    if getattr(bot, "quick_call_match", None) != match:
        bot.quick_call_match = match
        bot.quick_candidate = ("", 0.0)
        bot.quick_call_history = {}

    def say(text, sustained=False):
        if not calls:
            return
        now = time.monotonic()
        previous, since = bot.quick_candidate
        if sustained and previous != text:
            bot.quick_candidate = (text, now)
            return
        from rlc_bot_style import _profiles, _name
        profile = _profiles()
        entry = (profile[1].get(_name(me.name)) if profile else None) or {}
        communication = entry.get("communication", 70)
        min_duration = 0.10 if text.startswith("Passing") else 0.28
        if text and (not sustained or now - since >= min_duration * (1.7 - communication / 100)):
            if now - bot.quick_call_history.get(text, float("-inf")) >= 21 - communication / 10 and _announce(match, me.name, text):
                bot.quick_call_history[text] = now

    own = -5120
    side_x = -950 if position.x < 0 else 950
    support_y = max(-3500, min(2650, b.y - 1100))
    danger = phase == MatchPhase.Active and (bot.shot_coming(ball) or b.y < -4200)

    if not selection or (group == "1" and selection[0] != "1") or (group == "0" and selection[0] == "1"):
        if calls and phase == MatchPhase.Kickoff:
            from rlc_bot_style import BotStyle
            taker = BotStyle.kickoff_taker(packet, me.team)
            if taker == bot.index:
                say("I got kickoff!")
            elif taker is not None and abs(BotStyle.support_spawn(packet, bot.index, taker)[1]) == 1280:
                say("Following kickoff!")
        if calls and phase == MatchPhase.Active:
            say(_read_play(bot, packet, me, humans[0][1], nearest, danger), sustained=True)
        return False, None

    bot.quick_candidate = ("", 0.0)
    _, action = selection
    if action == "attack" and danger:
        return False, None
    if phase == MatchPhase.Active and action in ("defend", "rotate"):
        defender, _ = min(bots, key=lambda entry: (_distance(entry[1].physics.location, 0, -3850), entry[0]))
        if bot.index == defender:
            say("Defending!" if action == "defend" else "Rotating!")
            return True, bot.drive_to(me, (0, -3850), look)
        return False, None
    if phase == MatchPhase.Active and action in ("pass", "pass-mid"):
        if danger or bot.index != nearest or b.z > 160:
            return False, None
        human = humans[0][1].physics
        target = (0 if action == "pass-mid" else human.location.x + .35 * human.velocity.x,
                  human.location.y + .35 * human.velocity.y)
        if _distance(b, *target) < 450 or target[1] < b.y - 300:
            return False, None
        distance, alignment, closing = _approach(me.physics, *look)
        if distance < 850 and alignment > .65 and closing > 200:
            say("Passing mid!" if action == "pass-mid" else "Passing!")
        return True, bot.drive_to(me, look, target, park=False)
    if action in ("go", "attack") and bot.index == nearest:
        distance, alignment, closing = _approach(me.physics, *look)
        if phase == MatchPhase.Active and not danger and 650 < distance < 2200 and b.z < 320:
            if alignment > 0.6 and closing > 280:
                say("I got it!")
            return True, bot.drive_to(me, look, look, park=False)
        if alignment > 0.72 and closing > 350 and distance < 900 and b.z < 330:
            say("I got it!")
        return True, None
    if danger:
        return False, None
    if action in ("got", "leave", "go"):
        if action != "go" and bot.index == nearest:
            say("Leaving it!")
        target_y = -2800 if phase == MatchPhase.Kickoff else support_y
        return True, bot.drive_to(me, (side_x, target_y), look)
    if action in ("center", "receive") and phase == MatchPhase.Active:
        receive_y = max(-2300, min(4050, b.y + 550))
        receiver, _ = min(bots, key=lambda entry: (_distance(entry[1].physics.location, 0, receive_y), entry[0]))
        if bot.index == receiver:
            say("In the middle!")
            return True, bot.drive_to(me, (0, receive_y), look)
        return True, bot.drive_to(me, (side_x, support_y), look)
    if action == "demo" and phase == MatchPhase.Active:
        opponents = [p for p in packet.players if p.team != bot.team and p.demolished_timeout <= 0]
        assignment = _bump_assignment(bots, opponents)
        if assignment is not None and assignment[1] == bot.index:
            target = assignment[2]
            distance, alignment, _ = _approach(me.physics, *target)
            controls = bot.drive_to(me, target, target, park=False)
            if alignment > 0.7:
                controls.boost = distance > 240
                say("Bumping!")
            return True, controls
    if phase == MatchPhase.Kickoff and action in ("hold", "follow", "boost"):
        if bot.index == nearest:
            return False, None
        if action == "boost":
            pad = bot.boost_run(packet, me, side_x)
            if pad is not None:
                return True, bot.drive_to(me, pad, look, park=False)
        target_y = own * (0.41 if action == "follow" else 0.72)
        return True, bot.drive_to(me, (side_x, target_y), look)
    return False, None
