"""Small, opt-in adjustments to native career bots, after their tactics."""
import json
import math
import os
from pathlib import Path
import time
import unicodedata

from rlbot.flat import AirState, ControllerState, MatchPhase
from rlc_advanced_moves import AdvancedMoves, add, air_controls, ball_path, basis, clip, dot, scale, sub, unit, vector

_PROFILES = {
    # Confirmed public name only. Tunable interpretations, not learned profiles.
    "zen": (320, 32, 7, 3, 1150),
    "atow": (355, 34, 8, 3, 1075),
    "stizzy": (370, 38, 9, 3, 1000),
    "vatira": (370, 36, 8, 3, 1040),
}
_token = os.environ.get("RLC_INVENTORY_LAUNCH_TOKEN")
_tactics = os.environ.get("RLCAREER_TACTICS")
_directory = Path(_tactics).parent if _tactics and _token and os.environ.get("RLC_DISABLE_BOT_STYLE") != "1" else None
_last_read = -1.0
_match = None


def _name(value):
    return "".join(char for char in unicodedata.normalize("NFKD", value.casefold())
                   if char.isalnum())


def _profiles():
    global _last_read, _match
    now = time.monotonic()
    if _directory is None or now - _last_read < 0.12:
        return _match
    _last_read, _match = now, None
    try:
        profile = json.loads((_directory / "rlc-bot-styles.json").read_text(encoding="utf-8"))
        camera = (_directory / "inventory-cameras.tsv").read_text(encoding="utf-8").splitlines()[0].split()[0]
        token = profile["token"]
        if token.startswith(_token + "-") and (camera == token or camera.startswith(token + ".")) and profile["expires"] > time.time() * 1000:
            entries = {}
            for player in profile["players"]:
                key = _name(player["name"])
                # Canonicalization collisions must never assign the wrong profile.
                entries[key] = None if key in entries else player
            _match = profile["token"], entries
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        pass
    return _match


def _quick_chat_active():
    try:
        from rlc_quick_chat import _refresh
        cfg = _refresh()
        return bool(cfg and cfg[1])
    except ImportError:
        return False


def _controls(wanted, **changes):
    fields = ("throttle", "steer", "pitch", "yaw", "roll", "jump", "boost", "handbrake", "use_item")
    return ControllerState(**{key: changes.get(key, getattr(wanted, key)) for key in fields})


def _horizontal(a, x, y):
    return math.hypot(a.x - x, a.y - y)


def execution_precision(commands, mechanics, control, sense, tick):
    # Keep button timing and neutral dodge/release axes exact. Analog error
    # changes gradually, so a rating cannot cause per-packet input jitter.
    adjusted = commands.copy()
    ratings = {"pitch": mechanics, "yaw": mechanics, "roll": mechanics,
               "throttle": control, "steer": (mechanics + sense) * .5}
    for index, (axis, rating) in enumerate(ratings.items()):
        value = commands.get(axis, 0)
        if not value:
            continue
        error = (1 - max(0, min(100, rating)) / 100) ** 1.4
        phase = tick / 17.0 + index * 1.7
        factor = 1 - error * (.27 + .16 * math.sin(phase))
        adjusted[axis] = clip(value * factor)
    # Keep direction errors from turning an intended dodge into a neutral jump.
    if commands.get("jump"):
        requested = math.hypot(commands.get("pitch", 0), commands.get("yaw", 0))
        actual = math.hypot(adjusted.get("pitch", 0), adjusted.get("yaw", 0))
        if requested >= .60 and actual < .60:
            for axis in ("pitch", "yaw"):
                if axis in adjusted:
                    adjusted[axis] *= .60 / actual
    return adjusted


class BotStyle:
    def __init__(self):
        self.identity = None
        self.kickoff_owner = None
        self.kickoff_until = -1
        self.kickoff_target = None
        self.goal_idle_since = None
        self.goal_exit_until = -1
        self.takeoff = None
        self.prejump_until = 0
        self.prejump_target = None
        self.next_aerial = 0
        self.steer = 0.0
        self.steer_tick = 0
        self.last_tick = -1
        self.advanced = AdvancedMoves()

    def apply(self, packet, index, wanted):
        current = _profiles()
        if current is None or not 0 <= index < len(packet.players):
            return wanted
        player = packet.players[index]
        entry = current[1].get(_name(player.name))
        if not entry or not player.is_bot:
            return wanted
        tick = packet.match_info.frame_num
        identity = (current[0], player.player_id)
        if self.identity != identity or tick < self.last_tick:
            self.__init__()
            self.identity = identity
        self.last_tick = tick
        phase = packet.match_info.match_phase
        ball_at_center = bool(packet.balls and math.hypot(packet.balls[0].physics.location.x,
                                                         packet.balls[0].physics.location.y) < 45)
        if phase == MatchPhase.Countdown:
            self.kickoff_until = tick + 240
        elif phase == MatchPhase.Kickoff and self.kickoff_until < 0:
            self.kickoff_until = tick + 240
        kickoff = phase == MatchPhase.Countdown or (
            phase in (MatchPhase.Active, MatchPhase.Kickoff) and ball_at_center and tick <= self.kickoff_until
            and (phase == MatchPhase.Kickoff or self.kickoff_owner is not None))
        if kickoff and not _quick_chat_active():
            if self.kickoff_owner is None:
                self.kickoff_owner = self.kickoff_taker(packet, player.team)
            if (phase != MatchPhase.Countdown and self.kickoff_owner == index and ball_at_center
                    and not wanted.jump and wanted.throttle <= 0
                    and math.hypot(player.physics.velocity.x, player.physics.velocity.y) < 220):
                return _controls(wanted, throttle=1, steer=0, boost=player.boost > 0)
            if self.kickoff_owner is not None and self.kickoff_owner != index:
                if self.kickoff_target is None:
                    self.kickoff_target = self.support_spawn(packet, index, self.kickoff_owner)
                return self.drive_kickoff_support(player, wanted, self.kickoff_target)
            if phase != MatchPhase.Countdown and self.kickoff_owner == index:
                safer = self.contested_kickoff(packet, index, wanted)
                if safer is not None:
                    return _controls(wanted, **safer)
        elif phase != MatchPhase.Paused:
            self.kickoff_owner = self.kickoff_target = None
            if phase != MatchPhase.Kickoff:
                self.kickoff_until = -1
        if packet.match_info.match_phase != MatchPhase.Active or not packet.balls or player.demolished_timeout > 0 or _quick_chat_active():
            self.takeoff = None
            self.prejump_target = None
            if self.advanced.move:
                self.advanced.cancel(tick)
            self.steer = wanted.steer
            return wanted
        ball = packet.balls[0].physics
        if math.hypot(ball.location.x, ball.location.y) < 60:
            self.takeoff = None
            self.prejump_target = None
            if self.advanced.move:
                self.advanced.cancel(tick)
            return wanted

        mechanics = max(0, min(100, float(entry["mechanics"])))
        control = float(entry.get("ballControl", mechanics))
        sense = float(entry.get("gameSense", mechanics))
        pro = _PROFILES.get(_name(player.name)) if entry["isPublic"] else None
        height, boost, hold, release, reach = pro or (415, 39, 9, 4, 900)
        grounded = player.air_state == AirState.OnGround
        me = player.physics.location
        if grounded:
            escape = self.leave_idle_goal(player, ball, wanted, tick)
            if escape is not None:
                return _controls(wanted, **escape)
        else:
            self.goal_idle_since = None
        if grounded and me.z < 65 and hasattr(ball, "velocity"):
            rotation = self.rotation_cover(packet, index, ball, wanted)
            if rotation is not None:
                if self.advanced.move:
                    self.advanced.cancel(tick, retry=35)
                self.takeoff = None
                return _controls(wanted, **execution_precision(rotation, mechanics, control, sense, tick))
            correction = self.close_play(packet, index, ball, wanted)
            if correction is not None:
                self.takeoff = None
                if self.advanced.move:
                    self.advanced.cancel(tick)
                return _controls(wanted, **execution_precision(correction, mechanics, control, sense, tick))
        if grounded and wanted.throttle >= 0:
            cover = self.cover_aerial(packet, index, ball)
            if cover is not None:
                return _controls(wanted, **cover)
        setup = (wanted.throttle > .7
                 and not wanted.handbrake and abs(wanted.steer) < .2
                 and 380 < _horizontal(me, ball.location.x, ball.location.y) < 850
                 and all(_horizontal(other.physics.location, ball.location.x, ball.location.y) > 1150
                         for other in packet.players if player.team != other.team and other.demolished_timeout <= 0))
        if setup:
            height, reach = min(290, height), max(1050, reach)

        if (not grounded and self.advanced.stage != "ceiling-reset"
                and (surface := self.surface_recovery(player, ball)) is not None):
            self.takeoff = None
            self.prejump_target = None
            if self.advanced.move:
                self.advanced.trace(player, self.advanced.move, "surface-recovery", tick)
                self.advanced.cancel(tick, retry=0)
            return _controls(wanted, **execution_precision(surface, mechanics, control, sense, tick))

        if self.takeoff is not None:
            elapsed = tick - self.takeoff
            if player.boost < 8 or elapsed >= hold + release + 3 or (grounded and elapsed >= hold):
                self.takeoff = None
            elif elapsed < hold:
                return _controls(wanted, jump=True, boost=True,
                                 **execution_precision({'pitch': max(wanted.pitch, .55)}, mechanics, control, sense, tick))
            elif elapsed < hold + release:
                return _controls(wanted, jump=False, boost=True, pitch=0, yaw=0, roll=0)
            elif player.dodge_timeout > 0:
                return _controls(wanted, jump=True, boost=True, pitch=0, yaw=0, roll=0)
            else:
                self.takeoff = None
                return wanted

        if not grounded and (not wanted.jump or self.advanced.move is None):
            committed = self.advanced.move is not None
            recovery = self.recover(player, ball, urgent=committed or wanted.boost or wanted.jump)
            if recovery is not None:
                if committed:
                    self.advanced.cancel(tick)
                self.prejump_target = None
                return _controls(wanted, **execution_precision(recovery, mechanics, control, sense, tick))
        if self.prejump_target is not None:
            if grounded or tick >= self.prejump_until or ball.location.z > 310:
                self.prejump_target = None
            else:
                direction = sub(self.prejump_target, vector(me))
                front, _, _ = basis(player.physics.rotation)
                return _controls(wanted, **execution_precision(
                    dict(air_controls(player, direction, (0, 0, 1)), jump=False,
                         boost=dot(front, unit(direction)) > .78), mechanics, control, sense, tick))

        if os.environ.get("RLC_DISABLE_ADVANCED_MOVES") != "1" and hasattr(player, "latest_touch"):
            changes = self.advanced.update(packet, index, wanted)
            if changes is not None:
                return _controls(wanted, **execution_precision(changes, mechanics, control, sense, tick))

        forecast = None
        if (grounded and me.z < 65 and tick >= self.next_aerial and player.boost >= 34
                and not wanted.handbrake and hasattr(player, "latest_touch") and self.advanced.move is None):
            forecast = self.prejump_clear(packet, index, ball)
        deliberate = setup or wanted.jump or (wanted.throttle > .65
                                      and abs(wanted.steer) <= .22 and not wanted.handbrake
                                      and math.hypot(player.physics.velocity.x, player.physics.velocity.y) >= 550)
        if forecast is not None or (grounded and me.z < 65 and deliberate and (wanted.boost or setup) and wanted.pitch >= 0
                and player.boost >= boost and tick >= self.next_aerial
                and self.has_aerial(packet, index, player, ball, height, reach)):
            self.takeoff = tick
            self.next_aerial = tick + 300
            if forecast is not None:
                self.prejump_target, self.prejump_until = forecast, tick + 68
            if os.environ.get("RLC_BOT_STYLE_TRACE") == "1":
                print(f"[career-style] {player.name}: fast aerial at frame {tick}", flush=True)
            return _controls(wanted, jump=True, boost=True,
                                 **execution_precision({'pitch': max(wanted.pitch, .55)}, mechanics, control, sense, tick))

        if (grounded and player.boost >= 38
                and wanted.throttle > .9 and abs(wanted.steer) < .10 and not wanted.jump
                and not wanted.handbrake and abs(me.x) < 3100 and abs(me.y) < 3900):
            velocity = player.physics.velocity
            distance = _horizontal(me, ball.location.x, ball.location.y)
            if 1400 < distance < 2700 and 750 < math.hypot(velocity.x, velocity.y) < 1790:
                goalward = (ball.location.x - me.x, ball.location.y - me.y, 0)
                front, _, _ = basis(player.physics.rotation)
                if dot(front, unit(goalward)) > .98:
                    return _controls(wanted, boost=True)

        # Only soften tiny steering reversals in ordinary ground driving.
        if (grounded and not wanted.jump and not wanted.boost and not wanted.handbrake
                and tick - self.steer_tick < 3
                and self.steer * wanted.steer < 0 and abs(wanted.steer - self.steer) < .22):
            return _controls(wanted, steer=self.steer)
        if wanted.steer != self.steer:
            self.steer, self.steer_tick = wanted.steer, tick
        return wanted

    @staticmethod
    def kickoff_taker(packet, team):
        # +Y attackers have field +X on their left; mirror for -Y.
        attack = 1 if team == 0 else -1
        candidates = [(math.hypot(pos.x, pos.y), -attack * pos.x, index)
                      for index, car in enumerate(packet.players)
                      for pos in (car.physics.location,)
                      if car.team == team and car.demolished_timeout <= 0 and attack * pos.y < -1000]
        if not candidates:
            return None
        nearest = min(distance for distance, _, _ in candidates)
        return min((side, index) for distance, side, index in candidates if distance <= nearest + 40)[1]

    @staticmethod
    def support_spawn(packet, index, taker):
        car = packet.players[index]
        attack = 1 if car.team == 0 else -1
        spawn = car.physics.location
        support = [i for i, other in enumerate(packet.players)
                   if i != taker and other.team == car.team and other.demolished_timeout <= 0]
        follow = min(support, key=lambda i: (math.hypot(packet.players[i].physics.location.x,
                                                        packet.players[i].physics.location.y), i))
        side = 1 if spawn.x >= 0 else -1
        if follow == index:
            return (side * 420, -attack * 1280)
        # Stay deep and move toward a lateral boost lane.
        return (side * 1540, -attack * 3000)

    @staticmethod
    def drive_kickoff_support(player, wanted, target):
        pos = player.physics.location
        dx, dy = target[0] - pos.x, target[1] - pos.y
        angle = math.atan2(dy, dx) - player.physics.rotation.yaw
        angle = math.atan2(math.sin(angle), math.cos(angle))
        distance = math.hypot(dx, dy)
        velocity = player.physics.velocity
        speed = math.hypot(velocity.x, velocity.y)
        throttle = (-.7 if speed > 450 else 0) if distance < 180 + speed * .22 else (.65 if abs(angle) < .8 else .40)
        return _controls(wanted, throttle=throttle, steer=max(-1, min(1, 2.3 * angle)), jump=False,
                         boost=False, pitch=0, yaw=0, roll=0, handbrake=abs(angle) > 1.05 and speed > 450)

    @staticmethod
    def surface_recovery(player, ball):
        p = vector(player.physics.location)
        v = vector(player.physics.velocity)
        candidates = []
        for axis, boundary in ((0, 4015), (1, 5040)):
            side = 1 if p[axis] >= 0 else -1
            speed = side * v[axis]
            if speed < 420 or (axis == 1 and abs(p[0]) < 930 and p[2] < 640):
                continue
            time = max(0, boundary - side * p[axis]) / speed
            if time < .52:
                normal = tuple(-side if i == axis else 0 for i in range(3))
                candidates.append((time, normal))
        if v[2] > 360:
            discriminant = v[2] ** 2 - 1300 * (1990 - p[2])
            if discriminant >= 0:
                time = max(0, (v[2] - math.sqrt(discriminant)) / 650)
                if time < .50:
                    candidates.append((time, (0, 0, -1)))
        if not candidates:
            return None
        time, normal = min(candidates)
        future = ball_path(ball, time)
        car_at_surface = add(p, add(scale(v, time), (0, 0, -325 * time ** 2)))
        relative = sub(future, car_at_surface)
        # Preserve a reachable touch before the surface.
        if (time > .15 and math.hypot(*relative) < 205 and dot(relative, normal) > 45):
            return None
        direction = sub(v, scale(normal, dot(v, normal)))
        front, _, up = basis(player.physics.rotation)
        if math.hypot(*direction) < 180:
            direction = sub(front, scale(normal, dot(front, normal)))
        if math.hypot(*direction) < .15:
            direction = (0, 1 if player.team == 0 else -1, 0)
        if dot(up, normal) > .95 and dot(front, unit(direction)) > .88:
            return dict(jump=False, boost=False, throttle=.7, handbrake=False)
        return dict(air_controls(player, direction, normal), jump=False, boost=False,
                    throttle=.72, handbrake=False)

    @staticmethod
    def rotation_cover(packet, index, ball, wanted):
        car = packet.players[index]
        loc = car.physics.location
        attack = 1 if car.team == 0 else -1
        x, y, _ = ball_path(ball, .34)
        if attack * y < -2600 or math.hypot(x - loc.x, y - loc.y) > 1920 or wanted.throttle < .50:
            return None
        squad = [(i, other) for i, other in enumerate(packet.players)
                 if other.team == car.team and other.demolished_timeout <= 0]
        if len(squad) < 3:
            return None
        def to_ball(entry):
            pos, speed = entry[1].physics.location, entry[1].physics.velocity
            return math.hypot(x - pos.x - .20 * speed.x, y - pos.y - .20 * speed.y)
        lead, second, *_ = sorted(squad, key=lambda entry: (to_ball(entry), entry[0]))
        if index in (lead[0], second[0]) or to_ball(second) > 1400:
            return None
        if attack * (y - loc.y) > 2300:
            return None
        side = 1 if loc.x > x or (loc.x == x and index % 2) else -1
        tx = max(-3000, min(3000, x * .52 + side * 630))
        ty = max(-3650, min(3650, y - attack * 1550))
        if math.hypot(tx - loc.x, ty - loc.y) < 290:
            return None
        return BotStyle.ground_aim(car, tx, ty, .62, False, allow_turn=True)

    @staticmethod
    def contested_kickoff(packet, index, wanted):
        car = packet.players[index]
        loc = car.physics.location
        speed = car.physics.velocity
        distance = math.hypot(loc.x, loc.y)
        if (car.air_state != AirState.OnGround or wanted.jump or not 205 < distance < 1050
                or math.hypot(speed.x, speed.y) < 600):
            return None
        eta = distance / max(850, -dot(vector(loc), vector(speed)) / distance)
        for enemy in packet.players:
            if enemy.team == car.team or enemy.demolished_timeout > 0:
                continue
            pos, vel = enemy.physics.location, enemy.physics.velocity
            d = math.hypot(pos.x, pos.y)
            if 50 < d < 1350 and -(pos.x * vel.x + pos.y * vel.y) / d > 600:
                if d / max(800, -(pos.x * vel.x + pos.y * vel.y) / d) <= eta + .18:
                    return BotStyle.ground_aim(car, 0, 0, 1, distance > 365)
        return None

    @staticmethod
    def close_play(packet, index, ball, wanted):
        car = packet.players[index]
        origin = car.physics.location
        attack = 1 if car.team == 0 else -1
        horizon = .20
        x, y, z = ball_path(ball, horizon)
        distance = _horizontal(origin, x, y)
        if not (90 < distance < 1180 and z < 215 and abs(x) < 3650 and abs(y) < 4750):
            return None
        # Already carrying on the roof. Leave the next move to the dribble controller.
        if (ball.location.z > 115 and _horizontal(origin, ball.location.x, ball.location.y) < 85
                and abs(ball.velocity.z) < 210):
            return None

        def arrival(player):
            pos, vel = player.physics.location, player.physics.velocity
            delta = (x - pos.x, y - pos.y, 0)
            heading = math.atan2(delta[1], delta[0]) - player.physics.rotation.yaw
            turn = abs(math.atan2(math.sin(heading), math.cos(heading)))
            closing = max(0, dot((vel.x, vel.y, 0), unit(delta)))
            return math.hypot(*delta) / max(650, 850 + .5 * closing) + .16 * turn

        squad = [(n, teammate) for n, teammate in enumerate(packet.players)
                 if teammate.team == car.team and teammate.demolished_timeout <= 0
                 and _horizontal(teammate.physics.location, x, y) < 1500]
        primary, lead = min(squad, key=lambda entry: (arrival(entry[1]) - (.10 if not entry[1].is_bot else 0), entry[0]))
        if primary != index:
            imminent = (arrival(car) < arrival(lead) + .36
                        and attack * y > -2700 and wanted.throttle > .5)
            if not imminent:
                return None
            side = 1 if origin.x > x or (origin.x == x and index % 2) else -1
            tx, ty = x + side * 720, y - attack * 740
            return BotStyle.ground_aim(car, tx, ty, .52, False, allow_turn=True)

        if wanted.throttle < 0 or wanted.handbrake:
            return None
        enemies = [other for other in packet.players if other.team != car.team and other.demolished_timeout <= 0]
        opponent_near = any(_horizontal(enemy.physics.location, x, y) < 640 for enemy in enemies)
        goal_y = attack * 5120
        for goal_x in (0, -390, 390):
            lane_x = goal_x - x
            lane_y = goal_y - y
            goal_distance = math.hypot(lane_x, lane_y)
            if not (400 < goal_distance < 3000 and distance < 650 and not opponent_near):
                break
            blocked = False
            for enemy in enemies:
                pos, vel = enemy.physics.location, enemy.physics.velocity
                lead_x, lead_y = pos.x + vel.x * .32 - x, pos.y + vel.y * .32 - y
                along = (lead_x * lane_x + lead_y * lane_y) / (goal_distance ** 2)
                if -.05 < along <= 1.10 and math.hypot(lead_x - along * lane_x, lead_y - along * lane_y) < 640:
                    blocked = True
                    break
            if not blocked:
                tx = x - 85 * lane_x / goal_distance
                ty = y - 85 * lane_y / goal_distance
                if (tx - origin.x) * lane_x + (ty - origin.y) * lane_y > 0:
                    return BotStyle.ground_aim(car, tx, ty, 1, distance > 350)
        if opponent_near and distance < 575 and attack * (y - origin.y) > 65:
            return BotStyle.ground_aim(car, x, y, .96, distance > 390)
        return None

    @staticmethod
    def ground_aim(car, x, y, throttle, boost, allow_turn=False):
        pos = car.physics.location
        heading = math.atan2(y - pos.y, x - pos.x) - car.physics.rotation.yaw
        angle = math.atan2(math.sin(heading), math.cos(heading))
        if abs(angle) > 1.30:
            if not allow_turn:
                return None
            return dict(throttle=.32, steer=clip(angle), boost=False, jump=False,
                        handbrake=math.hypot(car.physics.velocity.x, car.physics.velocity.y) > 540)
        return dict(throttle=throttle if abs(angle) < .65 else min(.58, throttle),
                    steer=clip(angle * 2.8), boost=boost and abs(angle) < .16 and car.boost > 12,
                    jump=False, handbrake=False)

    @staticmethod
    def recover(player, ball, urgent=False):
        me, velocity = player.physics.location, player.physics.velocity
        if not (55 < me.z < 820 and velocity.z < -140 and abs(me.x) < 3900 and abs(me.y) < 4800):
            return None
        # Time until the roof or wheels reach the floor, with gravity.
        time_left = (velocity.z + math.sqrt(velocity.z ** 2 + 1300 * (me.z - 25))) / 650
        if time_left > (.29 if urgent else .64):
            return None
        ball_distance = _horizontal(me, ball.location.x, ball.location.y)
        if ball_distance < (350 if urgent else 420) and abs(me.z - ball.location.z) < 250:
            return None
        front, _, up = basis(player.physics.rotation)
        horizontal = (velocity.x, velocity.y, 0)
        if math.hypot(*horizontal) < 240:
            horizontal = (front[0], front[1], 0)
        if math.hypot(*horizontal) < .15:
            horizontal = (0, 1 if player.team == 0 else -1, 0)
        if up[2] > .96 and dot(front, unit(horizontal)) > .88:
            return None
        return dict(air_controls(player, horizontal, (0, 0, 1)), jump=False, boost=False,
                    throttle=.75, handbrake=False)

    @staticmethod
    def prejump_clear(packet, index, ball):
        me = packet.players[index]
        loc = me.physics.location
        ball_pos = vector(ball.location)
        if not (92 <= ball_pos[2] < 295 and abs(ball_pos[0]) < 2800 and abs(ball_pos[1]) < 3650):
            return None
        attack = 1 if me.team == 0 else -1
        mates = [mate for i, mate in enumerate(packet.players) if i != index and mate.team == me.team
                 and mate.demolished_timeout <= 0]
        if not any(attack * (loc.y - mate.physics.location.y) > 520 for mate in mates):
            return None
        for opponent in packet.players:
            if opponent.team == me.team or opponent.demolished_timeout > 0 or opponent.air_state != AirState.OnGround:
                continue
            ep = vector(opponent.physics.location)
            ev = vector(opponent.physics.velocity)
            route = unit((ev[0], ev[1], 0))
            to_ball = sub(ball_pos, ep)
            if not (125 < math.hypot(*to_ball) < 510 and dot(route, unit(to_ball)) > .79
                    and math.hypot(ev[0], ev[1]) > 590 and attack * route[1] < -.30):
                continue
            point = (ball_pos[0] + route[0] * 655, ball_pos[1] + route[1] * 655, 395)
            distance = _horizontal(loc, point[0], point[1])
            yaw = me.physics.rotation.yaw
            if (295 < distance < 1000 and (math.cos(yaw) * (point[0] - loc.x)
                    + math.sin(yaw) * (point[1] - loc.y)) > distance * .86
                    and all(_horizontal(mate.physics.location, point[0], point[1]) > distance + 135
                            for mate in mates)):
                return point
        return None

    def leave_idle_goal(self, player, ball, wanted, tick):
        attack = 1 if player.team == 0 else -1
        position, velocity = player.physics.location, player.physics.velocity
        in_goal = attack * position.y < -4770 and abs(position.x) < 860 and position.z < 60
        danger = attack * ball.location.y < -2150 or attack * ball.velocity.y < -550
        if not in_goal or danger or wanted.jump or wanted.boost:
            self.goal_idle_since, self.goal_exit_until = None, -1
            return None
        if tick > self.goal_exit_until:
            if math.hypot(velocity.x, velocity.y) > 130 or abs(wanted.throttle) > .24:
                self.goal_idle_since = None
                return None
            if self.goal_idle_since is None:
                self.goal_idle_since = tick
            if tick - self.goal_idle_since < 100:
                return None
            self.goal_exit_until = tick + 120
            self.goal_idle_since = None
        angle = math.atan2(attack * 650, -position.x * .35) - player.physics.rotation.yaw
        angle = math.atan2(math.sin(angle), math.cos(angle))
        if abs(angle) > 1.65:
            reverse = math.atan2(math.sin(angle + math.pi), math.cos(angle + math.pi))
            return dict(throttle=-.68, steer=max(-1, min(1, -reverse * 2)), handbrake=False)
        return dict(throttle=.72, steer=max(-1, min(1, angle * 2)), handbrake=False)

    @staticmethod
    def cover_aerial(packet, index, ball):
        player = packet.players[index]
        attack = 1 if player.team == 0 else -1
        me, target = player.physics.location, ball.location
        if attack * me.y < -3900 or attack * target.y < -650 or target.z < 380 or attack * ball.velocity.y < -900:
            return None
        team = [other for i, other in enumerate(packet.players) if i != index
                and other.team == player.team and other.demolished_timeout <= 0]
        grounded = [other for other in team if other.air_state == AirState.OnGround]
        if any(attack * (other.physics.location.y - me.y) < -40 for other in grounded):
            return None
        if not any(other.air_state == AirState.InAir and other.physics.location.z > 280
                   and _horizontal(other.physics.location, target.x, target.y) < 710
                   and abs(other.physics.location.z - target.z) < 350 for other in team):
            return None
        if _horizontal(me, target.x, target.y) > 2150:
            return None
        x = target.x * .55 - me.x
        y = target.y - attack * 1350 - me.y
        if math.hypot(x, y) < 310:
            return None
        angle = math.atan2(y, x) - player.physics.rotation.yaw
        error = math.atan2(math.sin(angle), math.cos(angle))
        return dict(throttle=.55 if abs(error) < 1.2 else .30,
                    steer=max(-1, min(1, error * 2)), boost=False, jump=False, handbrake=False)

    @staticmethod
    def has_aerial(packet, index, player, ball, height, reach):
        me = player.physics.location
        horizon = .36
        x = ball.location.x + horizon * ball.velocity.x
        y = ball.location.y + horizon * ball.velocity.y
        z = ball.location.z + horizon * ball.velocity.z - 325 * horizon ** 2
        distance = _horizontal(me, x, y)
        attack = 1 if player.team == 0 else -1
        if not (height <= z <= 830 and 300 < distance < reach and abs(x) < 3400 and abs(y) < 4400):
            return False
        if attack * y < -2100 or attack * (y - me.y) < -120:
            return False
        yaw = player.physics.rotation.yaw
        if (math.cos(yaw) * (x - me.x) + math.sin(yaw) * (y - me.y)) < distance * .91:
            return False
        allies = [p for i, p in enumerate(packet.players) if i != index and p.team == player.team and p.demolished_timeout <= 0]
        # Require cover and yield to a closer, already airborne or human teammate.
        if not any(attack * (me.y - ally.physics.location.y) > 280 for ally in allies):
            return False
        return not any(_horizontal(ally.physics.location, x, y) < distance + (170 if not ally.is_bot else -100)
                       and (not ally.is_bot or ally.air_state != AirState.OnGround) for ally in allies)


def adjust(owner, packet, index, wanted):
    if _directory is None:
        return wanted
    try:
        style = getattr(owner, "_career_plus_style", None)
        if style is None:
            style = owner._career_plus_style = BotStyle()
        mode = getattr(getattr(owner, "tactics", owner), "mode", None)
        if mode in ("park", "ultra_defensive", "defensive"):
            style.takeoff = None
            if style.advanced.move:
                style.advanced.cancel(packet.match_info.frame_num)
            return wanted
        return style.apply(packet, index, wanted)
    except (AttributeError, IndexError, TypeError, ValueError):
        return wanted
