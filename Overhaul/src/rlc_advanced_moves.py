"""Bounded aerial sequences used on top of the Hub's native policy."""
from contextvars import ContextVar
import math
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from typing import NamedTuple

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


def aerial_axis(error, rate, gain, damping, stop_acceleration):
    # Estimate how far the car will still rotate while arresting its angular rate.
    stopping_angle = rate * abs(rate) / (2 * stop_acceleration)
    stopping_angle = max(-.32, min(.32, stopping_angle))
    precision = max(0, 1 - abs(error) / .65)
    return clip(gain * (error - precision * stopping_angle) - damping * rate)


def air_controls(player, direction, desired_up):
    front, left, up = basis(player.physics.rotation)
    direction, desired_up = unit(direction), unit(desired_up)
    angular = vector(player.physics.angular_velocity)
    vertical, lateral = dot(direction, up), dot(direction, left)
    forward = dot(direction, front)
    transverse = math.hypot(vertical, lateral)
    if transverse > 1e-5:
        turn = math.atan2(transverse, forward)
        pitch, yaw = turn * vertical / transverse, turn * lateral / transverse
    else:
        pitch, yaw = 0.0, math.pi if forward < 0 else 0.0
    roof_side, roof_up = dot(desired_up, left), dot(desired_up, up)
    # With the roof target nearly parallel to the nose, the roll angle is
    # poorly determined. Keep angular braking but fade the position command.
    roll_weight = min(1, math.hypot(roof_side, roof_up) / .40)
    roll = math.atan2(roof_side, roof_up) * roll_weight
    return dict(
        pitch=aerial_axis(pitch, -dot(angular, left), 2.8, .18, 11),
        yaw=aerial_axis(yaw, dot(angular, up), 2.8, .18, 8),
        roll=aerial_axis(roll, -dot(angular, front), 2.2, .18, 22),
    )


def cross(a, b):
    return a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]


def contact_hitbox(player):
    box = getattr(player, "hitbox", None)
    offset = getattr(player, "hitbox_offset", None)
    if box is None or offset is None:
        return None
    size = (box.length, box.width, box.height)
    center = vector(offset)
    if all(15 <= dimension <= 180 for dimension in size) and all(abs(v) <= 65 for v in center):
        return size, center
    return None


def box_contact_offset(normal, axes, hitbox):
    size, center = hitbox
    # Intersect a ray from the hitbox center with the closest face. A
    # support corner would overestimate the reach on a diagonal approach.
    reach = min(length / (2 * abs(dot(normal, axis))) for length, axis in zip(size, axes)
                if abs(dot(normal, axis)) > 1e-6)
    offset = (0, 0, 0)
    for coordinate, axis in zip(center, axes):
        offset = add(offset, scale(axis, coordinate))
    return add(offset, scale(normal, 92.75 + reach))


def load_contact_sim():
    if "RocketSim" in sys.modules:
        return sys.modules["RocketSim"]
    roaming = os.environ.get("APPDATA")
    if not roaming and not (os.environ.get("RLCAREER_RIPPLE") and os.environ.get("RLCAREER_RIPPLE_DEPS")):
        return None
    root = Path(roaming or ".") / "rl-career-hub" / "rlbot"
    deps = Path(os.environ.get("RLCAREER_RIPPLE_DEPS", root / "ripple-deps"))
    source = Path(os.environ.get("RLCAREER_RIPPLE", root / "ripple-upstream")) / "src"
    if not (deps / "RocketSim.pyd").is_file() or not all(
            (source / "collision_meshes" / "soccar" / f"mesh_{i}.cmf").is_file() for i in range(16)):
        return None
    sys.path.insert(0, str(deps.resolve()))
    try:
        import RocketSim
        meshes = str((source / "collision_meshes").resolve())
        if meshes.isascii():
            RocketSim.init(meshes)
        else:
            # The bundled Windows build needs a relative path on Unicode profiles.
            original_directory = Path.cwd()
            try:
                os.chdir(source)
                RocketSim.init("collision_meshes")
            finally:
                os.chdir(original_directory)
        return RocketSim
    except (OSError, RuntimeError, ValueError):
        sys.modules.pop("RocketSim", None)
        raise
    finally:
        sys.path.pop(0)


class ContactCandidate(NamedTuple):
    score: float
    target: tuple
    car: tuple
    normal: tuple
    horizon: float
    outgoing: tuple
    margin: float
    offset: tuple
    index: int


class ContactSimulation:
    """A short, local one-car rollout. The live match remains authoritative."""

    def __init__(self):
        self.enabled = os.environ.get("RLC_DISABLE_CONTACT_SIM") != "1"
        self.next_frame = 0
        self.shape = None
        self.selection = None
        self.plan = None

    def find_contact(self, player, ball, lead, preferred, radial, carry, frame):
        position = vector(ball.location)
        velocity = vector(ball.velocity)
        cached = self.plan
        if cached is not None:
            last_frame, previous_position, previous_velocity, normal_wanted, was_carrying, result = cached
            elapsed = (frame-last_frame) / 120
            if (0 <= frame-last_frame < 6 and was_carrying == carry and dot(preferred, normal_wanted) > .90
                    and math.dist(position, add(previous_position, scale(previous_velocity, elapsed))) < 28
                    and math.dist(velocity, previous_velocity) < 180):
                _, _, normal, horizon, outgoing, margin, offset = result
                horizon = max(.065, horizon - elapsed)
                target = ball_path(ball, horizon)
                current_velocity = vector(player.physics.velocity)
                current_position = vector(player.physics.location)
                front, _, _ = basis(player.physics.rotation)
                boost_time = min(horizon, player.boost / 33.3)
                closing = dot(sub(current_velocity, velocity), normal)
                boost = 880 * boost_time * (horizon-.5*boost_time) if closing < (385 if carry else 295) else 0
                projected = add(current_position, add(scale(current_velocity, horizon),
                                                       add(scale(front, boost), (0, 0, -325*horizon**2))))
                return target, projected, normal, horizon, outgoing, margin, offset
        result = plan_aerial_contact(player, ball, lead, preferred, radial, carry, self, frame, with_offset=True)
        self.plan = frame, position, velocity, preferred, carry, result
        return result

    def prepare(self, shape):
        if getattr(self, "rs", None) is None:
            self.rs = load_contact_sim()
        if self.rs is None:
            self.enabled = False
            return False
        if shape != self.shape:
            rs = self.rs
            size, center = shape
            configs = (rs.CarConfig.OCTANE, rs.CarConfig.DOMINUS, rs.CarConfig.BREAKOUT,
                       rs.CarConfig.PLANK, rs.CarConfig.MERC, rs.CarConfig.HYBRID)
            config = min((rs.CarConfig(preset) for preset in configs),
                         key=lambda preset: math.dist(size + center,
                                                      preset.hitbox_size.as_tuple() + preset.hitbox_pos_offset.as_tuple()))
            config.hitbox_size, config.hitbox_pos_offset = rs.Vec(*size), rs.Vec(*center)
            self.arena = rs.Arena(rs.GameMode.SOCCAR)
            self.car = self.arena.add_car(rs.Team.BLUE, config)
            self.shape = shape
        return True

    def rollout(self, player, ball, normal, horizon, speed_limit, shape):
        rs = self.rs
        physics = player.physics
        start = rs.CarState()
        start.pos, start.vel = rs.Vec(*vector(physics.location)), rs.Vec(*vector(physics.velocity))
        start.ang_vel = rs.Vec(*vector(physics.angular_velocity))
        start.rot_mat = rs.RotMat(*(rs.Vec(*axis) for axis in basis(physics.rotation)))
        start.boost, start.is_on_ground = player.boost, False
        initial = rs.BallState()
        initial.pos, initial.vel = rs.Vec(*vector(ball.location)), rs.Vec(*vector(ball.velocity))
        spin = getattr(ball, "angular_velocity", None)
        if spin is not None:
            initial.ang_vel = rs.Vec(*vector(spin))
        self.arena.ball.set_state(initial)
        self.car.set_state(start)
        ticks = round(horizon * 120)
        for step in range(0, ticks, 6):
            state = self.car.get_state()
            predicted = self.arena.ball.get_state()
            axes = state.rot_mat
            forward = axes.forward.as_tuple()
            dt = min(.10, (ticks-step)/120)
            offset = box_contact_offset(normal, (forward, axes.right.as_tuple(), axes.up.as_tuple()), shape)
            error = sub(add(predicted.pos.as_tuple(), scale(predicted.vel.as_tuple(), dt)),
                        add(offset, add(state.pos.as_tuple(), scale(state.vel.as_tuple(), dt))))
            if math.hypot(*error) < 10:
                error = normal
            direction = unit(add(error, scale(normal, 40)))
            angle = axes.as_angle()
            simulated = SimpleNamespace(physics=SimpleNamespace(rotation=angle, angular_velocity=state.ang_vel))
            attitude = air_controls(simulated, direction, (0, 0, 1))
            closing = dot(sub(state.vel.as_tuple(), predicted.vel.as_tuple()), normal)
            self.car.set_controls(rs.CarControls(
                **attitude, throttle=-.75 if closing > speed_limit else .50,
                boost=closing < speed_limit and dot(forward, direction) > .78))
            self.arena.step(min(6, ticks-step))
            result = self.arena.ball.get_state()
            if result.last_hit_car_id == self.car.id:
                state = self.car.get_state()
                velocity = result.vel.as_tuple()
                gap = math.hypot(*add(sub(result.pos.as_tuple(), state.pos.as_tuple()),
                                      scale(sub(velocity, state.vel.as_tuple()), .24)))
                return gap, velocity
            if self.car.get_state().has_world_contact:
                break
        return None

    def rank(self, ranked, player, ball, shape, carry, frame):
        if not self.enabled or shape is None or player.air_state != AirState.InAir:
            return ranked[0]
        if frame < self.next_frame:
            if self.selection is not None and self.selection[0] is carry:
                _, choice = self.selection
                for candidate in ranked:
                    if candidate.index == choice and candidate.score < ranked[0].score + 35:
                        return candidate
            return ranked[0]
        self.next_frame = frame + 12
        self.selection = None
        try:
            if self.prepare(shape):
                best = None
                for candidate in ranked[:3]:
                    if candidate.score > ranked[0].score + 35:
                        break
                    result = self.rollout(player, ball, candidate.normal, candidate.horizon,
                                          385 if carry else 295, shape)
                    if result is None:
                        continue
                    gap, velocity = result
                    if gap > (310 if carry else 340) or dot(velocity, candidate.normal) < -150:
                        continue
                    score = candidate.score + .75 * gap
                    if best is None or score < best[0]:
                        best = score, candidate, velocity
                if best is not None:
                    _, candidate, velocity = best
                    self.selection = carry, candidate.index
                    return candidate._replace(outgoing=velocity)
        except (ImportError, OSError, RuntimeError, ValueError, TypeError, AttributeError):
            self.enabled = False
        return ranked[0]


def directional_reset_roll(player, desired_up, horizon, current_roll):
    """Compare short left/right roll inputs with the normal steering controller."""
    front, left, up = basis(player.physics.rotation)
    rate = dot(vector(player.physics.angular_velocity), front)
    if dot(up, desired_up) > .82 or horizon < .12:
        return current_roll
    elapsed = min(.20, horizon)
    def score(command):
        # Positive game roll rotates the roof toward the car's left.
        turn = -rate*elapsed + 11*command*elapsed**2
        roof = add(scale(up, math.cos(turn)), scale(left, math.sin(turn)))
        remaining_rate = rate - 22*command*elapsed
        return dot(roof, desired_up) - .028*abs(remaining_rate) - .025*abs(command-current_roll)
    return max((current_roll, -.84, .84), key=score)


def reset_orientation(player, desired_forward, desired_up, roll_side):
    front, left, up = basis(player.physics.rotation)
    target_up = unit(desired_up)
    target_front = unit(sub(desired_forward, scale(target_up, dot(desired_forward, target_up))))
    if math.hypot(*target_front) < .1:
        target_front = unit(sub(front, scale(target_up, dot(front, target_up))))
    if math.hypot(*target_front) < .1:
        target_front = unit(sub(left, scale(target_up, dot(left, target_up))))
    target_left = cross(target_up, target_front)
    error = scale(add(add(cross(front, target_front), cross(left, target_left)), cross(up, target_up)), .5)
    sine = math.hypot(*error)
    cosine = clip(.5*(dot(front, target_front) + dot(left, target_left) + dot(up, target_up) - 1))
    angle = math.atan2(sine, cosine)
    if cosine < -.95 and sine < .08:
        # The skew term vanishes at a half-turn. Recover its axis from
        # the basis pair that changes least, then choose a stable sign.
        axis = unit(max((add(front, target_front), add(left, target_left), add(up, target_up)),
                        key=lambda axis: math.hypot(*axis)))
        sign = dot(axis, error) if sine > .01 else dot(axis, scale(front, -roll_side))
        error = scale(axis, math.copysign(angle, sign))
    elif sine > 1e-6:
        error = scale(error, angle / sine)
    angular = vector(player.physics.angular_velocity)
    return dict(pitch=aerial_axis(-dot(error, left), -dot(angular, left), 4.7, .30, 11),
                yaw=aerial_axis(dot(error, up), dot(angular, up), 4.7, .28, 8),
                roll=aerial_axis(-dot(error, front), -dot(angular, front), 4.7, .32, 22))


def goal_lane(origin, ball_velocity, attack, opponents, height=250):
    best = None
    for x in (0, -365, 365, -635, 635):
        target = (x, attack * 5120, height)
        delta = sub(target, origin)
        length = max(1, math.hypot(*delta))
        route = unit(delta)
        clearance = 1450
        for opponent in opponents:
            pos = vector(opponent.physics.location)
            fraction = dot(sub(pos, origin), route) / length
            if not -.04 < fraction < 1.10:
                continue
            lead = min(.46, max(0, fraction * length / 1900))
            projected = add(pos, scale(vector(opponent.physics.velocity), lead))
            gap = sub(projected, origin)
            clearance = min(clearance, math.hypot(*sub(gap, scale(route, dot(gap, route)))))
        route_score = min(850, clearance) - .20 * abs(x) - .095 * abs(ball_velocity[0] - route[0] * 1000)
        if best is None or route_score > best[0]:
            best = route_score, route, clearance
    return best[1], best[2]


def shot_normal(route, ball_velocity, speed=1750):
    # Aim the impulse, allowing for some momentum retained by the ball.
    drift = sub(ball_velocity, scale(route, dot(ball_velocity, route)))
    correction = scale(drift, .27)
    if math.hypot(*correction) > 430:
        correction = scale(unit(correction), 430)
    return unit(sub(scale(route, speed), correction))


def ceiling_time(ball):
    height = 1955 - ball.location.z
    velocity = ball.velocity.z
    discriminant = velocity ** 2 - 1300 * height
    if velocity <= 0 or discriminant < 0:
        return None
    return max(0, (velocity - math.sqrt(discriminant)) / 650)


def ceiling_opening(ball, climbing=False):
    # Evaluate the ball after the time required to climb or leave the ceiling.
    times = (.35, .55, .72) if climbing else (.12, .25, .40)
    return any(abs(x) < 3225 and abs(y) < 4440 and 1380 < z < 1925
               for x, y, z in (ball_path(ball, t) for t in times))


ball_forecast = ContextVar("ball_forecast", default=None)


def native_ball_position(ball, seconds):
    forecast = ball_forecast.get()
    if forecast is None or forecast[0] is not ball or seconds < 0:
        return None
    _, now, slices = forecast
    at = now + seconds
    if not slices or at < slices[0].game_seconds or at > slices[-1].game_seconds:
        return None
    # Binary search also supports predictions whose slice spacing varies.
    low, high = 0, len(slices) - 1
    while high - low > 1:
        mid = (low + high) // 2
        if slices[mid].game_seconds <= at:
            low = mid
        else:
            high = mid
    before, after = slices[low], slices[high]
    span = after.game_seconds - before.game_seconds
    origin = vector(before.physics.location)
    if span <= 0:
        return origin
    return add(origin, scale(sub(vector(after.physics.location), origin), (at - before.game_seconds) / span))


def aerial_contact_prediction(player, ball, nominal, contact_offset):
    position = vector(player.physics.location)
    velocity = vector(player.physics.velocity)
    # Compare both objects at the same candidate times. Penalize corrections
    # that need more acceleration than the car has time to apply.
    candidates = (nominal,) if ball_forecast.get() is None else tuple(
        max(.065, min(.48, nominal + delta)) for delta in (0, -.085, -.045, .045, .10))
    front, _, _ = basis(player.physics.rotation)
    acceleration = 880 if player.boost >= 7 else 105
    best = None
    for seconds in candidates:
        target = ball_path(ball, seconds)
        car = add(position, add(scale(velocity, seconds), (0, 0, -325 * seconds ** 2)))
        error = sub(sub(target, contact_offset), car)
        correction = math.hypot(*error)
        # Forward thrust cannot correct a lateral miss at full strength.
        alignment = max(0, dot(front, unit(error)))
        budget = .5 * acceleration * seconds ** 2 * (.35 + .65 * alignment)
        score = max(0, correction - budget) + .15 * correction + 140 * abs(seconds - nominal)
        if best is None or score < best[0]:
            best = score, target, car
    return best[1], best[2]


def plan_aerial_contact(player, ball, nominal, preferred, fallback, carry, simulation=None,
                        frame=0, with_offset=False):
    """Compare short, bounded approaches using the car's current momentum."""
    position = vector(player.physics.location)
    velocity = vector(player.physics.velocity)
    front, side, roof = basis(player.physics.rotation)
    shape = contact_hitbox(player)
    angular = vector(player.physics.angular_velocity)
    candidates = []
    lateral = unit(cross((0, 0, 1), preferred))
    normals = (preferred, fallback, unit(add(preferred, scale(lateral, .18))),
               unit(sub(preferred, scale(lateral, .18))))
    for delta in (0, -.045, .045, .085, .13):
        horizon = max(.065, min(.52, nominal + delta))
        target = ball_path(ball, horizon)
        ball_velocity = scale(sub(ball_path(ball, horizon + .025), target), 40)
        for normal in normals:
            offset = (box_contact_offset(normal, (front, side, roof), shape)
                      if shape else scale(normal, 126))
            contact = sub(target, offset)
            projected, speed, heading = position, velocity, front
            boost_time = min(horizon, player.boost / 33.3)
            step = horizon / 4
            for index in range(4):
                error = sub(contact, add(projected, scale(speed, step)))
                desired = unit(error)
                turn = sub(desired, scale(heading, dot(desired, heading)))
                inertia = scale(cross(angular, heading), max(0, 1-index*.35))
                heading = unit(add(heading, scale(add(scale(turn, 3.8), inertia), step)))
                aligned = dot(heading, desired)
                thrust = 880 if aligned > .82 and index*step < boost_time else 65
                relative = sub(speed, ball_velocity)
                if dot(relative, normal) > (385 if carry else 295):
                    thrust = 0
                acceleration = add(scale(heading, thrust), (0, 0, -650))
                projected = add(projected, add(scale(speed, step), scale(acceleration, .5*step**2)))
                speed = add(speed, scale(acceleration, step))
            relative = sub(speed, ball_velocity)
            closing = dot(relative, normal)
            drift = math.hypot(*sub(relative, scale(normal, closing)))
            miss = math.hypot(*sub(contact, projected))
            # Approximate followability from relative motion at contact, not absolute speed.
            score = miss + .08*drift + .14*max(0, closing-330) + 145*abs(delta)
            # Approximate the initial ball impulse, then check separation after .24 s.
            impulse = min(680, max(0, closing) * 1.35)
            outgoing = add(ball_velocity, scale(normal, impulse))
            follow_gap = math.hypot(*add(offset, scale(sub(outgoing, speed), .24)))
            score += .23 * max(0, follow_gap - (215 if carry else 250))
            if normal is fallback:
                score += 12
            candidates.append((score, target, projected, normal, speed, heading, horizon, outgoing,
                               len(candidates)))
    def refine(candidate):
        score, target, projected, normal, speed, heading, horizon, outgoing, index = candidate
        local_up = unit(sub(roof, scale(heading, dot(roof, heading))))
        if math.hypot(*local_up) < .1:
            local_up = unit(cross(heading, side))
        local_side = cross(local_up, heading)
        offset = (box_contact_offset(normal, (heading, local_side, local_up), shape)
                  if shape else scale(normal, 126))
        error = sub(sub(target, offset), projected)
        side_error = math.hypot(*sub(error, scale(normal, dot(error, normal))))
        follow = add(offset, scale(sub(outgoing, speed), .30))
        # Rank by the worst of a nominal intercept and small lateral disturbances.
        margin = max(math.hypot(*add(error, scale(local_side, offset))) for offset in (-22, 0, 22))
        score += .42*margin + .22*side_error + .25*max(0, math.hypot(*follow)-230)
        return ContactCandidate(score, target, projected, normal, horizon, outgoing, margin, offset, index)

    ranked = sorted(candidates, key=lambda candidate: candidate[0])
    ranked = sorted(map(refine, ranked[:4]), key=lambda candidate: candidate[0])
    selected = simulation.rank(ranked, player, ball, shape, carry, frame) if simulation else ranked[0]
    result = (selected.target, selected.car, selected.normal, selected.horizon, selected.outgoing, selected.margin)
    return (*result, selected.offset) if with_offset else result


def ball_path(ball, seconds):
    native = native_ball_position(ball, seconds)
    if native is not None:
        return native
    x, y, z = add(vector(ball.location), scale(vector(ball.velocity), seconds))
    z -= 325 * seconds ** 2
    if abs(x) > 4003:
        x = math.copysign(4003 - .62 * (abs(x) - 4003), x)
    if abs(y) > 5027 and (abs(x) > 800 or z > 560):
        y = math.copysign(5027 - .62 * (abs(y) - 5027), y)
    ceiling = ceiling_time(ball)
    if ceiling is not None and ceiling <= seconds:
        remaining = seconds - ceiling
        impact = ball.velocity.z - 650 * ceiling
        z = 1955 - .60 * impact * remaining - 325 * remaining ** 2
    if z < 93:
        floor = (ball.velocity.z + math.sqrt(ball.velocity.z ** 2 + 1300 * max(0, ball.location.z - 93))) / 650
        impact = 650 * floor - ball.velocity.z
        remaining = max(0, seconds - floor)
        z = 93 + max(0, .58 * impact * remaining - 325 * remaining ** 2) if impact > 180 else 93
    return x, y, z


def predicted_touch(ball, players, seconds):
    origin = vector(ball.location)
    velocity = vector(ball.velocity)
    best = None
    for other in players:
        if other.demolished_timeout > 0:
            continue
        pos = vector(other.physics.location)
        speed = vector(other.physics.velocity)
        delta = sub(origin, pos)
        relative = sub(speed, velocity)
        closing = dot(relative, unit(delta))
        if closing < 380:
            continue
        eta = (math.hypot(*delta) - 130) / closing
        if not .045 < eta < min(seconds, .46):
            continue
        contact = ball_path(ball, eta)
        other_at_contact = add(pos, scale(speed, eta))
        impact = sub(contact, other_at_contact)
        if math.hypot(*impact) > 174:
            continue
        normal = unit(impact)
        approach = dot(relative, normal)
        if approach < 220:
            continue
        launch_z = 180 if other.air_state == AirState.OnGround and contact[2] < 175 else 40
        rebound = add(velocity, add(scale(normal, min(1880, approach * 1.18)), (0, 0, launch_z)))
        state = SimpleNamespace(location=SimpleNamespace(x=contact[0], y=contact[1], z=contact[2]),
                                velocity=SimpleNamespace(x=rebound[0], y=rebound[1], z=rebound[2]))
        if best is None or eta < best[0]:
            best = eta, state
    if best is None:
        return None
    eta, state = best
    return ball_path(state, seconds - eta)


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


class AerialPass(NamedTuple):
    passer: int
    receiver: int
    target: tuple
    touch: float


def aerial_pass_plan(packet, ball, team):
    now = getattr(packet.match_info, "seconds_elapsed", -1)
    if now < 0 or not 96 < ball.location.z < 720:
        return None
    living = [(i, car) for i, car in enumerate(packet.players)
              if car.demolished_timeout <= 0 and hasattr(car, "latest_touch")]
    allies = [(i, car) for i, car in living if car.team == team]
    if len(allies) < 3:
        return None
    passer_index, passer = max(living, key=lambda item: (touch_id(item[1]), -item[0]))
    touched = touch_id(passer)
    if not (passer.team == team and passer.is_bot and touched >= 0 and 0 <= now - touched <= .70):
        return None
    origin = vector(ball.location)
    attack = 1 if team == 0 else -1
    position = vector(passer.physics.location)
    offset = sub(origin, position)
    gap = math.hypot(*offset)
    front, _, _ = basis(passer.physics.rotation)
    rivals = [car for _, car in living if car.team != team]
    if not (92 < gap < 315 and attack * origin[1] > -2650 and dot(front, unit(offset)) > .60
            and math.hypot(*sub(vector(ball.velocity), vector(passer.physics.velocity))) < 930
            and all(math.hypot(*sub(vector(enemy.physics.location), origin)) > 520 for enemy in rivals)):
        return None
    choices = []
    for index, receiver in allies:
        if index == passer_index or not receiver.is_bot or receiver.boost < 28:
            continue
        pos = vector(receiver.physics.location)
        speed = vector(receiver.physics.velocity)
        if receiver.air_state == AirState.OnGround and pos[2] < 80:
            arrival = .69
            height = 390
        elif receiver.air_state == AirState.InAir and 170 < pos[2] < 720:
            arrival = .55
            height = min(760, max(290, pos[2] + speed[2] * .26))
        else:
            continue
        target = (pos[0] + speed[0] * arrival * .52,
                  pos[1] + speed[1] * arrival * .52 + 140 * attack, height)
        lane = sub(target, origin)
        distance = math.hypot(*lane)
        route = unit(lane)
        if (not 950 < attack * lane[1] < 2410 or not 1020 < distance < 2600
                or abs(target[0]) > 3080 or attack * target[1] > 4260 or dot(front, route) < .67):
            continue
        yaw = receiver.physics.rotation.yaw
        if dot((math.cos(yaw), math.sin(yaw), 0), unit((lane[0], lane[1], 0))) < .25:
            continue
        if not any(i not in (index, passer_index) and attack * car.physics.location.y < attack * origin[1] - 450
                   for i, car in allies):
            continue
        clearance = 1100
        for enemy in rivals:
            enemy_offset = sub(vector(enemy.physics.location), origin)
            along = dot(enemy_offset, route)
            if 200 < along < distance + 360:
                projection = add(enemy_offset, scale(vector(enemy.physics.velocity), min(.47, along / 2250)))
                clearance = min(clearance, math.hypot(*sub(projection, scale(route, dot(projection, route)))))
        if clearance < 440:
            continue
        choices.append((distance - clearance * .22, index, target))
    if not choices:
        return None
    _, index, target = min(choices)
    return AerialPass(passer_index, index, target, touched)


def incoming_ball(ball, attack):
    return ball.velocity.y * attack < -350


class AdvancedMoves:
    def __init__(self):
        self.move = None
        self.stage = ""
        self.next_attempt = 0
        self.passing = self.bumps = self.defense = 70
        self.next_air_bump = 0
        self.cooldown = 160
        self.pending_shot = None
        self.reset_count = 0
        self.release_tick = None
        self.carry_touches = 0
        self.reset_seen_at = None
        self.reset_touch_at = None
        self.previous_vertical = None
        self.bounce_frame = -1000
        self.contact_simulation = ContactSimulation()

    def report_reset_geometry(self, tick, result):
        sample = getattr(self, "reset_geometry", None)
        if sample is None:
            return
        player, geometry = sample
        self.trace(player, self.move, ["reset-geometry-"+result, geometry], tick)
        self.reset_geometry = None

    def cancel(self, tick, retry=None):
        if self.move:
            self.report_reset_geometry(tick, "unconfirmed")
        observation = getattr(self, "approach_observation", None)
        if observation and self.move and not self.carry_touches:
            player, start_touch, closest, boost, alignment = observation
            if tick - self.started >= 12 and touch_id(player) <= start_touch:
                if boost < 8:
                    hint = "check boost needed for approach"
                elif alignment < .62:
                    hint = "start turning earlier or target a later contact"
                else:
                    hint = "check predicted contact point and relative speed"
                self.trace(player, self.move, ["no-contact", self.stage, round(closest), round(boost), round(alignment, 2), hint], tick)
        self.approach_observation = None
        self.contact_simulation.plan = None
        self.contact_simulation.selection = None
        self.move = None
        self.stage = ""
        self.next_attempt = max(self.next_attempt, tick + (self.cooldown if retry is None else retry))

    def trace(self, player, move, event, tick):
        import json
        diagnostic = isinstance(event, list)
        if diagnostic and os.environ.get("RLC_DISABLE_MISS_REPORTS") == "1":
            return
        event_key = event[0] if diagnostic else event
        token = os.environ.get("RLC_INVENTORY_LAUNCH_TOKEN")
        directory = os.environ.get("LOCALAPPDATA")
        if token and directory:
            if event == "attempt":
                self.metric_attempt = [tick, move, set()]
            attempt = getattr(self, "metric_attempt", None)
            if attempt and event_key not in attempt[2]:
                attempt[2].add(event_key)
                try:
                    folder = os.path.join(directory, "RLCareer-Overhaul", "match-metrics")
                    os.makedirs(folder, exist_ok=True)
                    with open(os.path.join(folder, str(os.getpid()) + ".jsonl"), "a", encoding="utf-8") as stream:
                        stream.write(json.dumps([token, player.name, attempt[0], attempt[1], tick, move, event]) + "\n")
                except OSError:
                    pass
        if os.environ.get("RLC_BOT_STYLE_TRACE") == "1":
            print(f"[career-style] {player.name}: {move} {event} at frame {tick}", flush=True)

    def begin(self, kind, stage, player, tick):
        self.approach_observation = None
        self.reset_geometry = None
        self.contact_plan = None
        self.move, self.stage, self.started = kind, stage, tick
        self.stage_tick = tick
        self.carry_touches = 0
        self.touch = touch_id(player)
        self.was_reset = reset_available(player)
        self.reset_count = 0
        self.release_tick = None
        self.reset_seen_at = self.reset_touch_at = None
        self.trace(player, kind, "attempt", tick)

    def fire(self, player, tick):
        move = self.move
        self.pending_shot = move, tick + 55, touch_id(player)
        self.cancel(tick)
        return dict(jump=True, pitch=-1, yaw=0, roll=0, boost=True)

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

    @staticmethod
    def zen_touch_window(player, ball, offset):
        velocity = vector(player.physics.velocity)
        line = unit(offset)
        return (math.hypot(*velocity) >= 925 and dot(velocity, line) >= 680
                and dot(vector(ball.velocity), line) < -40 and 45 < offset[2] < 235)

    def cushion(self, player, ball, direction, distance, goal_direction):
        front, _, _ = basis(player.physics.rotation)
        position = vector(player.physics.location)
        relative = sub(vector(player.physics.velocity), vector(ball.velocity))
        offset = sub(vector(ball.location), position)
        normal = unit(offset)
        closing = dot(relative, normal)
        previous = getattr(self, "approach_observation", None)
        if previous is None or distance < previous[2]:
            self.approach_observation = (player, self.touch, distance, player.boost, dot(front, normal))
        elif previous[0] is not player:
            self.approach_observation = (player, *previous[1:])
        carrying = self.stage == "carry"
        hood_contact = self.move == "zen-touch" and self.stage == "cushion"
        if not hood_contact:
            # Intercept the contact point, rather than chasing the current ball center.
            velocity = vector(player.physics.velocity)
            ball_velocity = vector(ball.velocity)
            lead = max(.075, min(.40, (distance - 134) / max(750, closing + 445)))
            travel = unit(add(scale(unit(ball_velocity), .35), scale(goal_direction, .65)))
            # Lift a planned reset setup toward space the car can still reach.
            reset_setup = not carrying and self.move == "reset-setup-touch"
            lift = .85 if reset_setup else (.36 if carrying else .50)
            contact_normal = unit(add(travel, (0, 0, lift)))
            if reset_setup:
                # Blend back toward an attainable contact as the approach gets shorter.
                alignment = dot(contact_normal, normal)
                room = max(0, min(1, (distance - 135) / 155))
                weight = max(.18, room) * max(.25, alignment)
                contact_normal = unit(add(scale(normal, 1-weight), scale(contact_normal, weight)))
            if dot(contact_normal, normal) < .55:
                contact_normal = unit(add(scale(normal, .72), scale(contact_normal, .28)))
            contact_offset = scale(contact_normal, 126)
            if ball_forecast.get() is not None and distance > 155:
                predicted, predicted_car, contact_normal, horizon, outgoing, margin, contact_offset = (
                    self.contact_simulation.find_contact(player, ball, lead, contact_normal, normal, carrying,
                                                         getattr(self, "frame", 0)))
                self.contact_plan = (round(horizon, 3), outgoing, round(margin))
            else:
                shape = contact_hitbox(player)
                if shape:
                    contact_offset = box_contact_offset(contact_normal, basis(player.physics.rotation), shape)
                predicted, predicted_car = aerial_contact_prediction(player, ball, lead, contact_offset)
            error = sub(sub(predicted, contact_offset), predicted_car)
            across = sub(error, scale(normal, dot(error, normal)))
            # Keep the nose beneath the ball through contact and damp lateral drift.
            # Keep a positive radial component at low speed, but correct
            # vertical error before it turns into a near miss beneath the ball.
            correction = add(scale(across, 1.65), (0, 0, max(-38, min(155, error[2] * .58))))
            # Start climbing on a projected height deficit; leave lateral-only misses alone.
            height_deficit = error[2] > 45 and offset[2] > 70 and player.boost >= 8
            if height_deficit:
                correction = add(correction, (0, 0, min(85, (error[2]-45)*.7)))
            approach = add(scale(normal, max(95, distance - 107)), correction)
            contact_alignment = dot(normal, contact_normal)
            arrival_speed = 260 if carrying else 155
            if contact_alignment < .72:
                arrival_speed -= 55
            if reset_setup:
                # Match the ball's sideways movement before adding forward speed.
                lateral_drift = sub(relative, scale(normal, closing))
                arrival_speed -= min(45, .12 * math.hypot(*lateral_drift))
            if not carrying:
                # A soft contact must leave a followable lane, even if ball speed falls.
                lateral_error = math.hypot(*across)
                arrival_speed -= min(65, lateral_error * .32)
            speed_limit = min(650 if carrying else 500, arrival_speed + max(0, distance - 158) * 1.30)
            alignment = dot(front, unit(approach))
            if carrying and distance > 170 and alignment > .87 and math.hypot(*across) < 85:
                # Keep pace on a clean follow line; converge gently near contact.
                same_lane = dot(unit(velocity), unit(ball_velocity)) > .84
                if same_lane and dot(ball_velocity, travel) > 950:
                    speed_limit += min(105, (distance - 170) * .65)
            needs_height = (height_deficit and front[2] > .28 and alignment > .74
                            and closing < speed_limit + 65 and distance > 140)
            # Bank into the correction while there is room to level the contact.
            right = basis(player.physics.rotation)[1]
            bank_room = max(0, min(1, (distance - 175) / 125))
            bank = max(-.30, min(.30, dot(across, right) / 380)) * bank_room
            roof = unit(add((0, 0, 1), scale(right, bank)))
            return dict(air_controls(player, approach, roof), jump=False,
                        boost=(distance > (148 if carrying else 161) or needs_height)
                        and (closing < speed_limit or needs_height)
                        and (needs_height or alignment > (.77 if carrying else .81)),
                        throttle=-1.0 if closing > speed_limit and distance < 270 else .50)
        lane = unit((goal_direction[0], goal_direction[1], 0))
        hood_forward = unit(add(lane, (0, 0, .55)))
        side = cross((0, 0, 1), lane)
        roof = unit(add(sub((0, 0, 1), scale(hood_forward, hood_forward[2])), scale(side, .23)))
        approach = add(direction, add(scale(lane, -51), (0, 0, -95)))
        if distance < 280 and closing > 275:
            approach = sub(approach, scale(normal, min(42, (closing - 275) * .07)))
        attitude = (reset_orientation(player, hood_forward, roof, 1)
                    if 115 < distance < 330 and offset[2] > -35
                    else air_controls(player, approach, (0, 0, 1)))
        speed_limit = max(58, min(235, (distance - 135) * .87))
        return dict(attitude, jump=False, throttle=-.75 if closing > speed_limit else .18,
                    boost=distance > 265 and closing < speed_limit and dot(front, unit(approach)) > .90)

    def double_tap(self, player, ball, attack, tick, opponents=()):
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
            position = vector(player.physics.location)
            distance = math.hypot(*sub(pos, position))
            horizon = max(.048, min(.24, distance / 2100))
            predicted = ball_path(ball, horizon)
            lane, _ = goal_lane(predicted, velocity, attack, opponents, height=270)
            normal = shot_normal(lane, velocity)
            # Stage the nose behind the projected ball, then drive through it
            # only once the line from the car to the ball points into the net.
            from_car = unit(sub(predicted, position))
            setback = 36 if distance < 205 and dot(from_car, normal) > .91 else 115
            target = sub(predicted, scale(normal, setback))
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

    def ceiling_rebound(self, player, ball, opponents, attack, tick):
        position = vector(player.physics.location)
        front, _, _ = basis(player.physics.rotation)
        if self.stage == "ceiling-rebound":
            bounce = ceiling_time(ball)
            horizon = min(.55, bounce + .21) if bounce is not None else .16
            intercept = ball_path(ball, horizon)
            delta = sub(intercept, position)
            distance = math.hypot(*delta)
            offset = sub(vector(ball.location), position)
            gap = math.hypot(*offset)
            if (tick - self.started > 144 or distance > 1430 or abs(intercept[0]) > 3480 or
                    player.air_state != AirState.InAir or player.boost < 5):
                self.cancel(tick, retry=32)
                return None
            if bounce is None and ball.velocity.z < -120 and gap < 505 and offset[2] > 45:
                if (165 < gap < 340 and player.boost >= 30 and 2350 < attack * ball.location.y < 4210
                        and abs(ball.location.x) < 1850 and front[1] * attack > .72
                        and dot(front, unit(offset)) > .64
                        and any(math.hypot(*sub(vector(enemy.physics.location), intercept)) < 1380
                                for enemy in opponents)):
                    self.stage, self.stage_tick = "ceiling-board-hit", tick
                    return self.ceiling_rebound(player, ball, opponents, attack, tick)
                if (ball.velocity.z < -390 and ball.location.z > 1170 and gap < 395
                        and not reset_available(player) and player.boost >= 22):
                    self.stage, self.stage_tick = "reset-pop-approach", tick
                    self.move = "first-touch-reset-pop"
                    self.was_reset = reset_available(player)
                    self.reset_seen_at = self.reset_touch_at = None
                    self.reset_roll = 1 if offset[0] >= 0 else -1
                    return self.reset_approach(player, ball, offset, gap, unit(sub((0, attack * 5120, 300), intercept)))
                self.move, self.stage, self.stage_tick = "soft-touch", "cushion", tick
                return self.cushion(player, ball, delta, gap, unit(sub((0, attack * 5120, 300), intercept)))
            aim = add(delta, (0, 0, -106))
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False, throttle=.8,
                        boost=distance > 255 and dot(front, unit(aim)) > .82)

        if touch_id(player) > self.touch:
            board = self.backboard_time(ball, attack)
            if board is not None:
                self.touch = touch_id(player)
                if board > .38 and position[2] > 1470 and player.physics.velocity.z > 440 and player.boost >= 36:
                    self.move, self.stage, self.stage_tick = "ceiling-reset-double-tap", "ceiling-reset", tick
                    self.started = tick
                    return dict(jump=False, boost=False)
                self.move, self.stage = "double-tap", "read-board"
                return self.double_tap(player, ball, attack, tick, opponents)
            self.move, self.stage, self.stage_tick = "soft-touch", "carry", tick
            self.carry_touches = 1
            self.touch = touch_id(player)
            offset = sub(vector(ball.location), position)
            return self.cushion(player, ball, chase_direction(player, ball), math.hypot(*offset),
                                unit(sub((0, attack * 5120, 285), vector(ball.location))))
        aim = chase_direction(player, ball, (0, 0, -25))
        if tick - self.stage_tick > 44 or math.hypot(*aim) > 475:
            self.cancel(tick, retry=55)
            return None
        return dict(air_controls(player, aim, (0, 0, 1)), jump=False, throttle=1,
                    boost=math.hypot(*aim) > 110 and dot(front, unit(aim)) > .83)

    def wall_takeoff(self, player, ball, attack, tick):
        elapsed = tick - self.stage_tick
        position = vector(player.physics.location)
        target = vector(ball.location)
        offset = sub(target, position)
        gap = math.hypot(*offset)
        front, left, _ = basis(player.physics.rotation)
        if elapsed > 58 or gap > 525 or player.boost < 7:
            self.cancel(tick, retry=47)
            return None
        inward = -math.copysign(1, self.wall_side)
        if self.stage == "wall-dodge-release":
            if touch_id(player) > self.touch:
                self.stage, self.stage_tick = "carry", tick
                self.touch = touch_id(player)
                self.carry_touches = 1
                return self.cushion(player, ball, chase_direction(player, ball), gap,
                                    unit(sub((0, attack * 5120, 270), target)))
            aim = chase_direction(player, ball, (inward * 48, 0, -61))
            if elapsed <= 3:
                return dict(jump=False, boost=False, pitch=0, yaw=0, roll=0)
            if flip_available(player) and gap < 270 and dot(front, unit(offset)) > .53:
                self.stage, self.stage_tick = "wall-dodge-follow", tick
                steer = dot(unit(add(offset, (inward * 65, attack * 45, 36))), left)
                return dict(jump=True, pitch=-.78, yaw=math.copysign(.57, steer), roll=0, boost=False)
            return dict(air_controls(player, aim, (inward * .72, 0, .69)), jump=False,
                        boost=gap > 175 and dot(front, unit(aim)) > .87)
        if touch_id(player) > self.touch:
            self.stage, self.stage_tick, self.touch = "carry", tick, touch_id(player)
            self.carry_touches = 1
            return self.cushion(player, ball, chase_direction(player, ball), gap,
                                unit(sub((0, attack * 5120, 270), target)))
        if self.stage == "wall-soft-follow":
            aim = chase_direction(player, ball, (inward * 12, 0, -56))
            closing = dot(sub(vector(player.physics.velocity), vector(ball.velocity)), unit(offset))
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        boost=elapsed > 4 and gap > 173 and closing < 155
                        and dot(front, unit(aim)) > .86)
        aim = chase_direction(player, ball, (inward * 30, 0, -66))
        if elapsed < 5:
            return dict(jump=False, boost=False, pitch=.28, yaw=0, roll=0)
        return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                    boost=gap > 190 and dot(front, unit(aim)) > .86)

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
            if (ceiling and ceiling_opening(ball) and 1380 < target[2] < 1915 and distance < 850
                    and abs(ball.velocity.y) > 650
                    and math.hypot(*sub(ceiling_point, position)) < 690
                    and not incoming):
                self.begin("ceiling-prejump", "ceiling", player, tick)
            elif (ceiling and ceiling_opening(ball) and attack * position[1] > 1200 and 1320 < target[2] < 1915
                    and distance < 1050 and attack * ball.velocity.y > 300
                    and any(0 <= self.match_seconds - touch_id(ally) < .55 and touch_id(ally) >= 0
                            for ally in teammates)):
                self.begin("ceiling-redirect", "ceiling", player, tick)
            elif (player.air_state == AirState.OnGround and abs(position[0]) > 3770
                    and up[0] * position[0] < -1250 and 230 < position[2] < 1120
                    and 320 < target[2] < 1300 and 3820 < abs(target[0]) < 4070
                    and target[0] * position[0] > 0 and 135 < distance < 325
                    and offset[2] > 35 and 100 < ball.velocity.z < 1025 and abs(ball.velocity.x) < 360
                    and dot(front, unit(offset)) > .70 and player.boost >= 26
                    and any(attack * (position[1] - mate.physics.location.y) > 390 for mate in teammates)
                    and all(math.hypot(*sub(vector(enemy.physics.location), target)) > 635 for enemy in opponents)):
                self.begin("wall-dodge-air-dribble", "wall-dodge-release", player, tick)
                self.wall_side = position[0]
                return dict(jump=True, pitch=.18, boost=False, throttle=.92)
            elif (player.air_state == AirState.OnGround and abs(position[0]) > 3770
                    and up[0] * position[0] < -1250 and 260 < position[2] < 1450
                    and target[0] * position[0] > 0 and 3720 < abs(target[0]) < 4040
                    and 124 < distance < 210 and 15 < offset[2] < 150
                    and dot(front, unit(offset)) > .69 and player.boost >= 21
                    and abs(ball.velocity.x) < 300 and abs(ball.velocity.z) < 600
                    and abs(dot(sub(vector(player.physics.velocity), vector(ball.velocity)),
                                unit(offset))) < 240
                    and any(attack * (position[1] - mate.physics.location.y) > 390 for mate in teammates)
                    and all(math.hypot(*sub(vector(enemy.physics.location), target)) > 830 for enemy in opponents)):
                self.begin("soft-wall-touch", "wall-soft-follow", player, tick)
                self.wall_side = position[0]
                return dict(jump=True, pitch=.12, boost=False, throttle=.6)
            elif (player.air_state == AirState.OnGround and position[2] < 75 and player.boost >= 22
                    and abs(target[0]) > 3590 and 93 <= target[2] < 310 and 115 < distance < 300
                    and attack * target[1] > -650 and offset[0] * target[0] > 35
                    and dot(front, unit((offset[0], offset[1], 0))) > .78
                    and all(math.hypot(*sub(vector(enemy.physics.location), target)) > 720 for enemy in opponents)):
                self.begin("wall-lift", "wall-lift", player, tick)
            elif (player.air_state == AirState.InAir and position[2] > 320 and abs(target[0]) > 3080
                    and 390 < distance < 900 and player.boost > 23
                    and attack * target[1] > -800
                    and (forecast := predicted_touch(ball, teammates + opponents, .55)) is not None
                    and abs(forecast[0]) > 2700 and math.hypot(*sub(forecast, position)) < 1000
                    and dot(front, unit(sub(forecast, position))) > .65):
                self.begin("wall-read-redirect", "wall-read", player, tick)
                self.receiver = forecast
            elif (incoming and attack * position[1] < -4750 and abs(position[0]) < 970
                    and 88 < position[2] < 735 and distance < 1040 + 2 * (self.defense - 70)):
                self.begin("squishy-save", "save", player, tick)
            elif (player.air_state == AirState.InAir
                    and attack * position[1] > 2500 and attack * target[1] > 3000
                    and position[2] > 1200 and player.physics.velocity.z > 410
                    and 145 < distance < 300 and dot(front, unit(offset)) > .91
                    and attack * offset[1] > 90 and player.boost >= 48
                    and all(math.hypot(*sub(vector(enemy.physics.location), target)) > distance + 330
                            for enemy in opponents)):
                self.begin("ceiling-reset-double-tap", "board-hit", player, tick)
            elif (player.air_state == AirState.OnGround and position[2] < 50 and 115 < target[2] < 184
                    and distance < 179 and abs(offset[0]) < 66 and attack * target[1] > 1150
                    and front[1] * attack > .71
                    and math.hypot(*sub(vector(player.physics.velocity), vector(ball.velocity))) < 390
                    and any(attack * gap[1] > 235 and abs(gap[0]) < 470
                            and 300 < math.hypot(*gap) < 870
                            and (enemy.air_state == AirState.InAir or attack * enemy.physics.velocity.y < -520)
                            for enemy in opponents for gap in [sub(vector(enemy.physics.location), target)])):
                self.begin("fake-flick", "fake-flick", player, tick)
                self.fake_side = 1 if abs(target[0] + 510) < abs(target[0] - 510) else -1
            elif (player.air_state == AirState.OnGround and position[2] < 60 and target[2] < 145
                    and 180 < distance < 470 and dot(front, unit(offset)) > .90
                    and attack * position[1] > -1200):
                receiver = self.ground_receiver(ball, teammates, opponents, attack)
                if receiver is not None:
                    lane = unit(sub(receiver, target))
                    if dot(lane, unit(offset)) > .70 - .001 * (self.passing - 70):
                        self.begin("ground-pass", "ground-pass", player, tick)
                        self.receiver = receiver
                if not self.move and attack * position[1] > 400:
                    if (any(attack * (position[1] - ally.physics.location.y) > 420 for ally in teammates)
                            and any(300 < math.hypot(*sub(vector(enemy.physics.location), target)) < 830
                                    and attack * (enemy.physics.location.y - target[1]) > 95
                                    and attack * enemy.physics.velocity.y < -340 for enemy in opponents)):
                        self.begin("fake-challenge", "fake", player, tick)
        if self.stage in ("wall-dodge-release", "wall-dodge-follow", "wall-soft-follow"):
            if any(touch_id(other) > self.touch and touch_id(other) > touch_id(player)
                   for other in teammates + opponents):
                self.cancel(tick, retry=45)
                return None
            return self.wall_takeoff(player, ball, attack, tick)
        if self.move == "wall-lift":
            elapsed = tick - self.started
            touched_wall = touch_id(player) > self.touch
            if touched_wall:
                self.trace(player, self.move, "lift-contact", tick)
            if touched_wall or elapsed > 28 or distance > 400:
                self.cancel(tick, retry=12)
                return None
            return dict(jump=elapsed < 11, pitch=.40, throttle=1, boost=False)
        if self.move == "wall-read-redirect":
            if touch_id(player) > self.touch or tick - self.started > 79 or distance > 1050:
                self.cancel(tick, retry=55)
                return None
            updated = predicted_touch(ball, teammates + opponents, .40)
            target = updated if updated is not None else ball_path(ball, .16)
            goal = unit(sub((0, attack * 5120, 305), target))
            aim = sub(sub(target, scale(goal, 56)), position)
            direction = unit(aim)
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        throttle=.8, boost=distance > 170 and dot(front, direction) > .84)
        if self.move == "fake-flick":
            if tick - self.started > 33 or distance > 295 or any(touch_id(enemy) > self.touch for enemy in opponents):
                self.cancel(tick, retry=130)
                return None
            elapsed = tick - self.started
            return dict(jump=False, throttle=.34 if elapsed < 11 else .88,
                        steer=0 if elapsed < 11 else .29 * self.fake_side, boost=False)
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

    @staticmethod
    def reset_contact_plane(miss, current, up):
        # Use the hemisphere facing the car. Shallow angles are useful on a
        # lateral or descending approach and still require actual wheel contact.
        x, y, z = miss
        if math.hypot(x, y) < 73 and z > 67:
            return unit((x, y, max(106, z)))
        incoming = unit(miss)
        current = unit(current)
        wheel_side = scale(up, -1)
        # Prefer the plane the wheels already face when it is also accessible
        # along the projected approach. Otherwise roll toward the incoming line.
        if dot(wheel_side, incoming) > .81 and dot(wheel_side, current) > .68:
            return unit(add(scale(incoming, .72), scale(wheel_side, .28)))
        return unit(add(scale(incoming, .78), scale(current, .22)))

    def reset_approach(self, player, ball, offset, distance, goal):
        position = vector(player.physics.location)
        velocity = vector(player.physics.velocity)
        ball_velocity = vector(ball.velocity)
        front, _, _ = basis(player.physics.rotation)
        relative = sub(velocity, ball_velocity)
        radial = unit(offset)
        closing = dot(relative, radial)
        horizon = max(.075, min(.36, (distance - 117) / max(390, closing + 300)))
        provisional = self.reset_contact_plane(offset, offset, basis(player.physics.rotation)[2])
        lead, car_lead = aerial_contact_prediction(player, ball, horizon, scale(provisional, 116))
        miss = sub(lead, car_lead)
        _, left, up = basis(player.physics.rotation)
        normal = self.reset_contact_plane(miss, offset, up)
        if distance < 300:
            wheel_alignment = max(-1, min(1, dot(scale(up, -1), radial)))
            geometry = dict(distance=round(distance), lateral=round(dot(offset, left)),
                            vertical=round(offset[2]), wheelAngle=round(math.degrees(math.acos(wheel_alignment)), 1),
                            closing=round(closing), boost=round(player.boost))
            previous = getattr(self, "reset_geometry", None)
            if previous is None or distance < previous[1]["distance"]:
                self.reset_geometry = (player, geometry)
        target = sub(lead, scale(normal, 116))
        # If the lateral route crosses a surface, choose the inward side.
        if abs(target[0]) > 4025 or abs(target[1]) > 5050 or not 68 < target[2] < 1960:
            normal = unit((lead[0] - max(-4025, min(4025, target[0])),
                           lead[1] - max(-5050, min(5050, target[1])),
                           lead[2] - max(68, min(1960, target[2]))))
            target = sub(lead, scale(normal, 116))
        tangent = sub(goal, scale(normal, dot(goal, normal)))
        if math.hypot(*tangent) < .08:
            tangent = sub(front, scale(normal, dot(front, normal)))
        drive = sub(target, car_lead)
        remaining = math.hypot(*drive)
        speed_limit = min(1120, 210 + max(0, distance - 122) * 4.0)
        can_accelerate = closing < speed_limit and (distance > 166 or remaining > 65)
        wheel_up = scale(normal, -1)
        attitude = reset_orientation(player, tangent, wheel_up, getattr(self, "reset_roll", 1))
        if remaining > 49 and can_accelerate:
            needs_height = drive[2] > 55 and offset[2] > 80 and player.boost >= 10
            if needs_height:
                drive = add(drive, (0, 0, min(55, .55 * (drive[2]-55))))
            aim = unit(drive)
            flight = air_controls(player, aim, (0, 0, 1))
            alignment = dot(front, aim)
            lateral_error = abs(dot(drive, left))
            # Turn toward the wheel-contact pose while thrust is still useful.
            # Keep pitch and yaw available for larger trajectory corrections.
            proximity = max(0, min(1, (550-distance)/315))
            course = max(0, min(1, (alignment-.48)/.36))
            room = proximity * course
            roll_weight = room * (.54 if needs_height else .91)
            steering_weight = room * (.16 if needs_height else .47)
            steering_weight *= max(.22, 1-lateral_error/180)
            roll = directional_reset_roll(player, wheel_up, horizon, attitude["roll"])
            flight["roll"] += (roll-flight["roll"])*roll_weight
            for axis in ("pitch", "yaw"):
                flight[axis] += (attitude[axis]-flight[axis])*steering_weight
            return dict(flight, jump=False, throttle=.85, boost=alignment > .67)
        return dict(attitude, jump=False, throttle=-.75 if closing > speed_limit else .32, boost=False)

    @staticmethod
    def follow_lane(player, ball, goal, distance, opponents):
        aim = chase_direction(player, ball, (0, 0, -33))
        if distance < 220:
            return aim
        position = vector(player.physics.location)
        for opponent in opponents:
            delta = sub(add(vector(opponent.physics.location), scale(vector(opponent.physics.velocity), .18)), position)
            if 110 < math.hypot(*delta) < 410 and dot(unit(delta), unit(aim)) > .81:
                away = sub(aim, scale(unit(delta), min(120, math.hypot(*aim) * .24)))
                side = cross((0, 0, 1), goal)
                if dot(delta, side) >= 0:
                    side = scale(side, -1)
                return add(away, scale(side, 78))
        return aim

    def reset_fallback(self, player, ball, opponents, distance, goal, tick, free):
        offset = sub(vector(ball.location), vector(player.physics.location))
        elapsed = tick - self.stage_tick
        relative = sub(vector(player.physics.velocity), vector(ball.velocity))
        separating = dot(relative, unit(offset)) < -235
        if elapsed < 33 or (elapsed < 82 and not separating and player.boost >= 9):
            return None
        if not free:
            contest = self.contest(player, ball, opponents, distance)
            if contest is not None:
                self.stage, self.stage_tick = "carry", tick
                return contest
        if distance < 480 and player.air_state == AirState.InAir and (player.boost >= 10 or distance < 235):
            self.stage, self.stage_tick = "carry", tick
            self.touch = touch_id(player)
            self.report_reset_geometry(tick, "replanned")
            self.trace(player, self.move, "reset-replanned-to-carry", tick)
            return self.cushion(player, ball, chase_direction(player, ball), distance, goal)
        return None

    def confirm_reset(self, player, tick, distance):
        """Pair the touch and flip regain even if telemetry arrives in separate packets."""
        available = reset_available(player)
        if available and not self.was_reset:
            self.reset_seen_at = tick
        self.was_reset = available
        touched = touch_id(player)
        if touched > self.touch:
            self.touch = touched
            self.reset_touch_at = tick
        confirmed = (available and self.reset_seen_at is not None and self.reset_touch_at is not None
                     and abs(self.reset_seen_at - self.reset_touch_at) <= 12 and distance < 250)
        if confirmed:
            self.reset_seen_at = self.reset_touch_at = None
            self.report_reset_geometry(tick, "confirmed")
        return confirmed

    def reset_pop(self, player, ball, offset, distance, goal, tick, free, opponents):
        touched = touch_id(player)
        front, left, up = basis(player.physics.rotation)
        attack = 1 if player.team == 0 else -1
        if self.stage == "reset-pop-approach":
            if self.confirm_reset(player, tick, distance):
                self.stage, self.stage_tick = "reset-pop-align", tick
                self.trace(player, self.move, "reset-confirmed", tick)
                return dict(jump=False, boost=False, roll=0)
            if self.reset_touch_at is not None and tick - self.reset_touch_at > 12 and distance < 420:
                self.stage, self.stage_tick = "carry", tick
                self.carry_touches = 1
                self.trace(player, self.move, "carry-after-touch", tick)
                return self.cushion(player, ball, chase_direction(player, ball), distance, goal)
            fallback = self.reset_fallback(player, ball, opponents, distance, goal, tick, free)
            if fallback is not None:
                return fallback
            if tick - self.stage_tick > 114 or (not free and distance > 500):
                self.cancel(tick, retry=65)
                return None
            return self.reset_approach(player, ball, offset, distance, goal)
        if self.stage == "reset-pop-align":
            if not flip_available(player) or tick - self.stage_tick > 42 or distance > 340:
                self.cancel(tick)
                return None
            intercept = unit(sub(ball_path(ball, .065), vector(player.physics.location)))
            lane, _ = goal_lane(vector(ball.location), vector(ball.velocity), attack, opponents)
            impulse = shot_normal(lane, vector(ball.velocity), speed=1450)
            aim = unit(add(scale(intercept, .57), add(scale(impulse, .43), (0, 0, .11))))
            forward, sideways = dot(aim, front), dot(aim, left)
            if self.move == "first-touch-reset-pop":
                # A ceiling rebound moves away quickly. Spend the newly verified flip
                # as soon as the next contact is reachable in the dodge plane.
                relative_contact = sub(ball_path(ball, .085), add(
                    vector(player.physics.location), scale(vector(player.physics.velocity), .085)))
                pop = unit(relative_contact)
                local_forward, local_side = dot(pop, front), dot(pop, left)
                planar = math.hypot(local_forward, local_side)
                if (tick > self.stage_tick and distance < 245 and math.hypot(*relative_contact) < 224
                        and planar > .56 and dot(pop, impulse) > -.15):
                    self.stage, self.stage_tick = "reset-pop-follow", tick
                    self.trace(player, self.move, "pop-command", tick)
                    return dict(jump=True, pitch=-local_forward/planar, yaw=local_side/planar,
                                roll=0, boost=False, throttle=1)
                if tick - self.stage_tick < 9:
                    return dict(air_controls(player, pop, (0, 0, 1)), jump=False, boost=False)
            contested = not free and distance < 205 and forward > .41
            alignment = dot(unit(offset), aim)
            if (tick - self.stage_tick >= (3 if contested else 4) and distance <= 211
                    and (abs(dot(intercept, up)) < .72 or contested)
                    and forward > (.41 if contested else .50) and alignment > (.66 if contested else .74)):
                self.stage, self.stage_tick = "reset-pop-follow", tick
                self.trace(player, self.move, "pop-command", tick)
                return dict(jump=True, pitch=-max(.62, forward), yaw=clip(sideways * 1.15), roll=0,
                            boost=contested and distance > 175 and forward > .88, throttle=1)
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        boost=not contested and distance > 240 and forward > .93)
        if self.stage == "reset-pop-follow":
            elapsed = tick - self.stage_tick
            if touched > self.touch:
                self.touch = touched
                self.trace(player, self.move, "pop-contact", tick)
                bounce = ceiling_time(ball)
                if bounce is not None and bounce < .50 and abs(ball.location.x) < 3200 and player.boost >= 16:
                    self.move, self.stage = "ceiling-rebound", "ceiling-rebound"
                    return self.ceiling_rebound(player, ball, opponents, attack, tick)
                if self.backboard_time(ball, attack) is not None and player.boost >= 28:
                    self.stage = "read-board"
                    return self.double_tap(player, ball, attack, tick, opponents)
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
            aim = self.follow_lane(player, ball, goal, distance, opponents)
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        boost=elapsed >= 8 and distance > 168 and dot(front, unit(aim)) > .85)
        return self.double_tap(player, ball, attack, tick, opponents)

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
        if (free and player.boost >= 25 and 92 <= ball.location.z <= 112
                and abs(ball.velocity.z) < 80 and 120 < distance < 305
                and abs(ball.location.x) < 3200 and attack * ball.location.y < 3500
                and front[1] * attack > .60 and dot(front, unit(ground_delta)) > .91
                and 125 < dot(relative, unit(ground_delta)) < 750):
            self.begin("ground-to-air", "chip", player, tick)
            return
        if (player.boost >= 25 and 93 <= ball.location.z < 275 and 135 < distance < 445
                and offset[2] > 69 and front[1] * attack > .55
                and dot(front, unit(ground_delta)) > .88
                and (dot(relative, unit(ground_delta)) > 95 or 120 < ball.velocity.z < 650)
                and -620 < ball.velocity.z < 780 and (free or distance < 285)):
            self.begin("ground-to-air", "bounce-wait", player, tick)

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
        if self.stage == "chip":
            if elapsed > 35 or distance > 370 or not free:
                self.cancel(tick, retry=40)
                return None
            if touch_id(player) > self.touch:
                if ball.velocity.z < 175:
                    self.cancel(tick, retry=40)
                    return None
                self.stage, self.stage_tick = "bounce-rise", tick
                return dict(jump=True, pitch=.26, throttle=.92, boost=False)
            aim = chase_direction(player, ball)
            error = math.atan2(dot(aim, left), dot(aim, front))
            return dict(throttle=.78, steer=clip(error * 3), jump=False, boost=False)
        if self.stage == "bounce-wait":
            if elapsed > 65 or distance > 490 or (not free and distance > 320):
                self.cancel(tick, retry=38)
                return None
            bounced = tick - self.bounce_frame <= 20 and ball.velocity.z > 70 and ball.location.z < 285
            flat_gap = math.hypot(offset[0], offset[1])
            aim = chase_direction(player, ball, (0, 0, -65))
            error = math.atan2(dot(aim, left), dot(aim, front))
            if bounced and 42 < flat_gap < 188 and abs(dot(aim, left)) < 89:
                self.stage, self.stage_tick = "bounce-rise", tick
                return dict(jump=True, boost=False, throttle=.95, pitch=.31)
            # Hold behind the landing point. Enter underneath after the
            # rebound instead of trapping the descending ball on the roof.
            speed = math.hypot(player.physics.velocity.x, player.physics.velocity.y)
            throttle = -.32 if not bounced and flat_gap < 155 and speed > 520 else (.34 if not bounced and flat_gap < 170 else .78)
            return dict(throttle=throttle, steer=clip(error * 3), boost=False, jump=False)
        if self.stage == "bounce-rise":
            if elapsed > 49 or distance > 480:
                self.cancel(tick, retry=42)
                return None
            if touch_id(player) > self.touch and player.air_state == AirState.InAir:
                self.stage, self.stage_tick = "carry", tick
                return None
            if elapsed < 10:
                return dict(jump=True, boost=False, throttle=.94, pitch=.28)
            aim = chase_direction(player, ball, (0, 0, -68))
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        throttle=.85, boost=distance > 160 and dot(front, unit(aim)) > .79)
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
                    aim = chase_direction(player, ball, (0, 0, -38))
                    return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                                boost=distance > 160 and dot(front, unit(aim)) > .91)
            else:
                self.cancel(tick)
                return None
        if self.stage == "pop-follow" and touch_id(player) <= self.touch:
            if elapsed > 28 or distance > 340:
                self.cancel(tick)
                return None
            aim = chase_direction(player, ball, (0, 0, -34))
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        boost=elapsed > 3 and distance > 149 and dot(front, unit(aim)) > .84)
        if touch_id(player) > self.touch and player.air_state == AirState.InAir:
            self.stage, self.stage_tick = "carry", tick
        else:
            self.cancel(tick)
        return None

    def empty_boost_reset(self, player, ball, opponents, tick):
        if not reset_available(player) or player.boost > 7:
            return None
        offset = sub(vector(ball.location), vector(player.physics.location))
        gap = math.hypot(*offset)
        if not 110 < gap < 510:
            return None
        front, left, up = basis(player.physics.rotation)
        attack = 1 if player.team == 0 else -1
        projected = ball_path(ball, min(.18, gap / 1900))
        intercept = unit(sub(projected, vector(player.physics.location)))
        challenged = any(math.hypot(*sub(projected, vector(enemy.physics.location))) < 555
                         for enemy in opponents)
        lane, _ = goal_lane(projected, vector(ball.velocity), attack, opponents)
        normal = shot_normal(lane, vector(ball.velocity), speed=1650)
        aim = unit(add(scale(intercept, .85 if challenged else .67),
                       scale(normal, .15 if challenged else .33)))
        if self.move != "empty-boost-reset":
            self.begin("empty-boost-reset", "empty-boost-reset", player, tick)
        if tick - self.started > 38:
            self.cancel(tick, retry=65)
            return None
        if (tick - self.stage_tick >= 3 and gap < (234 if challenged else 217)
                and dot(aim, front) > .39 and abs(dot(intercept, up)) < .76):
            changes = self.fire(player, tick)
            return dict(changes, yaw=clip(dot(aim, left) * 1.45), boost=False, throttle=1)
        return dict(air_controls(player, aim, (0, 0, 1)), jump=False, boost=False, throttle=1)

    @staticmethod
    def contact_follow(player, ball, opponents, wanted, has_priority):
        if player.air_state != AirState.InAir:
            return None
        position = vector(player.physics.location)
        offset = sub(vector(ball.location), position)
        gap = math.hypot(*offset)
        near_enemy = any(math.hypot(*sub(vector(enemy.physics.location), vector(ball.location))) < 680
                         for enemy in opponents)
        if (not 140 < gap < (850 if has_priority and player.boost >= 17 else 510)
                or abs(offset[2]) > 520 or (not has_priority and not near_enemy and not wanted.boost)):
            return None
        front, _, _ = basis(player.physics.rotation)
        closing = dot(sub(vector(player.physics.velocity), vector(ball.velocity)), unit(offset))
        if dot(front, unit(offset)) < .56 or (closing < 90 and player.boost < 10):
            return None
        horizon = max(.055, min(.29, (gap - 125) / max(900, closing)))
        predicted = ball_path(ball, horizon)
        aim = sub(predicted, position)
        lateral_velocity = sub(vector(player.physics.velocity), scale(unit(aim), dot(vector(player.physics.velocity), unit(aim))))
        aim = sub(aim, scale(lateral_velocity, min(.15, horizon)))
        if dot(front, unit(aim)) < .48:
            return None
        return dict(air_controls(player, aim, (0, 0, 1)), jump=False, throttle=.9,
                    boost=player.boost > 0 and gap > 190 and closing < 1130 and dot(front, unit(aim)) > .86)

    @staticmethod
    def contest(player, ball, opponents, distance):
        offset = sub(vector(ball.location), vector(player.physics.location))
        if player.air_state != AirState.InAir or not 125 < distance < 640 or player.boost < 8:
            return None
        front, _, _ = basis(player.physics.rotation)
        position = vector(player.physics.location)
        local = unit(offset)
        if dot(front, local) < .42 or abs(offset[2]) > 385:
            return None
        for opponent in opponents:
            their_delta = sub(vector(ball.location), vector(opponent.physics.location))
            gap = math.hypot(*their_delta)
            closing = dot(vector(opponent.physics.velocity), unit(their_delta))
            if gap < 155 or not (gap < 830 and closing > 285):
                continue
            if (gap - 125) / max(900, closing) + .19 < (distance - 115) / 1950:
                continue
            # Stay goal-side for the 50 and keep boost for the actual collision.
            attack = 1 if player.team == 0 else -1
            aim = chase_direction(player, ball, (0, -attack * 28, -35))
            closing = dot(sub(vector(player.physics.velocity), vector(ball.velocity)), unit(sub(vector(ball.location), position)))
            return dict(air_controls(player, aim, (0, 0, 1)), jump=False,
                        boost=distance > 173 and closing < 1250 and dot(front, unit(aim)) > .79,
                        throttle=1)
        return None

    def update(self, packet, index, wanted):
        player = packet.players[index]
        ball = packet.balls[0].physics
        tick = packet.match_info.frame_num
        if tick < getattr(self, "frame", tick):
            self.contact_simulation.selection = None
            self.contact_simulation.next_frame = 0
            self.contact_simulation.plan = None
        self.frame = tick
        self.match_seconds = getattr(packet.match_info, "seconds_elapsed", -2)
        attack = 1 if player.team == 0 else -1
        position = vector(player.physics.location)
        target = vector(ball.location)
        offset = sub(target, position)
        distance = math.hypot(*offset)
        front, _, up = basis(player.physics.rotation)
        touched = touch_id(player)
        if (self.previous_vertical is not None and self.previous_vertical < -82
                and ball.velocity.z > 105 and target[2] < 159):
            self.bounce_frame = tick
        self.previous_vertical = ball.velocity.z
        if self.pending_shot:
            move, expiry, old_touch = self.pending_shot
            if tick > expiry or touched > old_touch:
                if touched > old_touch:
                    self.trace(player, move, "on-target" if on_target(ball, player.team) else "contact", tick)
                self.pending_shot = None
                if (touched > old_touch and move == "reset-double-tap" and player.boost >= 32
                        and self.backboard_time(ball, attack) is not None):
                    self.begin("double-tap", "read-board", player, tick)

        teammates = [other for i, other in enumerate(packet.players)
                     if i != index and other.team == player.team and other.demolished_timeout <= 0]
        opponents = [other for other in packet.players
                     if other.team != player.team and other.demolished_timeout <= 0]
        recent_owner = (touched >= 0 and 0 <= self.match_seconds - touched < 1.60
                        and all(touch_id(other) <= touched for other in teammates + opponents))
        if ((recent_owner or self.reset_count > 0 or self.reset_seen_at is not None)
                and (self.move == "empty-boost-reset" or self.pending_shot is None)):
            low_boost = self.empty_boost_reset(player, ball, opponents, tick)
            if low_boost is not None:
                return low_boost
        if self.move == "empty-boost-reset":
            self.cancel(tick, retry=75)
        ceiling = ceiling_time(ball)
        if (not self.move and ceiling is not None and ceiling < .48 and target[2] > 1180
                and abs(target[0]) < 3240 and attack * target[1] > -1650
                and player.air_state == AirState.InAir and player.boost >= 18
                and tick >= self.next_attempt and (recent_owner or distance < 700)
                and not any(other.air_state == AirState.InAir
                            and math.hypot(*sub(target, vector(other.physics.location))) < distance - 270
                            for other in teammates)):
            self.begin("ceiling-rebound", "ceiling-rebound", player, tick)
        if self.stage in ("ceiling-rebound", "ceiling-board-hit"):
            if any(touch_id(other) > self.touch and touch_id(other) > touched
                   for other in teammates + opponents):
                self.cancel(tick, retry=50)
                return None
            return self.ceiling_rebound(player, ball, opponents, attack, tick)
        tactical = self.tactical_move(player, ball, teammates, opponents, attack, tick)
        if tactical is not None:
            return tactical
        cover = any(attack * (position[1] - other.physics.location.y) > 325 for other in teammates)
        future = ball_path(ball, .22)
        def intercept_gap(car):
            at = add(vector(car.physics.location), scale(vector(car.physics.velocity), .20))
            return math.hypot(*sub(future, at))
        my_gap = intercept_gap(player)
        competing = any(intercept_gap(other) + (285 if recent_owner else 135) < my_gap
                        and (not other.is_bot or other.air_state == AirState.InAir)
                        and dot(vector(other.physics.velocity), unit(sub(future, vector(other.physics.location)))) > 320
                        for other in teammates)
        keep_possession = recent_owner and player.air_state == AirState.InAir and distance < 1060 and player.boost >= 10
        protected_possession = (attack * target[1] < -1550 and attack * target[1] > -4200
                                and abs(target[0]) > 620 and attack * ball.velocity.y > -240
                                and player.boost >= 26 and distance < 570
                                and all(math.hypot(*sub(target, vector(enemy.physics.location))) > 1250
                                        for enemy in opponents))
        usable_window = (player.boost >= 22 and distance < 850 and attack * target[1] > -750
                         and abs(target[0]) < 3680 and dot(front, unit(offset)) > .47
                         and all(math.hypot(*sub(target, vector(enemy.physics.location))) > 780
                                 for enemy in opponents))
        at_risk = attack * target[1] < -1550 and not protected_possession
        follow = None
        if not competing and not wanted.jump and not at_risk:
            follow = self.contact_follow(player, ball, opponents, wanted, keep_possession)
        if (not teammates or (not cover and not self.move and not protected_possession and not keep_possession and not usable_window)
                or (competing and not self.move) or at_risk
                or (abs(target[1]) > 4650 and not (self.stage == "carry" and self.carry_touches > 0 and attack * ball.velocity.y < -260) and self.move not in ("double-tap", "ceiling-reset-double-tap", "first-touch-reset-pop", "setup-reset-pop", "backboard-rebound-catch"))
                or (player.boost < 8 and not self.move) or distance > 1680):
            if self.move:
                self.cancel(tick)
            return follow

        free = all(math.hypot(*sub(target, vector(other.physics.location))) > 820 for other in opponents)
        if not self.move:
            if tick < self.next_attempt or player.boost < 14:
                return follow
            soft_intercept = (
                player.air_state == AirState.InAir and player.boost >= 16
                and 145 < distance < 710 and position[2] > 245 and 340 < target[2] < 1640
                and -115 < offset[2] < 310 and dot(front, unit(offset)) > .63
                and (free or keep_possession or (cover and distance < 455))
                and not on_target(ball, player.team) and abs(attack * target[1]) < 3750 and abs(target[0]) < 3450
                and not wanted.jump
            )
            if soft_intercept and free and distance < (460 if player.boost < 25 else 390):
                receiver = self.aerial_receiver(player, ball, teammates, opponents, attack)
                if receiver and not self.zen_touch_window(player, ball, offset):
                    self.begin("aerial-pass", "pass", player, tick)
                    self.receiver = receiver
            if soft_intercept and not self.move and (free or not recent_owner):
                zen = not recent_owner and self.zen_touch_window(player, ball, offset)
                relative = sub(vector(player.physics.velocity), vector(ball.velocity))
                closing = dot(relative, unit(offset))
                prepared_reset = recent_owner and offset[2] > 73 and player.boost >= 23
                if not self.move and (zen or (not prepared_reset and closing < max(470, (distance - 127) * 2.9))):
                    can_lift = (free and player.boost >= 26 and 430 < target[2] < 1190
                                and math.hypot(*sub(relative, scale(unit(offset), closing))) < 720
                                and offset[2] > 48 and abs(target[0]) < 3030
                                and attack * target[1] > -700 and ball.velocity.z < 430)
                    move = "zen-touch" if zen else ("reset-setup-touch" if can_lift else "soft-touch")
                    self.begin(move, "cushion", player, tick)
            if not self.move:
                self.dribble_start(player, ball, opponents, attack, front, offset, distance, free, tick)
            wall_route = (player.air_state == AirState.OnGround and abs(position[0]) > 3810
                          and position[2] > 820 and front[2] > .58 and wanted.throttle > .4)
            ceiling = position[2] > 1850 and player.air_state == AirState.OnGround and up[2] < -.6
            if (not self.move and (ceiling or wall_route) and ceiling_opening(ball, climbing=not ceiling)
                    and target[2] > (880 if wall_route else 1320) and distance < 1540):
                self.begin("ceiling-shot", "ceiling" if ceiling else "climb", player, tick)
            elif not self.move and player.air_state == AirState.InAir and 330 < target[2] < 1620 and position[2] > 265 and distance < 620:
                ball_speed = vector(ball.velocity)
                if (player.boost >= 42
                        and free and 2200 < attack * target[1] < 4200
                        and (0 <= getattr(packet.match_info, "seconds_elapsed", -2) - touched < .8 and touched >= 0)
                        and self.backboard_time(ball, attack) is not None):
                    self.begin("double-tap", "read-board", player, tick)
                elif (not recent_owner and (free or distance < 340)
                      and distance < 470 and self.zen_touch_window(player, ball, offset)):
                    self.begin("zen-touch", "cushion", player, tick)
                elif (distance < 390 and free
                      and (receiver := self.aerial_receiver(player, ball, teammates, opponents, attack))):
                    self.begin("aerial-pass", "pass", player, tick)
                    self.receiver = receiver
                elif (recent_owner and player.boost >= 23 and not reset_available(player)
                      and 150 < distance < 510 and 73 < offset[2] < 380 and abs(target[0]) < 3350
                      and -1300 < attack * target[1] < 2420
                      and attack * player.physics.velocity.y < 1120 and (free or distance < 280)):
                    self.begin("setup-reset-pop", "reset-pop-approach", player, tick)
                    self.reset_roll = 1 if offset[0] >= 0 else -1
                elif ((free or keep_possession or (cover and distance < 395 and not competing))
                      and distance < (675 if keep_possession else 575) and -105 < offset[2] < 275
                      and abs(attack * target[1]) < 4050 and dot(front, unit(offset)) > .61
                      and math.hypot(*ball_speed) < 1650
                      and dot(sub(vector(player.physics.velocity), ball_speed), unit(offset))
                      < max(385, (distance - 120) * 2.65)):
                    self.begin("soft-touch", "cushion", player, tick)
                elif (recent_owner and player.boost >= 56
                        and target[2] > 855 and offset[2] > 40 and not reset_available(player)):
                    self.begin("double-reset", "approach", player, tick)
                elif recent_owner and offset[2] > 70 and not reset_available(player):
                    self.begin("flip-reset", "approach", player, tick)
            if (not self.move and player.air_state == AirState.InAir and player.boost >= 22
                    and 200 < distance < 740 and 300 < target[2] < 1540
                    and dot(front, unit(offset)) > .54
                    and any(ally.boost < 22 and 0 <= self.match_seconds - touch_id(ally) < .46
                            for ally in teammates)):
                self.begin("teammate-follow-up", "carry", player, tick)
            if (not self.move and recent_owner and not competing
                    and player.air_state == AirState.InAir and player.boost >= 16
                    and position[2] > 175 and 155 < distance < 820
                    and 245 < target[2] < 1750 and abs(target[0]) < 3540
                    and attack * target[1] > -700
                    and dot(front, unit(offset)) > .31):
                self.begin("improvised-carry", "carry", player, tick)
            if not self.move:
                return follow

        if self.stage in ("chip", "bounce-wait", "bounce-rise", "pop", "pop-follow", "flick-lift"):
            launch = self.dribble_launch(player, ball, offset, distance, free, tick)
            if launch is not None or not self.move:
                return launch
        if tick - self.started > (330 if self.stage == 'carry' and player.boost >= 12 else 210) or (position[2] < 115 and self.move != "ground-to-air"):
            self.cancel(tick, retry=35 if self.stage in ("carry", "cushion") else None)
            return None
        goal_direction = unit(sub((0, attack * 5120, 260), target))
        direction = chase_direction(player, ball)
        upright = (0, 0, 1)
        if (self.move in ("first-touch-reset-pop", "setup-reset-pop")
                and self.stage not in ("carry", "bump", "second", "finish")):
            if any(touch_id(other) > self.touch and touch_id(other) > touched for other in teammates + opponents):
                nearby = self.contest(player, ball, opponents, distance)
                if nearby is not None and not any(touch_id(ally) > self.touch for ally in teammates):
                    self.stage, self.stage_tick = "carry", tick
                    return nearby
                self.cancel(tick)
                return None
            return self.reset_pop(player, ball, offset, distance, goal_direction, tick, free, opponents)
        if self.stage == "pass-redirect":
            if touched > self.touch:
                if player.boost >= 18 and self.backboard_time(ball, attack) is not None:
                    self.move, self.stage, self.touch = "double-tap", "read-board", touched
                    return self.double_tap(player, ball, attack, tick, opponents)
                self.cancel(tick, retry=90)
                return None
            if distance > 610 or tick - self.started > 50:
                self.cancel(tick, retry=55)
                return None
            projected = ball_path(ball, .12)
            lane, _ = goal_lane(projected, vector(ball.velocity), attack, opponents)
            aim = sub(sub(projected, scale(shot_normal(lane, vector(ball.velocity)), 55)), position)
            return dict(air_controls(player, aim, upright), jump=False, throttle=.85,
                        boost=distance > 160 and dot(front, unit(aim)) > .86)

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
                plan = getattr(self, "contact_plan", None)
                if plan is not None:
                    horizon, predicted_velocity, margin = plan
                    actual_velocity = vector(ball.velocity)
                    self.trace(player, self.move, ["contact-plan", horizon, margin,
                               [round(v) for v in predicted_velocity], [round(v) for v in actual_velocity]], tick)
                    self.contact_plan = None
                if player.boost >= 23 and attack * target[1] > 0:
                    if self.backboard_time(ball, attack) is not None:
                        self.move, self.stage = "double-tap", "read-board"
                        return self.double_tap(player, ball, attack, tick, opponents)
                    if ((free or distance < 265) and offset[2] > 48 and target[2] > 475 and distance < 405
                            and not reset_available(player)):
                        self.move, self.stage = "flip-reset", "approach"
                        self.was_reset = False
                        return dict(jump=False, boost=False)
            ally_touched = any(touch_id(ally) > self.touch for ally in teammates)
            opponent_touched = any(touch_id(enemy) > self.touch for enemy in opponents)
            intercepted = ally_touched or opponent_touched
            if not ally_touched and not free and (self.carry_touches or opponent_touched):
                nearby = self.contest(player, ball, opponents, distance)
                if nearby is not None and tick - self.stage_tick < 110:
                    return nearby
            if (intercepted or (not free and self.carry_touches == 0 and distance > (570 if self.move == "improvised-carry" else 380)) or distance > (1010 if player.boost >= 17 and self.stage == "carry" else 760)
                    or tick - self.stage_tick > (145 if player.boost >= 17 and self.stage == "carry" else 94) or (position[2] < 145 and self.move != "ground-to-air")):
                self.cancel(tick, retry=34)
                return follow if not intercepted else None
            if self.stage == "carry" and self.carry_touches > 0:
                if (ceiling is not None and ceiling < .52 and target[2] > 1180 and abs(target[0]) < 3230
                        and distance < 950 and player.boost >= 16):
                    self.stage, self.stage_tick = "ceiling-rebound", tick
                    self.move = "ceiling-rebound"
                    return self.ceiling_rebound(player, ball, opponents, attack, tick)
                if (recent_owner and free and player.boost >= 24 and not reset_available(player)
                        and 125 < distance < 455 and 70 < offset[2] < 360 and target[2] > 560
                        and abs(target[0]) < 3520 and tick - self.stage_tick >= 5):
                    self.stage, self.stage_tick = "reset-pop-approach", tick
                    self.move = "setup-reset-pop"
                    self.was_reset = False
                    self.reset_seen_at = self.reset_touch_at = None
                    self.reset_roll = 1 if offset[0] >= 0 else -1
                    return self.reset_approach(player, ball, offset, distance, goal_direction)
            if (self.stage == "carry" and self.carry_touches > 0 and free and player.boost >= 24
                    and attack * target[1] > 4620 and attack * ball.velocity.y < -260
                    and 480 < target[2] < 1450 and 155 < distance < 470):
                self.move = "backboard-rebound-catch"
                return self.cushion(player, ball, chase_direction(player, ball, (0, 0, -50)),
                                    distance, goal_direction)
            if self.stage == "carry" and self.carry_touches > 0 and tick - self.stage_tick >= 4:
                board_time = self.backboard_time(ball, attack)
                if (player.boost > 18 and board_time is not None
                        and attack * target[1] > 2250 and distance < 740
                        and all(math.hypot(*sub(ball_path(ball, board_time),
                                               vector(enemy.physics.location))) > 425
                                for enemy in opponents)):
                    self.move, self.stage = "double-tap", "read-board"
                    return self.double_tap(player, ball, attack, tick, opponents)
                if (flip_available(player) and 115 < distance < 205 and 2050 < attack * target[1] < 4875
                        and dot(unit(offset), goal_direction) > .77 and dot(front, unit(offset)) > .76
                        and not on_target(ball, player.team)
                        and (not free or attack * target[1] > 4000)):
                    return self.fire(player, tick)
                if not free and distance < 285 and dot(front, unit(offset)) > .75 and not on_target(ball, player.team):
                    # Meet the defender through the ball when the carry window closes.
                    aim = chase_direction(player, ball)
                    return dict(air_controls(player, aim, upright), jump=False, boost=distance > 165)
            if (self.carry_touches > 0
                    and on_target(ball, player.team) and player.boost >= 36
                    and tick >= self.next_air_bump):
                for defender in opponents:
                    gap = sub(vector(defender.physics.location), position)
                    if (165 < math.hypot(*gap) < 340 + (self.bumps - 70)
                            and dot(front, unit(gap)) > .93 and abs(gap[2]) < 125
                            and attack * (defender.physics.location.y - target[1]) > 0):
                        self.next_air_bump = tick + 1200
                        self.stage, self.stage_tick = "bump", tick
                        self.receiver = add(vector(defender.physics.location), scale(vector(defender.physics.velocity), min(.32, math.hypot(*gap) / max(900, math.hypot(*vector(player.physics.velocity)))) * (.65 + .005 * self.bumps)))
                        break
            if self.stage == "carry" and distance > 260 and not free:
                direction = self.follow_lane(player, ball, goal_direction, distance, opponents)
            return self.cushion(player, ball, direction, distance, goal_direction)
        if self.stage == "bump":
            if tick - self.stage_tick > 23 or not on_target(ball, player.team):
                self.cancel(tick)
                return None
            aim = sub(self.receiver, position)
            return dict(air_controls(player, aim, upright), jump=False, boost=dot(front, unit(aim)) > .82)

        if self.move == "double-tap":
            return self.double_tap(player, ball, attack, tick, opponents)

        if self.stage == "climb":
            if not ceiling_opening(ball, climbing=True):
                self.cancel(tick, retry=45)
                return None
            if position[2] >= 1850 and up[2] < -.5:
                self.stage = "ceiling"
            elif player.air_state == AirState.OnGround and abs(position[0]) > 3700:
                return dict(jump=False, throttle=1, boost=front[2] > .65)
            else:
                self.cancel(tick)
                return None
        if self.stage == "ceiling-lift":
            elapsed = tick - self.stage_tick
            if elapsed < 5:
                return dict(jump=False, boost=False)
            if flip_available(player) and distance < 213 and (not free or up[2] > .55):
                if not free and dot(front, unit(offset)) > .55 and distance < 185:
                    return self.fire(player, tick)
                if free and offset[2] > 48 and up[2] > .64:
                    self.stage, self.stage_tick = "carry", tick
                    return dict(jump=True, pitch=0, yaw=0, roll=0, boost=False)
            if elapsed > 36:
                self.stage, self.stage_tick = "finish", tick
            else:
                return dict(air_controls(player, direction, upright), jump=False, boost=False)
        if self.stage == "ceiling":
            if player.air_state == AirState.OnGround:
                if (self.move in ("ceiling-prejump", "ceiling-shot") and position[2] > 1860
                        and 135 < position[2] - target[2] < 485 and distance < 390
                        and (not free or player.boost >= 42)):
                    self.stage, self.stage_tick = "ceiling-lift", tick
                    return dict(jump=True, pitch=0, yaw=0, roll=0, boost=False)
                ceiling_direction = chase_direction(player, ball)
                tangent = unit((ceiling_direction[0], ceiling_direction[1], 0))
                _, left, _ = basis(player.physics.rotation)
                alignment = dot(front, tangent)
                if (self.move in ("ceiling-redirect", "ceiling-shot", "ceiling-prejump")
                        and alignment > .67 and 200 < position[2] - target[2] < 510
                        and math.hypot(offset[0], offset[1]) < 225 and ball.velocity.z < -120
                        and player.boost >= 18):
                    self.stage, self.stage_tick = "ceiling-lift", tick
                    return dict(jump=True, pitch=0, yaw=0, roll=0, boost=False)
                throttle = .85 if alignment > .80 else .48
                return dict(jump=False, boost=False, throttle=throttle,
                            steer=clip(dot(left, tangent) * 1.55))
            if not flip_available(player):
                self.cancel(tick)
                return None
            self.stage = "finish"
            self.stage_tick = tick

        if self.stage in ("approach", "second"):
            if self.confirm_reset(player, tick, distance):
                self.reset_count += 1
                self.touch = touched
                self.trace(player, self.move, f"reset-{self.reset_count}", tick)
                self.stage_tick = tick
                if (self.reset_count == 1 and self.move == "flip-reset" and free
                      and player.boost >= 18 and attack * target[1] < 3100
                      and attack * player.physics.velocity.y < 1050):
                    self.move, self.stage = "setup-reset-pop", "reset-pop-align"
                else:
                    self.stage = "spend" if self.move == "double-reset" and self.reset_count == 1 else "finish"
                return dict(jump=False, boost=False)
            fallback = self.reset_fallback(player, ball, opponents, distance, goal_direction, tick, free)
            if fallback is not None:
                return fallback
            return self.reset_approach(player, ball, offset, distance, goal_direction)

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

        if not flip_available(player):
            if distance < 380 and player.air_state == AirState.InAir and tick - self.stage_tick < 60:
                self.stage, self.stage_tick = "carry", tick
                self.carry_touches = 1 if touched >= 0 else 0
                return self.cushion(player, ball, direction, distance, goal_direction)
            self.cancel(tick, retry=90)
            return None
        challenge = (self.reset_count > 0 and distance < 192
                     and any(math.hypot(*sub(target, vector(enemy.physics.location))) < 490
                             for enemy in opponents))
        lane, _ = goal_lane(target, vector(ball.velocity), attack, opponents)
        normal = shot_normal(lane, vector(ball.velocity))
        board_setup = (self.reset_count > 0 and free and player.boost >= 34
                       and 2980 < attack * target[1] < 4210 and 540 < target[2] < 1220
                       and abs(target[0]) < 1420 and not on_target(ball, player.team))
        if board_setup:
            board_lane = unit(sub((target[0] * .65, attack * 5120, 1020), target))
            board_normal = shot_normal(board_lane, vector(ball.velocity))
            if dot(unit(offset), board_normal) > .78:
                normal = board_normal
            else:
                board_setup = False
        contact = unit(offset)
        if (self.release_tick is not None and tick - self.release_tick >= 3 and distance <= 195
                and dot(front, contact) > (.51 if challenge else .62)
                and (challenge or dot(contact, normal) > .50)):
            if board_setup:
                self.move = "reset-double-tap"
            changes = self.fire(player, tick)
            _, left, _ = basis(player.physics.rotation)
            return dict(changes, yaw=clip(dot(unit(add(contact, normal)), left) * 1.25),
                        boost=challenge or distance > 170)
        if self.release_tick is None:
            self.release_tick = tick
        aim = sub(direction, scale(normal, 36 if distance > 180 else 10))
        return dict(air_controls(player, aim, upright), jump=False,
                    boost=distance > 165 and dot(front, unit(aim)) > .83)
