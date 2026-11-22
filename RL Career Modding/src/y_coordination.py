"""Bounded ball-priority experiment for RL Career keeper tactics."""
import json
import math
import os
import tempfile
import time
import unicodedata

# One career bot observes all players. Profile keys isolate games and launches.
_observation = None


def converging(player, ball):
    if player.demolished_timeout > 0:
        return False
    car = player.physics.location
    velocity = player.physics.velocity
    dx, dy, dz = ball.x - car.x, ball.y - car.y, ball.z - car.z
    distance = math.sqrt(dx * dx + dy * dy + dz * dz)
    if not 100 < distance < 1200:
        return False
    toward = (velocity.x * dx + velocity.y * dy + velocity.z * dz) / distance
    return toward > 650 and distance / toward < 0.75


def observe_highlights(packet, owner, active, kickoff, in_air):
    global _observation
    config = _profiles()
    if config is None or not packet.balls:
        return
    players = packet.players
    bots = [index for index, player in enumerate(players) if player.is_bot]
    if not bots or owner != bots[0]:
        return
    humans = [player for player in players if not player.is_bot]
    if len(humans) != 1:
        return
    team = humans[0].team
    actual = sorted(_name(player.name) for player in players if player.is_bot and player.team == team)
    expected = sorted(_name(profile["name"]) for profile in config["teammates"])
    if not actual or actual != expected:
        return

    now = packet.match_info.seconds_elapsed
    key = (config["nonce"], config["fixture"], config["game"])
    if _observation is None or _observation["key"] != key or now < _observation["time"]:
        _observation = {"key": key, "time": now, "players": {}}
        _emit(config, owner, "match-observed")
    memory = _observation["players"]
    ball = packet.balls[0].physics.location
    _observation["time"] = now
    if active and now >= _observation.get("next_sample", 0):
        _observation["next_sample"] = now + 0.15
        simultaneous = sum(converging(player, ball) for player in players if player.team == team) >= 2
        if simultaneous and not _observation.get("converging") and now >= _observation.get("next_convergence", 0):
            _observation["next_convergence"] = now + 3
            _emit(config, owner, "convergence", second=round(now, 2))
        _observation["converging"] = simultaneous
    elif not active:
        _observation["converging"] = False
    for index, player in enumerate(players):
        goals = player.score_info.goals
        saves = player.score_info.saves
        previous = memory.get(index)
        airborne = player.air_state == in_air
        used_jump = player.has_jumped or player.has_double_jumped or player.has_dodged
        current = {"goals": goals, "saves": saves, "used_jump": used_jump,
                   "reset": None, "name": player.name, "airborne": airborne}
        memory[index] = current
        if previous is None or previous["name"] != player.name:
            continue
        reset = previous["reset"]
        touch = player.latest_touch
        if active and airborne and previous["airborne"] and previous["used_jump"] and not used_jump and touch is not None:
            car = player.physics.location
            distance_squared = (car.x - ball.x)**2 + (car.y - ball.y)**2 + (car.z - ball.z)**2
            if car.z > 160 and touch.ball_index == 0 and abs(now - touch.game_seconds) <= 0.15 and distance_squared < 230**2:
                reset = now
                _emit(config, owner, "highlight", action="reset", player=player.name,
                      index=index, count=round(now * 100), second=round(now, 2))
        # Score can update during GoalScored. Keep the candidate until that packet.
        if not kickoff and reset is not None and 0 <= now - reset <= 4:
            current["reset"] = reset if airborne or not active else None
        for action, count in (("goal", goals), ("save", saves)):
            if not kickoff and count == previous[action + "s"] + 1:
                _emit(config, owner, "highlight", action=action, player=player.name,
                      index=index, count=count, second=round(now, 2),
                      overtime=getattr(packet.match_info, "is_overtime", False) is True,
                      reset=current["reset"] is not None)
                if action == "goal":
                    current["reset"] = None


_PATH = os.path.join(tempfile.gettempdir(), "rlcareer-y-coordination.json")
_cache = None
_refresh = 0.0
_last_logged = {}


def form_components(profile, synergy, pressure, elapsed):
    """Trade early nerves and accumulated match load for bounded worse form."""
    recovery = max(0.0, 1.0 - elapsed / 105.0)
    temperament = profile["temperament"]
    familiarity = profile.get("familiarity", 0)
    nerves = pressure * ((0.16 + 0.23 * temperament) * (1 - 0.45 * familiarity) * recovery
                        - 0.10 * (1.0 - temperament) * (1.0 - recovery))
    workload = profile["fatigue"] / 18.0 * 0.27 + min(1.0, elapsed / 360.0) * 0.18
    cohesion = synergy / 30.0 * 0.20
    return nerves, workload, cohesion


_form_rosters = {}


def match_form(packet, owner, baseline):
    config = _profiles()
    if config is None or config.get("mode") == "neutral" or not config.get("performance"):
        return baseline
    players = packet.players
    if owner >= len(players) or not players[owner].is_bot:
        return baseline
    cache = _form_rosters.get(owner)
    if cache is None or cache[0] is not config:
        bot = players[owner]
        humans = [p for p in players if not p.is_bot]
        teammates = sorted(_name(p.name) for p in players if p.team == bot.team and p.is_bot)
        expected = sorted(_name(p["name"]) for p in config["performance"])
        profile = None
        if len(humans) == 1 and humans[0].team == bot.team and teammates == expected:
            profile = next((p for p in config["performance"] if _name(p["name"]) == _name(bot.name)), None)
        _remember(_form_rosters, owner, (config, profile))
    else:
        profile = cache[1]
    if profile is None:
        return baseline
    elapsed = max(0, packet.match_info.seconds_elapsed)
    nerves, workload, cohesion = form_components(profile, config["synergy"], config["pressure"], elapsed)
    adjustment = min(0.55, max(-0.10, nerves + workload + cohesion))
    key = (config["nonce"], config["fixture"], config["game"], owner, int(elapsed // 60))
    if key not in _form_logged:
        _remember(_form_logged, key, True)
        _emit(config, owner, "form", pressure=round(nerves, 3), fatigue=round(workload, 3),
              synergy=round(cohesion, 3), adjustment=round(-adjustment, 3))
    return min(1.0, max(-1.0, baseline - adjustment))


_form_logged = {}

def _profiles():
    global _cache, _refresh
    token = os.environ.get("RLC_Y_LAUNCH_TOKEN")
    if not token or os.environ.get("RLC_Y_COORDINATION") == "off":
        return None
    tick = time.monotonic()
    if tick >= _refresh:
        _refresh = tick + 0.5
        try:
            with open(_PATH, encoding="utf-8") as stream:
                data = json.load(stream)
            _cache = data if isinstance(data, dict) else None
        except (OSError, ValueError):
            _cache = None
    if not _cache or _cache.get("active") is not True or _cache.get("nonce") != token:
        return None
    expires = _cache.get("expires")
    if not isinstance(expires, (int, float)) or time.time() * 1000 >= expires:
        return None
    return _cache


def _name(value):
    return unicodedata.normalize("NFKC", str(value)).strip().casefold()


def _candidates(team, distance, neutral, owner, config):
    if not config or not isinstance(config.get("teammates"), list):
        return "no-profile", neutral
    humans = [(index, player) for index, player in team if not player.is_bot]
    bots = [(index, player) for index, player in team if player.is_bot]
    if len(humans) != 1:
        return "not-one-human", neutral

    profiles = config["teammates"]
    if not all(isinstance(item, dict) for item in profiles):
        return "invalid-profile", neutral
    indexed = {_name(item.get("name", "")): item.get("trust") for item in profiles}
    names = {_name(player.name) for _, player in bots}
    if names != set(indexed) or len(indexed) != len(bots) or len(indexed) != len(profiles):
        return "lineup-mismatch", neutral
    if neutral != humans[0][0]:
        return "matched", neutral

    human = humans[0][1]
    if human.demolished_timeout > 0:
        return 'matched', neutral
    human_distance = distance(human)
    options = []
    for index, player in bots:
        trust = indexed[_name(player.name)]
        if not isinstance(trust, (float, int)) or not 0 <= trust < 40 or player.demolished_timeout > 0:
            continue
        gap = distance(player) - human_distance
        tolerance = min(420.0, (40 - trust) * 12.0)
        if 0 <= gap <= tolerance:
            options.append((gap, index))

    # The same packet chooses at most one challenger; other bots retain the baseline.
    selected = min(options)[1] if options else None
    return "matched", selected if owner == selected else neutral


def select_fallback(team, distance, neutral, owner, config):
    """May replace nearest human with this bot only on a near tie."""
    return _candidates(team, distance, neutral, owner, config)[1]


_coverage_logged = {}


def _remember(store, key, value):
    store[key] = value
    if len(store) > 32:
        del store[next(iter(store))]


def _emit(config, owner, event, **fields):
    try:
        record = {
            "nonce": config.get("nonce"), "fixture": config.get("fixture"), "game": config.get("game"),
            "bot": owner, "mode": config.get("mode", "active"), "event": event, **fields
        }
        with open(os.path.join(tempfile.gettempdir(), "rlcareer-y-coordination.log"),
                  "a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n")
    except OSError:
        pass


def choose_free(team, distance, neutral, owner):
    config = _profiles()
    if config is None:
        return neutral
    status, candidate = _candidates(team, distance, neutral, owner, config)
    key = (config.get("nonce"), config.get("fixture"), config.get("game"), owner)
    if _coverage_logged.get(key) != status and _coverage_logged.get(key) != "matched":
        _remember(_coverage_logged, key, status)
        _emit(config, owner, "coverage", status=status)
    active = config.get("mode") != "neutral"
    if candidate != neutral:
        now = time.monotonic()
        if now - _last_logged.get(key, -10) >= 3:
            _remember(_last_logged, key, now)
            _emit(config, owner, "opportunity", override=active, neutral=neutral)
    return candidate if active else neutral
