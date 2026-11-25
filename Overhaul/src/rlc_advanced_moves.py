"""Bounded aerial sequences used on top of the Hub's native policy."""
import math
import os

from rlbot.flat import AirState


def vector(value):
    return (value.x, value.y, value.z)


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def scale(v, amount):
    return tuple(x * amount for x in v)


def sub(a, b):
    return add(a, scale(b, -1))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def unit(v):
    return scale(v, 1 / max(1e-6, math.hypot(*v)))


def clip(value):
    return min(1.0, max(-1.0, value))


def basis(rotation):
    p, y, r = rotation.pitch, rotation.yaw, rotation.roll
    cp, cy, cr = math.cos(p), math.cos(y), math.cos(r)
    sp, sy, sr = math.sin(p), math.sin(y), math.sin(r)
    return ((cp * cy, cp * sy, sp),
            (cy * sp * sr - cr * sy, sy * sp * sr + cr * cy, -cp * sr),
            (-cr * cy * sp - sr * sy, -cr * sy * sp + sr * cy, cp * cr))


def air_controls(player, direction, desired_up):
    front, left, up = basis(player.physics.rotation)
    direction, desired_up = unit(direction), unit(desired_up)
    angular = vector(player.physics.angular_velocity)
    # Local angular rates damp the turn. atan2 retains an error near 180 degrees.
    return {
        "pitch": clip(2.8 * math.atan2(dot(direction, up), dot(direction, front)) + .18 * dot(angular, left)),
        "yaw": clip(2.8 * math.atan2(dot(direction, left), dot(direction, front)) - .18 * dot(angular, up)),
        "roll": clip(2.2 * math.atan2(dot(desired_up, left), dot(desired_up, up)) + .18 * dot(angular, front)),
    }


def ball_path(ball, seconds):
    x, y, z = add(vector(ball.location), scale(vector(ball.velocity), seconds))
    z -= 325 * seconds ** 2
    if abs(x) > 4003:
        x = math.copysign(4003 - .62 * (abs(x) - 4003), x)
    if abs(y) > 5027 and (abs(x) > 800 or z > 560):
        y = math.copysign(5027 - .62 * (abs(y) - 5027), y)
    if z > 1955:
        z = 1955 - .60 * (z - 1955)
    elif z < 93:
        floor = (ball.velocity.z + math.sqrt(ball.velocity.z ** 2 + 1300 * max(0, ball.location.z - 93))) / 650
        impact = 650 * floor - ball.velocity.z
        remaining = max(0, seconds - floor)
        z = 93 + max(0, .58 * impact * remaining - 325 * remaining ** 2) if impact > 180 else 93
    return x, y, z


def chase_direction(player, ball, offset=(0, 0, 0)):
    position = vector(player.physics.location)
    velocity = vector(player.physics.velocity)
    distance = math.hypot(*sub(vector(ball.location), position))
    horizon = min(.38, max(.045, distance / 1850))
    target = add(ball_path(ball, horizon), offset)
    return sub(target, add(position, scale(velocity, horizon * .58)))


def flip_available(car):
    return (car.air_state == AirState.InAir and not car.has_double_jumped and not car.has_dodged
            and (car.dodge_timeout > 0 or not car.has_jumped))


def reset_available(car):
    return flip_available(car) and not car.has_jumped


def touch_id(car):
    touch = car.latest_touch
    return touch.game_seconds if touch is not None and touch.ball_index == 0 else -1


def on_target(ball, team):
    attack = 1 if team == 0 else -1
    pos, speed = ball.location, ball.velocity
    if speed.y * attack < 600:
        return False
    seconds = (attack * 5120 - pos.y) / speed.y
    return (0 < seconds <= 2 and abs(pos.x + speed.x * seconds) < 800
            and 90 < pos.z + speed.z * seconds - 325 * seconds ** 2 < 550)


def incoming_ball(ball, attack):
    return ball.velocity.y * attack < -350


class AdvancedMoves:
    def __init__(self):
        self.move = None
        self.stage = ""
        self.next_attempt = 0
        self.cooldown = 280
        self.pending_shot = None
        self.reset_count = 0
        self.release_tick = None
        self.carry_touches = 0
        self.reset_seen_at = None
        self.reset_touch_at = None

    def cancel(self, tick, retry=None):
        self.move = None
        self.stage = ""
        self.next_attempt = max(self.next_attempt, tick + (self.cooldown if retry is None else retry))

    @staticmethod
    def trace(player, move, event, tick):
        if os.environ.get("RLC_BOT_STYLE_TRACE") == "1":
            print(f"[career-style] {player.name}: {move} {event} at frame {tick}", flush=True)

    def begin(self, kind, stage, player, tick):
        self.move, self.stage, self.started = kind, stage, tick
        self.stage_tick = tick
        self.carry_touches = 0
        self.touch = touch_id(player)
        self.was_reset = reset_available(player)
        self.reset_count = 0
        self.release_tick = None
        self.reset_seen_at = self.reset_touch_at = None
        self.trace(player, kind, "attempt", tick)

    def fire(self, player, tick, backwards=False):
        move = self.move
        self.pending_shot = move, tick + 55, touch_id(player)
        self.cancel(tick)
        return dict(jump=True, pitch=(1 if backwards else -1), yaw=0, roll=0, boost=True)

    @staticmethod
    def backboard_time(ball, attack):
        speed = ball.velocity
        if attack * speed.y < 850:
            return None
        seconds = (attack * 5020 - ball.location.y) / speed.y
        height = ball.location.z + speed.z * seconds - 325 * seconds ** 2
        if (.08 < seconds < 1.25 and 650 < height < 1650
                and abs(ball.location.x + speed.x * seconds) < 2700):
            return seconds
        return None

    def cushion(self, player, ball, direction, distance, goal_direction):
        front, _, _ = basis(player.physics.rotation)
        relative = sub(vector(player.physics.velocity), vector(ball.velocity))
        # Minimise the normal component of relative speed at contact.
        # Offset the nose from the centre so the car brushes under the ball.
        normal = unit(sub(vector(ball.location), vector(player.physics.location)))
        closing = dot(relative, normal)
        approach = add(direction, add(scale(goal_direction, -44), (0, 0, -43)))
        up = (0, 0, 1)
        if self.move == "zen-touch" and self.stage == "cushion" and 135 < distance < 275:
            yaw = player.physics.rotation.yaw
            up = (-.34 * math.sin(yaw), .34 * math.cos(yaw), .94)
        attitude = air_controls(player, approach, up)
        speed_limit = max(65, min(310, (distance - 136) * .9))
        return dict(attitude, jump=False,
                    boost=distance > 215 and closing < speed_limit and dot(front, unit(approach)) > .93,
                    throttle=-.80 if closing > speed_limit else .15)

    def double_tap(self, player, ball, attack, tick):
        if touch_id(player) > self.touch:
            self.trace(player, self.move, "on-target" if on_target(ball, player.team) else "contact", tick)
            self.cancel(tick)
            return None
        pos, velocity = vector(ball.location), vector(ball.velocity)
        if self.stage == "read-board":
            seconds = self.backboard_time(ball, attack)
            if attack * velocity[1] < -250 and attack * pos[1] > 4350:
                self.stage = "rebound"
            elif seconds is not None:
                # Follow below the board contact, leaving room for the rebound.
                projected = add(pos, scale(velocity, seconds))
                target = (projected[0], attack * 4370, projected[2] - 325 * seconds ** 2 - 235)
            elif attack * pos[1] > 4850 and attack * velocity[1] > 0:
                target = (pos[0], attack * 4370, pos[2] - 235)
            else:
                self.cancel(tick)
                return None
        if self.stage == "rebound":
            horizon = .16
            predicted = add(add(pos, scale(velocity, horizon)), (0, 0, -325 * horizon ** 2))
            target = add(predicted, scale(unit(sub(predicted, (0, attack * 5120, 280))), 85))
        position = vector(player.physics.location)
        delta = sub(target, position)
        velocity = vector(player.physics.velocity)
        lead = min(.14, math.hypot(*delta) / 2700)
        direction = sub(delta, scale(velocity, lead))
        front, _, _ = basis(player.physics.rotation)
        return dict(air_controls(player, direction, (0, 0, 1)), jump=False,
                    boost=math.hypot(*delta) > 155 and dot(front, unit(direction)) > .80)

    @staticmethod
    def aerial_receiver(player, ball, teammates, opponents, attack):
        origin = vector(ball.location)
        best = None
        for ally in teammates:
            pos = vector(ally.physics.location)
            vel = vector(ally.physics.velocity)
            target = add(pos, scale(vel, .32))
            distance = math.hypot(*sub(target, origin))
            if not (620 < distance < 2000 and attack * (target[1] - origin[1]) > 330):
                continue
            _, _, up = basis(ally.physics.rotation)
            ceiling = pos[2] > 1860 and up[2] < -.55
            if ceiling:
                target = (target[0], target[1], 1480)
            if not (ceiling or ally.air_state == AirState.InAir and 480 < target[2] < 1800):
                continue
            if any(math.hypot(*sub(target, vector(enemy.physics.location))) < 650 for enemy in opponents):
                continue
            if best is None or distance < best[0]:
                best = distance, target
        return best[1] if best else None

    @staticmethod
    def ground_receiver(ball, teammates, opponents, attack):
        origin = vector(ball.location)
        for ally in teammates:
            xy = add(vector(ally.physics.location), scale(vector(ally.physics.velocity), .25))
            lane = sub(xy, origin)
            length = math.hypot(*lane)
            if ally.air_state != AirState.OnGround or not (700 < length < 1800 and attack * lane[1] > 330):
                continue
            direction = unit(lane)
            if all(math.hypot(*sub(sub(vector(enemy.physics.location), origin),
                                   scale(direction, min(length, max(0, dot(sub(vector(enemy.physics.location), origin), direction)))))) > 550
                   for enemy in opponents):
                return xy
        return None

    def tactical_move(self, player, ball, teammates, opponents, attack, tick):
        position = vector(player.physics.location)
        target = vector(ball.location)
        offset = sub(target, position)
        distance = math.hypot(*offset)
        front, _, up = basis(player.physics.rotation)
        if self.move is None and tick >= self.next_attempt:
            incoming = on_target(ball, 1 - player.team)
            ceiling = player.air_state == AirState.OnGround and position[2] > 1870 and up[2] < -.55
            ceiling_point = ball_path(ball, .34) if ceiling else None
            if (ceiling and 840 < target[2] < 1710 and distance < 850
                    and abs(ball.velocity.y) > 650
                    and math.hypot(*sub(ceiling_point, position)) < 690
                    and not incoming):
                self.begin("ceiling-prejump", "ceiling", player, tick)
            elif (ceiling and attack * position[1] > 1200 and 800 < target[2] < 1740
                    and distance < 1050 and attack * ball.velocity.y > 300
                    and any(0 <= self.match_seconds - touch_id(ally) < .55 and touch_id(ally) >= 0
                            for ally in teammates)):
                self.begin("ceiling-redirect", "ceiling", player, tick)
            elif (incoming and attack * position[1] < -4750 and abs(position[0]) < 970
                    and 88 < position[2] < 735 and distance < 1040):
                self.begin("squishy-save", "save", player, tick)
            elif (player.air_state == AirState.InAir
                    and attack * position[1] > 2500 and attack * target[1] > 3000
                    and position[2] > 1200 and player.physics.velocity.z > 410
                    and 145 < distance < 300 and dot(front, unit(offset)) > .91
                    and attack * offset[1] > 90 and player.boost >= 48
                    and all(math.hypot(*sub(vector(enemy.physics.location), target)) > distance + 330
                            for enemy in opponents)):
                self.begin("ceiling-reset-double-tap", "board-hit", player, tick)
            elif (player.air_state == AirState.OnGround and position[2] < 60 and target[2] < 145
                    and 180 < distance < 470 and dot(front, unit(offset)) > .90
                    and attack * position[1] > -1200):
                receiver = self.ground_receiver(ball, teammates, opponents, attack)
                if receiver is not None:
                    lane = unit(sub(receiver, target))
                    if dot(lane, unit(offset)) > .70:
                        self.begin("ground-pass", "ground-pass", player, tick)
                        self.receiver = receiver
                if not self.move and attack * position[1] > 400:
                    if any(350 < math.hypot(*sub(vector(enemy.physics.location), target)) < 780
                           and attack * (enemy.physics.location.y - target[1]) > 110 for enemy in opponents):
                        self.begin("fake-challenge", "fake", player, tick)
        if self.move in ("ground-pass", "fake-challenge"):
            elapsed = tick - self.started
            if elapsed > 36 or touch_id(player) > self.touch or distance > 720:
                self.cancel(tick)
                return None
            if self.move == "ground-pass":
                aim = sub(ball_path(ball, .13), scale(unit(sub(self.receiver, target)), 95))
                throttle = .94
            else:
                side = math.copysign(1, position[0] - target[0])
                aim = add(target, (side * 530, -attack * 185, 0))
                throttle = .66 if elapsed > 12 else .45
            delta = sub(aim, position)
            heading = math.atan2(delta[1], delta[0]) - player.physics.rotation.yaw
            return dict(throttle=throttle, steer=clip(2.7 * math.atan2(math.sin(heading), math.cos(heading))),
                        boost=False, jump=False, handbrake=False)
        if self.move == "squishy-save":
            if tick - self.started > 85 or touch_id(player) > self.touch or not incoming_ball(ball, attack):
                self.cancel(tick)
                return None
            aim = chase_direction(player, ball, (-math.copysign(30, offset[0]), -attack * 25, -20))
            return dict(air_controls(player, aim, (0, 0, 1)), throttle=1,
                        jump=player.air_state == AirState.OnGround, boost=dot(front, unit(aim)) > .86)
        if self.move == "ceiling-reset-double-tap":
            if tick - self.started > 220:
                self.cancel(tick)
                return None
            if self.stage == "board-hit":
                if touch_id(player) <= self.touch:
                    aim = chase_direction(player, ball, (0, -attack * 55, -58))
                    return dict(air_controls(player, aim, (0, 0, 1)), jump=False, boost=dot(front, unit(aim)) > .80)
                if self.backboard_time(ball, attack) is None:
                    self.cancel(tick)
                    return None
                self.touch = touch_id(player)
                self.stage, self.stage_tick = "ceiling-reset", tick
            if self.stage == "ceiling-reset":
                if player.air_state == AirState.OnGround and position[2] > 1910 and up[2] < -.55:
                    self.stage = "read-board"
                elif tick - self.stage_tick > 68 or position[2] < 1020:
                    self.cancel(tick)
                    return None
                else:
                    aim = unit((0, attack * .30, 1))
                    if position[2] > 1770:
                        aim = unit((0, attack, .12))
                    return dict(air_controls(player, aim, (0, 0, -1)), jump=False,
                                boost=position[2] < 1820 and front[2] > .53)
            if player.air_state == AirState.OnGround and position[2] > 1910:
                return dict(throttle=.55, boost=False, jump=False)
            return self.double_tap(player, ball, attack, tick)
        return None

    def reset_pop(self, player, ball, offset, distance, goal, tick, free):
        touched = touch_id(player)
        front, left, up = basis(player.physics.rotation)
        attack = 1 if player.team == 0 else -1
        if self.stage == "reset-pop-approach":
            available = reset_available(player)
            if available and not self.was_reset:
                self.reset_seen_at = tick
            self.was_reset = available
            if touched > self.touch:
                self.touch, self.reset_touch_at = touched, tick
            if (available and self.reset_seen_at is not None and self.reset_touch_at is not None
                    and abs(self.reset_seen_at - self.reset_touch_at) <= 12 and distance < 250):
                self.stage, self.stage_tick = "reset-pop-align", tick
                self.trace(player, self.move, "reset-confirmed", tick)
                return dict(jump=False, boost=False, roll=0)
            if self.reset_touch_at is not None and tick - self.reset_touch_at > 12 and distance < 420:
                self.stage, self.stage_tick = "carry", tick
                self.carry_touches = 1
                self.trace(player, self.move, "carry-after-touch", tick)
                return self.cushion(player, ball, chase_direction(player, ball), distance, goal)
            if tick - self.stage_tick > 95 or (not free and distance > 365):
                self.cancel(tick, retry=65)
                return None
            contact = chase_direction(player, ball)
            wheel_direction = unit(offset if distance < 220 else contact)
            desired_up = scale(wheel_direction, -1)
            tangent = sub(goal, scale(wheel_direction, dot(goal, wheel_direction)))
            # First gain the required closing speed, then use a consistent roll
            # to present the wheels while momentum carries the car to the ball.
            desired = contact if distance > 340 else tangent
            attitude = air_controls(player, desired, desired_up)
            if distance <= 340 and dot(desired_up, up) < -.82 and abs(dot(desired_up, left)) < .20:
                attitude["roll"] = self.reset_roll
            relative_speed = sub(vector(player.physics.velocity), vector(ball.velocity))
            closing = dot(relative_speed, wheel_direction)
            return dict(attitude, jump=False, throttle=1,
                        boost=distance > 260 and closing < 1050 and dot(front, wheel_direction) > .80)
        if self.stage == "reset-pop-align":
            if not flip_available(player) or tick - self.stage_tick > 42 or distance > 340:
                self.cancel(tick)
                return None
            intercept = unit(sub(ball_path(ball, .09), vector(player.physics.location)))
            aim = unit(add(intercept, (0, 0, .13)))
            forward, sideways = dot(aim, front), dot(aim, left)
            if (tick - self.stage_tick >= 4 and distance <= 212
                    and abs(dot(intercept, up)) < .73 and forward > .48 and dot(unit(offset), aim) > .58):
                self.stage, self.stage_tick = "reset-pop-follow", tick
                self.trace(player, self.move, "pop-command", tick)
                return dict(jump=True, pitch=-max(.62, forward), yaw=clip(sideways * 1.35), roll=0,
                            boost=forward > .76, throttle=1)
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        boost=distance > 220 and forward > .89)
        if self.stage == "reset-pop-follow":
            elapsed = tick - self.stage_tick
            if touched > self.touch:
                self.touch = touched
                self.trace(player, self.move, "pop-contact", tick)
                if self.backboard_time(ball, attack) is not None and player.boost >= 28:
                    self.stage = "read-board"
                    return self.double_tap(player, ball, attack, tick)
                if (free and player.boost >= 27
                        and ball.location.z > 695 and offset[2] > 58 and not reset_available(player)):
                    self.stage, self.stage_tick, self.was_reset = "second", tick, False
                    self.reset_count = 1
                    return dict(jump=False, boost=False)
                self.stage, self.stage_tick = "carry", tick
                self.carry_touches = 1
                return self.cushion(player, ball, chase_direction(player, ball), distance, goal)
            if elapsed > 50 or distance > 550:
                if distance < 490 and player.boost >= 8:
                    self.stage, self.stage_tick = "carry", tick
                    return self.cushion(player, ball, chase_direction(player, ball), distance, goal)
                self.cancel(tick, retry=75)
                return None
            aim = chase_direction(player, ball, (0, 0, -28))
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        boost=elapsed >= 8 and distance > 145 and dot(front, unit(aim)) > .82)
        return self.double_tap(player, ball, attack, tick)

    def dribble_start(self, player, ball, opponents, attack, front, offset, distance, free, tick):
        if player.air_state != AirState.OnGround or player.physics.location.z > 46:
            return
        relative = sub(vector(player.physics.velocity), vector(ball.velocity))
        roof = (128 < ball.location.z < 185 and math.hypot(offset[0], offset[1]) < 67
                and abs(ball.velocity.z) < 170 and math.hypot(*relative) < 425
                and front[1] * attack > .56)
        if roof:
            nearest = min((math.hypot(*sub(vector(enemy.physics.location), vector(ball.location)))
                           for enemy in opponents), default=2500)
            if free and player.boost >= 27 and attack * ball.location.y < 2930 and nearest > 1120:
                self.begin("ground-to-air", "pop", player, tick)
                return
            if 250 < nearest and attack * ball.location.y > -700:
                lateral = -ball.location.x * .24
                # For a defender ahead, flick toward the less occupied side.
                for enemy in opponents:
                    ep = enemy.physics.location
                    if 0 < attack * (ep.y - ball.location.y) < 1350 and abs(ep.x - ball.location.x) < 800:
                        lateral -= (ep.x - ball.location.x) * .48
                self.flick_side = math.copysign(1, lateral * attack) if abs(lateral) > 105 else 0
                self.flick_delay = 26 if nearest > 1050 and attack * ball.location.y < 3600 else 16
                variation = ("delayed-" if self.flick_delay == 26 else "") + ("45-flick" if self.flick_side else "flick")
                self.begin(variation, "flick-lift", player, tick)
                return
        ground_delta = (offset[0], offset[1], 0)
        if (free and player.boost >= 31 and 95 < ball.location.z < 245 and 145 < distance < 345
                and offset[2] > 69 and front[1] * attack > .55
                and dot(front, unit(ground_delta)) > .88
                and (dot(relative, unit(ground_delta)) > 95 or 120 < ball.velocity.z < 650)
                and -320 < ball.velocity.z < 650):
            self.begin("ground-to-air", "pop-approach", player, tick)

    def dribble_launch(self, player, ball, offset, distance, free, tick):
        elapsed = tick - self.stage_tick
        front, left, _ = basis(player.physics.rotation)
        if self.stage == "flick-lift":
            if elapsed > self.flick_delay + 24 or distance > 205:
                self.cancel(tick)
                return None
            if elapsed < 11:
                return dict(jump=True, boost=False, pitch=.18, throttle=.55)
            if elapsed >= self.flick_delay and flip_available(player) and 45 < offset[2] < 154:
                strength = -.72 if self.flick_side else -.96
                changes = self.fire(player, tick)
                return dict(changes, pitch=strength, yaw=.72 * self.flick_side, boost=False)
            return dict(jump=False, boost=False, pitch=.12,
                        yaw=.80 * self.flick_side if elapsed < self.flick_delay else 0)
        if self.stage == "pop-approach":
            if not free or elapsed > 45 or distance > 390:
                self.cancel(tick)
                return None
            aim = chase_direction(player, ball, (0, 0, -60))
            if math.hypot(offset[0], offset[1]) > 145 or abs(dot(aim, left)) > 65:
                error = math.atan2(dot(aim, left), dot(aim, front))
                return dict(throttle=.82, steer=clip(error * 3.2), boost=False, jump=False)
            self.stage, self.stage_tick = "pop", tick
            elapsed = 0
        if self.stage == "pop":
            if elapsed < 11:
                return dict(jump=True, boost=False, pitch=.12, throttle=.82)
            if elapsed <= 16:
                return dict(jump=False, boost=False, pitch=0, yaw=0, roll=0)
            if (flip_available(player) and offset[2] > 54 and distance < 186
                    and math.hypot(offset[0], offset[1]) < 115):
                self.stage, self.stage_tick = "pop-follow", tick
                return dict(jump=True, boost=False, pitch=0, yaw=0, roll=0)
            if player.air_state == AirState.InAir and (touch_id(player) > self.touch or elapsed <= 27):
                if touch_id(player) <= self.touch:
                    return dict(jump=False, boost=False, pitch=0, yaw=0, roll=0)
            else:
                self.cancel(tick)
                return None
        if self.stage == "pop-follow" and touch_id(player) <= self.touch:
            if elapsed > 28 or distance > 340:
                self.cancel(tick)
                return None
            aim = chase_direction(player, ball, (0, 0, -28))
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        boost=elapsed > 7 and distance > 158 and dot(front, unit(aim)) > .90)
        if touch_id(player) > self.touch and player.air_state == AirState.InAir:
            self.stage, self.stage_tick = "carry", tick
        else:
            self.cancel(tick)
        return None

    def update(self, packet, index, wanted):
        player = packet.players[index]
        ball = packet.balls[0].physics
        tick = packet.match_info.frame_num
        self.match_seconds = getattr(packet.match_info, "seconds_elapsed", -2)
        attack = 1 if player.team == 0 else -1
        position = vector(player.physics.location)
        target = vector(ball.location)
        offset = sub(target, position)
        distance = math.hypot(*offset)
        front, _, up = basis(player.physics.rotation)
        touched = touch_id(player)
        if self.pending_shot:
            move, expiry, old_touch = self.pending_shot
            if tick > expiry or touched > old_touch:
                if touched > old_touch:
                    self.trace(player, move, "on-target" if on_target(ball, player.team) else "contact", tick)
                self.pending_shot = None
                if (touched > old_touch and move == "ceiling-musty" and player.boost >= 32
                        and self.backboard_time(ball, attack) is not None):
                    self.begin("double-tap", "read-board", player, tick)

        teammates = [other for i, other in enumerate(packet.players)
                     if i != index and other.team == player.team and other.demolished_timeout <= 0]
        opponents = [other for other in packet.players
                     if other.team != player.team and other.demolished_timeout <= 0]
        tactical = self.tactical_move(player, ball, teammates, opponents, attack, tick)
        if tactical is not None:
            return tactical
        cover = any(attack * (position[1] - other.physics.location.y) > 325 for other in teammates)
        competing = any(math.hypot(*sub(target, vector(other.physics.location))) < distance + (160 if not other.is_bot else -100)
                        and (not other.is_bot or other.air_state != AirState.OnGround) for other in teammates)
        if (not teammates or (not cover and not self.move) or (competing and not self.move) or attack * target[1] < -1550 or (abs(target[1]) > 4650 and self.move not in ("double-tap", "ceiling-reset-double-tap", "first-touch-reset-pop"))
                or (player.boost < 8 and not self.move) or distance > 1680):
            if self.move:
                self.cancel(tick)
            return None

        free = all(math.hypot(*sub(target, vector(other.physics.location))) > 820 for other in opponents)
        if not self.move:
            if tick < self.next_attempt or player.boost < 14:
                return None
            self.dribble_start(player, ball, opponents, attack, front, offset, distance, free, tick)
            wall_gap = 4096 - abs(target[0])
            wall_pinch = (wall_gap < 185 and target[2] > 150 and offset[0] * target[0] > 0
                          and abs(offset[0]) > 42)
            wall_side = math.copysign(1, target[0])
            reflected_goal = (wall_side * (8192 - 93), attack * 5120, 210)
            kuxir = wall_pinch and 450 < attack * target[1] < 2450 and dot(front, unit(sub(reflected_goal, target))) > .90
            ground_pinch = (target[2] < 115 and offset[2] < -65 and front[2] < -.30
                            and player.physics.velocity.z < -250)
            if (not self.move and player.air_state == AirState.InAir and 130 < distance < 285 and flip_available(player)
                    and not wanted.jump and attack * target[1] > -450
                    and attack * offset[1] > 25 and dot(front, unit(offset)) > .65
                    and (wall_pinch or ground_pinch)):
                self.begin("kuxir-pinch" if kuxir
                           else "wall-pinch" if wall_pinch else "ground-pinch", "pinch", player, tick)
            wall_route = (player.air_state == AirState.OnGround and abs(position[0]) > 3810
                          and position[2] > 820 and front[2] > .58 and wanted.throttle > .4)
            ceiling = position[2] > 1850 and player.air_state == AirState.OnGround and up[2] < -.6
            if not self.move and (ceiling or wall_route) and 535 < target[2] < 1870 and distance < 1480:
                kind = ("ceiling-musty" if ceiling and player.boost >= 48 and free
                        and 980 < target[2] < 1550 and attack * offset[1] > 230 else "ceiling-shot")
                self.begin(kind, "ceiling" if ceiling else "climb", player, tick)
            elif not self.move and player.air_state == AirState.InAir and 330 < target[2] < 1620 and position[2] > 265 and distance < 620:
                ball_speed = vector(ball.velocity)
                if (player.boost >= 42
                        and free and 2200 < attack * target[1] < 4200
                        and (0 <= getattr(packet.match_info, "seconds_elapsed", -2) - touched < .8 and touched >= 0)
                        and self.backboard_time(ball, attack) is not None):
                    self.begin("double-tap", "read-board", player, tick)
                elif (player.boost >= 42 and free
                      and 245 < distance < 580 and 75 < offset[2] < 335 and not reset_available(player)
                      and dot(front, unit(offset)) > .68 and attack * offset[1] > -75
                      and all(touch_id(other) <= touched or self.match_seconds - touch_id(other) > .42
                              for other in teammates + opponents)):
                    self.begin("first-touch-reset-pop", "reset-pop-approach", player, tick)
                    self.reset_roll = 1 if offset[0] >= 0 else -1
                elif (distance < 330 and free
                      and (receiver := self.aerial_receiver(player, ball, teammates, opponents, attack))):
                    self.begin("aerial-pass", "pass", player, tick)
                    self.receiver = receiver
                elif (free and distance < 520 and -40 < offset[2] < 195
                      and abs(attack * target[1]) < 3600 and dot(front, unit(offset)) > .52
                      and math.hypot(*ball_speed) < 1250
                      and dot(sub(vector(player.physics.velocity), ball_speed), unit(offset)) < max(265, (distance - 120) * 2.5)):
                    zen = offset[2] > 50
                    self.begin("zen-touch" if zen else "soft-touch", "cushion", player, tick)
                elif (player.boost >= 56
                        and target[2] > 940 and offset[2] > 40 and not reset_available(player)):
                    self.begin("double-reset", "approach", player, tick)
                elif offset[2] > 70 and not reset_available(player):
                    self.begin("flip-reset", "approach", player, tick)
                elif flip_available(player) and distance < 330 and attack * offset[1] > 60:
                    self.begin("musty", "windup", player, tick)
            if not self.move:
                return None

        if self.stage in ("pop-approach", "pop", "pop-follow", "flick-lift"):
            launch = self.dribble_launch(player, ball, offset, distance, free, tick)
            if launch is not None or not self.move:
                return launch
        if tick - self.started > 210 or (position[2] < 115 and self.move != "ground-to-air"):
            self.cancel(tick)
            return None
        goal_direction = unit(sub((0, attack * 5120, 260), target))
        direction = chase_direction(player, ball)
        upright = (0, 0, 1)
        if (self.move == "first-touch-reset-pop"
                and self.stage not in ("carry", "bump", "second", "finish", "windup")):
            if any(touch_id(other) > self.touch and touch_id(other) > touched for other in teammates + opponents):
                self.cancel(tick)
                return None
            return self.reset_pop(player, ball, offset, distance, goal_direction, tick, free)
        if self.stage == "pinch":
            if not flip_available(player) or tick - self.stage_tick > 30 or distance > 340:
                self.cancel(tick)
                return None
            aim = chase_direction(player, ball)
            if tick - self.stage_tick >= 3 and distance < 182 and dot(front, unit(offset)) > .74:
                return self.fire(player, tick)
            return dict(air_controls(player, aim, upright), jump=False, boost=distance > 200
                        and dot(front, unit(aim)) > .91)
        if self.stage == "pass":
            if touched > self.touch:
                self.trace(player, self.move, "contact", tick)
                self.cancel(tick)
                return None
            if distance > 530 or tick - self.started > 60:
                self.cancel(tick)
                return None
            lane = unit(sub(self.receiver, target))
            approach = sub(direction, scale(lane, 85))
            return dict(air_controls(player, approach, upright), jump=False,
                        boost=dot(front, unit(approach)) > .88 and dot(unit(offset), lane) > .57)

        if self.stage in ("cushion", "carry"):
            if touched > self.touch:
                self.carry_touches += 1
                self.touch = touched
                self.stage, self.stage_tick = "carry", tick
                self.trace(player, self.move, "controlled-contact", tick)
                if self.move == "ground-to-air" and player.boost >= 27:
                    if self.backboard_time(ball, attack) is not None:
                        self.move, self.stage = "double-tap", "read-board"
                        return self.double_tap(player, ball, attack, tick)
                    if (free and offset[2] > 75 and target[2] > 475 and distance < 330
                            and not reset_available(player)):
                        self.move, self.stage = "flip-reset", "approach"
                        self.was_reset = False
                        return dict(jump=False, boost=False)
            intercepted = any(touch_id(other) > self.touch for other in teammates + opponents)
            if (intercepted or (not free and self.carry_touches == 0 and distance > 380) or distance > 760 or tick - self.stage_tick > 94
                    or self.carry_touches >= 4 or (position[2] < 145 and self.move != "ground-to-air")):
                self.cancel(tick)
                return None
            if self.stage == "carry" and self.carry_touches > 0 and tick - self.stage_tick >= 4:
                if (player.boost > 18 and self.backboard_time(ball, attack) is not None
                        and attack * target[1] > 2250 and distance < 740):
                    self.move, self.stage = "double-tap", "read-board"
                    return self.double_tap(player, ball, attack, tick)
                if (flip_available(player) and 115 < distance < 205 and 2050 < attack * target[1] < 4875
                        and dot(unit(offset), goal_direction) > .77 and dot(front, unit(offset)) > .76
                        and not on_target(ball, player.team)):
                    return self.fire(player, tick)
                if not free and distance < 285 and dot(front, unit(offset)) > .75 and not on_target(ball, player.team):
                    # Meet the defender through the ball when the carry window closes.
                    aim = chase_direction(player, ball)
                    return dict(air_controls(player, aim, upright), jump=False, boost=distance > 165)
            if (self.carry_touches > 0
                    and on_target(ball, player.team) and player.boost >= 30):
                for defender in opponents:
                    gap = sub(vector(defender.physics.location), position)
                    if 150 < math.hypot(*gap) < 500 and dot(front, unit(gap)) > .88 and abs(gap[2]) < 215:
                        self.stage, self.stage_tick = "bump", tick
                        self.receiver = add(vector(defender.physics.location), scale(vector(defender.physics.velocity), .16))
                        break
            return self.cushion(player, ball, direction, distance, goal_direction)
        if self.stage == "bump":
            if tick - self.stage_tick > 32 or not on_target(ball, player.team):
                self.cancel(tick)
                return None
            aim = sub(self.receiver, position)
            return dict(air_controls(player, aim, upright), jump=False, boost=dot(front, unit(aim)) > .82)

        if self.move == "double-tap":
            return self.double_tap(player, ball, attack, tick)

        if self.stage == "climb":
            if position[2] >= 1850 and up[2] < -.5:
                self.stage = "ceiling"
            elif player.air_state == AirState.OnGround and abs(position[0]) > 3700:
                return dict(jump=False, throttle=1, boost=front[2] > .65)
            else:
                self.cancel(tick)
                return None
        if self.stage == "ceiling":
            if player.air_state == AirState.OnGround:
                ceiling_direction = chase_direction(player, ball)
                tangent = unit((ceiling_direction[0], ceiling_direction[1], 0))
                _, left, _ = basis(player.physics.rotation)
                return dict(jump=False, boost=False, throttle=.48, steer=clip(dot(left, tangent) * 1.55))
            if not flip_available(player):
                self.cancel(tick)
                return None
            self.stage = "windup" if self.move == "ceiling-musty" else "finish"
            self.stage_tick = tick

        if self.stage in ("approach", "second"):
            has_reset = reset_available(player)
            new_reset = has_reset and not self.was_reset and touched > self.touch and distance < 235
            self.was_reset = has_reset
            if new_reset:
                self.reset_count += 1
                self.touch = touched
                self.trace(player, self.move, f"reset-{self.reset_count}", tick)
                self.stage_tick = tick
                opening = 2250 < attack * target[1] < 4550 and abs(target[0]) < 1800
                if (self.move == "first-touch-reset-pop" and self.reset_count > 1 and opening
                        and front[2] > .20 and distance < 280):
                    self.stage = "windup"
                else:
                    self.stage = "spend" if self.move == "double-reset" and self.reset_count == 1 else "finish"
                return dict(jump=False, boost=False)
            direction_to_ball = unit(direction)
            # Wheels face the contact. The nose stays tangent to the ball.
            desired_up = scale(direction_to_ball, -1)
            tangent = sub(goal_direction, scale(direction_to_ball, dot(goal_direction, direction_to_ball)))
            desired = direction if distance > 255 else tangent
            return dict(air_controls(player, desired, desired_up), jump=False,
                        boost=distance > 205 and dot(front, direction_to_ball) > .78)

        if self.stage == "spend":
            if tick - self.stage_tick < 4:
                return dict(jump=False, boost=False)
            if not flip_available(player) or distance > 350:
                self.cancel(tick)
                return None
            self.stage, self.stage_tick, self.was_reset = "recover", tick, True
            return dict(jump=True, pitch=0, yaw=0, roll=0, boost=False)

        if self.stage == "recover":
            if tick - self.stage_tick < 10 or reset_available(player):
                return dict(air_controls(player, direction, upright), jump=False, boost=False)
            self.stage, self.was_reset, self.touch = "second", False, touched
            return dict(jump=False, boost=False)

        if self.stage == "windup":
            if not flip_available(player):
                self.cancel(tick)
                return None
            if (tick - self.stage_tick >= 8 and self.release_tick is not None
                    and tick - self.release_tick >= 3 and 0.25 <= front[2] <= .83 and distance <= 195
                    and dot(unit(offset), goal_direction) > .35):
                return self.fire(player, tick, backwards=True)
            if self.release_tick is None:
                self.release_tick = tick
            return dict(air_controls(player, add(goal_direction, (0, 0, 1.45)), upright),
                        jump=False, boost=distance > 155 and dot(front, unit(offset)) > .8)

        if not flip_available(player):
            if distance < 380 and player.air_state == AirState.InAir and tick - self.stage_tick < 60:
                self.stage, self.stage_tick = "carry", tick
                self.carry_touches = 1 if touched >= 0 else 0
                return self.cushion(player, ball, direction, distance, goal_direction)
            self.cancel(tick, retry=90)
            return None
        if (self.release_tick is not None and tick - self.release_tick >= 3 and distance <= 195
                and dot(front, unit(offset)) > .62 and dot(unit(offset), goal_direction) > .42):
            return self.fire(player, tick)
        if self.release_tick is None:
            self.release_tick = tick
        return dict(air_controls(player, direction, upright), jump=False,
                    boost=distance > 140 and dot(front, unit(offset)) > .77)
