import math
from pathlib import Path
from types import SimpleNamespace as O
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
from rlbot.flat import AirState, ControllerState
from rlc_advanced_moves import AdvancedMoves, flip_available, on_target


def vec(x, y, z):
    return O(x=x, y=y, z=z)


def player(x, y, z, boost=60):
    return O(team=0, name="zen", is_bot=True, boost=boost, air_state=AirState.InAir,
             latest_touch=None, has_jumped=True, has_double_jumped=False, has_dodged=False,
             dodge_timeout=1, demolished_timeout=-1,
             physics=O(location=vec(x, y, z), rotation=O(pitch=0, yaw=math.pi / 2, roll=0),
                       angular_velocity=vec(0, 0, 0), velocity=vec(0, 1000, 0)))


def match(car, x, y, z):
    cover = player(0, -1400, 18)
    cover.air_state = AirState.OnGround
    ball = O(location=vec(x, y, z), velocity=vec(0, 0, 0))
    packet = O(players=[car, cover], balls=[O(physics=ball)], match_info=O(frame_num=10))
    return packet, ball


def touch(car, seconds):
    car.latest_touch = O(game_seconds=seconds, ball_index=0)
    car.has_jumped = car.has_double_jumped = car.has_dodged = False


controls = ControllerState(throttle=1)
car = player(0, 0, 450, 45)
car.physics.velocity.y = 1320
packet, ball = match(car, 0, 195, 560)
car.latest_touch = O(game_seconds=.2, ball_index=0)
packet.match_info.seconds_elapsed = .35
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] is False
assert move.move == "flip-reset"
touch(car, 1)
ball.location = vec(0, 130, 540)
assert move.update(packet, 0, controls)["jump"] is False
assert move.reset_count == 1 and move.stage == "finish"
ball.location = vec(0, 140, 475)
packet.match_info.frame_num = 20
assert move.update(packet, 0, controls)["jump"] is False
packet.match_info.frame_num = 24
assert move.update(packet, 0, controls)["pitch"] == -1
assert move.pending_shot[0] == "flip-reset"

car = player(0, 0, 900)
car.physics.velocity.y = 1320
packet, ball = match(car, 0, 130, 1050)
car.latest_touch = O(game_seconds=.2, ball_index=0)
packet.match_info.seconds_elapsed = .35
move = AdvancedMoves()
move.update(packet, 0, controls)
assert move.move == "double-reset"
touch(car, 1)
move.update(packet, 0, controls)
assert move.stage == "spend"
packet.match_info.frame_num = 15
spent = move.update(packet, 0, controls)
assert spent["jump"] and spent["pitch"] == 0
car.has_double_jumped = True
packet.match_info.frame_num = 27
move.update(packet, 0, controls)
assert move.stage == "second"
touch(car, 2)
move.update(packet, 0, controls)
assert move.stage == "finish" and move.reset_count == 2

car = player(0, 0, 2000, 40)
car.has_jumped = False
car.air_state = AirState.OnGround
car.physics.rotation.roll = math.pi
packet, ball = match(car, 0, 190, 1690)
move = AdvancedMoves()
assert not move.update(packet, 0, controls)["jump"]
assert move.move == "ceiling-shot"
car.air_state = AirState.InAir
car.physics.location.z = 1700
car.physics.rotation.roll = 0
assert not move.update(packet, 0, controls)["jump"]
assert move.stage == "finish"
packet.players.pop()
assert move.update(packet, 0, controls) is None and move.move is None
assert on_target(O(location=vec(0, 4000, 300), velocity=vec(0, 2000, 0)), 0)
assert not on_target(O(location=vec(1300, 4000, 300), velocity=vec(0, 2000, 0)), 0)
print("Competitive sequences, confirmed reset transitions, cover cancellation and shot projection passed.")

car = player(0, 0, 560)
car.physics.velocity = vec(0, 1120, 0)
packet, ball = match(car, 0, 200, 640)
ball.velocity = vec(0, -130, 0)
move = AdvancedMoves()
result = move.update(packet, 0, controls)
assert move.move == "zen-touch" and not result["boost"] and result["roll"] != 0 and result["pitch"] > 0
car.latest_touch = O(game_seconds=.2, ball_index=0)
packet.match_info.seconds_elapsed = .35
follow = AdvancedMoves()
follow.update(packet, 0, controls)
assert follow.move != "zen-touch"
car.latest_touch = None
ball.velocity.y = 100
outbound = AdvancedMoves()
outbound.update(packet, 0, controls)
assert outbound.move != "zen-touch"
ball.velocity.y = -130
opponent = player(0, 310, 400)
opponent.team = 1
packet.players.append(opponent)
touch(opponent, 1)
assert move.update(packet, 0, controls) is None
assert move.move is None

car = player(0, 2650, 790)
packet, ball = match(car, 0, 3100, 990)
ball.velocity = vec(0, 2200, 230)
touch(car, 1)
packet.match_info.seconds_elapsed = 1.2
move = AdvancedMoves()
assert move.update(packet, 0, controls) is not None
assert move.move == "double-tap"
packet.match_info.frame_num += 100
ball.location, ball.velocity = vec(0, 4930, 1000), vec(0, -1300, -250)
car.physics.location = vec(0, 4430, 850)
assert move.update(packet, 0, controls) is not None
assert move.stage == "rebound"

from rlc_bot_style import BotStyle
car = player(0, -1250, 18)
car.air_state = AirState.OnGround
packet, ball = match(car, 0, 600, 560)
packet.players[1].air_state = AirState.InAir
packet.players[1].physics.location = vec(0, 400, 490)
assert BotStyle.cover_aerial(packet, 0, ball)["jump"] is False
packet.players[1].air_state = AirState.OnGround
assert BotStyle.cover_aerial(packet, 0, ball) is None
car.physics.location = vec(0, -900, 220)
car.physics.velocity = vec(0, 900, -450)
car.physics.rotation.roll = 1
assert BotStyle.recover(car, ball)["roll"] != 0

car = player(0, 0, 560)
car.physics.velocity = vec(0, 230, 0)
packet, ball = match(car, 0, 200, 640)
move = AdvancedMoves()
assert move.update(packet, 0, controls)
touch(car, 1)
packet.match_info.frame_num += 14
assert move.update(packet, 0, controls)
assert move.stage == "carry" and move.carry_touches == 1
touch(packet.players[1], 1.2)
assert move.update(packet, 0, controls) is None

blue_left, blue_right = player(256, -3840, 18), player(-256, -3840, 18)
orange_left, orange_right = player(-256, 3840, 18), player(256, 3840, 18)
orange_left.team = orange_right.team = 1
kickoff = O(players=[blue_right, orange_right, blue_left, orange_left])
assert BotStyle.kickoff_taker(kickoff, 0) == 2
assert BotStyle.kickoff_taker(kickoff, 1) == 3
blue_left.is_bot = False
assert BotStyle.kickoff_taker(kickoff, 0) == 2

car = player(0, 0, 18)
car.air_state = AirState.OnGround
packet, ball = match(car, 0, 180, 170)
ball.velocity.z = -300
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] is False
assert move.stage == "bounce-wait"
car.physics.location.y = 50
packet.match_info.frame_num += 5
assert move.update(packet, 0, controls)["jump"] is False
ball.location.z = 108
ball.velocity.z = 315
packet.match_info.frame_num += 15
assert move.update(packet, 0, controls)["jump"] is True
assert move.stage == "bounce-rise"
car.air_state = AirState.InAir
car.physics.location = vec(0, 110, 85)
ball.location.z = 164
packet.match_info.frame_num += 13
assert move.update(packet, 0, controls)["jump"] is False
touch(car, 1)
packet.match_info.frame_num += 4
assert not move.update(packet, 0, controls)["jump"]
assert move.stage == "carry"
print("Carry retouch, interception release, mirrored kickoff ties and ground-to-air transition passed.")
import rlc_bot_style
from rlbot.flat import MatchPhase
rlc_bot_style._profiles = lambda: ("test-kickoff", {"zen": {"mechanics": 94, "isPublic": True}})
blue_left.is_bot = True
blue_right.player_id, blue_left.player_id = 4, 6
kickoff.match_info = O(frame_num=11, match_phase=MatchPhase.Kickoff)
kickoff.balls = [O(physics=O(location=vec(0, 0, 93)))]
support = BotStyle().apply(kickoff, 0, ControllerState(throttle=1, boost=True))
assert support.throttle > 0 and not support.boost and not support.jump
assert BotStyle().apply(kickoff, 2, ControllerState(throttle=1, boost=True)).throttle == 1

car = player(0, 500, 20)
car.air_state = AirState.OnGround
car.physics.rotation.yaw = 0
packet, ball = match(car, 330, 515, 95)
enemy = player(400, 960, 18)
enemy.physics.velocity.y = -890
enemy.team = 1
packet.players.append(enemy)
move = AdvancedMoves()
assert move.update(packet, 0, controls)["boost"] is False
assert move.move == "fake-challenge"

car = player(110, -5030, 255, 60)
packet, ball = match(car, 20, -4460, 275)
ball.velocity = vec(0, -2000, 180)
assert AdvancedMoves().update(packet, 0, controls) is not None

car = player(0, 3170, 1390)
car.physics.velocity = vec(0, 1050, 450)
packet, ball = match(car, 0, 3380, 1460)
move = AdvancedMoves()
assert move.update(packet, 0, controls) is not None
assert move.stage == "board-hit"
touch(car, 1)
ball.velocity = vec(0, 2600, 450)
assert move.update(packet, 0, controls) is not None
assert move.stage == "ceiling-reset"
car.air_state = AirState.OnGround
car.physics.location.z = 1960
car.physics.rotation.roll = math.pi
packet.match_info.frame_num += 36
assert move.update(packet, 0, controls)["jump"] is False
assert move.stage == "read-board"

car = player(0, 0, 18)
car.air_state = AirState.OnGround
packet, ball = match(car, 0, 250, 95)
receiver = player(550, 1080, 18)
receiver.air_state = AirState.OnGround
packet.players.append(receiver)
move = AdvancedMoves()
assert move.update(packet, 0, controls)["throttle"] > .9
assert move.move == "ground-pass"
print("Kickoff support, fake, goal-line save approach, ceiling contact gate and ground-pass route passed.")

idle = BotStyle()
car = player(0, -5090, 18)
car.air_state = AirState.OnGround
car.physics.velocity = vec(0, 0, 0)
packet, ball = match(car, 0, 1600, 520)
neutral = ControllerState()
assert idle.leave_idle_goal(car, ball, neutral, 10) is None
assert idle.leave_idle_goal(car, ball, neutral, 111)["throttle"] > 0
ball.velocity = vec(0, -2200, 0)
assert idle.leave_idle_goal(car, ball, neutral, 112) is None
assert idle.cover_aerial(packet, 0, ball) is None

car = player(0, 0, 650)
packet, ball = match(car, 0, 325, 805)
assert AdvancedMoves().update(packet, 0, controls) is None
move = AdvancedMoves()
move.begin("setup-reset-pop", "reset-pop-approach", car, 10)
assert move.update(packet, 0, controls)["jump"] is False
car.has_jumped = False
ball.location = vec(0, 156, 758)
packet.match_info.frame_num = 24
assert move.update(packet, 0, controls)["jump"] is False
assert move.stage == "reset-pop-approach"
touch(car, 1)
packet.match_info.frame_num = 27
assert move.update(packet, 0, controls)["jump"] is False
assert move.stage == "reset-pop-align"
packet.match_info.frame_num = 33
assert move.update(packet, 0, controls)["jump"] is True
assert move.stage == "reset-pop-follow"
touch(car, 1.1)
car.has_dodged = True
ball.location.z = 810
packet.match_info.frame_num = 42
assert move.update(packet, 0, controls)["jump"] is False
assert move.stage == "second"

for kind in ("carry", "read-board"):
    car = player(0, 2700, 620)
    packet, ball = match(car, 0, 2990, 685 if kind == "carry" else 980)
    move = AdvancedMoves()
    move.begin("first-touch-reset-pop", "reset-pop-follow", car, 10)
    touch(car, 1)
    car.has_dodged = True
    if kind == "read-board":
        ball.velocity = vec(0, 2450, 325)
    assert move.update(packet, 0, controls)["jump"] is False
    assert move.stage == kind
print("Goal-exit timeout, incoming-shot protection, asynchronous reset confirmation, pop and follow-up routes passed.")

from rlc_bot_style import execution_precision
outputs = []
for rating in (30, 98):
    rlc_bot_style._profiles = lambda: ("same-match", {
        "zen": {"mechanics": rating, "ballControl": rating, "gameSense": rating, "isPublic": True}
    })
    car = player(0, 0, 650)
    car.player_id = 7
    car.physics.velocity = vec(0, 1080, 0)
    packet, ball = match(car, 0, 240, 770)
    ball.velocity = vec(0, -105, 0)
    packet.match_info.match_phase = MatchPhase.Active
    style = BotStyle()
    output = style.apply(packet, 0, controls)
    assert style.advanced.move == "zen-touch"
    outputs.append(output)
assert outputs[0].jump == outputs[1].jump
assert sum(abs(getattr(outputs[0], axis)) for axis in ("pitch", "yaw", "roll")) < sum(abs(getattr(outputs[1], axis)) for axis in ("pitch", "yaw", "roll"))
command = dict(jump=True, boost=True, pitch=-.62, yaw=.1, roll=0)
low = execution_precision(command, 25, 25, 25, 10)
assert low["jump"] and low["boost"] and low["roll"] == 0
assert math.hypot(low["pitch"], low["yaw"]) >= .5999
assert execution_precision(command, 100, 100, 100, 10) == command
print("Same move at 30 and 98, distinct analog precision and intact dodge buttons.")

shooter = player(0, 3200, 18)
shooter.air_state = AirState.OnGround
packet, ball = match(shooter, 0, 3590, 93)
shot = BotStyle.close_play(packet, 0, ball, controls)
assert shot and shot["throttle"] == 1 and not shot["jump"]
challenger = player(-440, 3420, 18)
challenger.air_state = AirState.OnGround
challenger.physics.rotation.yaw = 0
packet.players.append(challenger)
assert BotStyle.close_play(packet, 2, ball, controls)["throttle"] < 1

carrier = player(0, 2100, 18)
carrier.air_state = AirState.OnGround
packet, ball = match(carrier, 0, 2125, 150)
ball.velocity = vec(0, 950, 0)
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"]
assert move.move == "ground-to-air"
enemy = player(380, 2910, 18)
enemy.team = 1
packet.players.append(enemy)
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"]
assert move.move == "45-flick"
carrier.air_state = AirState.InAir
carrier.physics.location.z = 85
packet.match_info.frame_num += 17
flick = move.update(packet, 0, controls)
assert flick["jump"] and flick["yaw"] != 0

print("Open-net shot, challenge yield, roof-pop choice and 45-degree flick passed.")

car = player(0, -620, 18)
car.air_state = AirState.OnGround
car.physics.rotation.yaw = math.pi / 2
enemy = player(0, 620, 18)
enemy.team = 1
enemy.air_state = AirState.OnGround
enemy.physics.velocity = vec(0, -1550, 0)
packet, ball = match(car, 0, 0, 93)
packet.players.append(enemy)
adjusted = BotStyle.contested_kickoff(packet, 0, ControllerState(throttle=.4, steer=.8))
assert adjusted and adjusted["throttle"] == 1 and abs(adjusted["steer"]) < .01
enemy.physics.velocity.y = 0
assert BotStyle.contested_kickoff(packet, 0, controls) is None

car = player(0, -610, 18)
car.air_state = AirState.OnGround
packet, ball = match(car, 0, 850, 152)
packet.players[1].physics.location.y = -2000
enemy = player(0, 1110, 18)
enemy.team = 1
enemy.air_state = AirState.OnGround
enemy.physics.velocity = vec(0, -1050, 0)
packet.players.append(enemy)
forecast = BotStyle.prejump_clear(packet, 0, ball)
assert forecast == (0, 195, 395)
packet.players.pop(1)
assert BotStyle.prejump_clear(packet, 0, ball) is None

car = player(15, -100, 235)
car.physics.velocity = vec(0, 90, -950)
car.physics.rotation.roll = math.pi * .85
packet, ball = match(car, 0, 1000, 550)
landing = BotStyle.recover(car, ball, urgent=True)
assert landing and abs(landing["roll"]) > .8 and not landing["boost"]

car = player(0, 2800, 1960)
car.air_state = AirState.OnGround
car.has_jumped = False
car.physics.rotation.roll = math.pi
packet, ball = match(car, 0, 2500, 1450)
ball.velocity = vec(0, 920, 250)
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] is False
assert move.move == "ceiling-prejump"
car.air_state = AirState.InAir
car.physics.location.z = 1740
car.physics.rotation.roll = .2
packet.match_info.frame_num += 6
assert move.update(packet, 0, controls)["jump"] is False
assert move.stage == "finish" and flip_available(car)
print("Kickoff contention, clear prejump, low-speed landing and ceiling flip retention passed.")

wall_car = player(3730, 100, 620)
wall_car.physics.velocity = vec(1100, 850, 0)
wall_car.physics.rotation.yaw = math.pi / 3
packet, ball = match(wall_car, 1800, 1200, 1000)
wall = BotStyle.surface_recovery(wall_car, ball)
assert wall and abs(wall["roll"]) > .1 and wall["boost"] is False
wall_car.physics.location = vec(0, 980, 1850)
wall_car.physics.velocity = vec(0, 750, 720)
ceiling = BotStyle.surface_recovery(wall_car, ball)
assert ceiling and abs(ceiling["roll"]) > .1 and ceiling["jump"] is False

third = player(250, 200, 18)
third.air_state = AirState.OnGround
packet, ball = match(third, 0, 1600, 620)
packet.players[1].physics.location.y = 970
packet.players.append(player(-250, 1150, 280))
assert BotStyle.rotation_cover(packet, 0, ball, controls)["throttle"] > 0
assert BotStyle.rotation_cover(packet, 1, ball, controls) is None

car = player(0, 0, 18)
car.air_state = AirState.OnGround
car.physics.velocity = vec(0, 800, 0)
packet, ball = match(car, 0, 195, 148)
ball.velocity = vec(0, 810, 290)
move = AdvancedMoves()
assert not move.update(packet, 0, controls)["jump"]
assert move.stage == "bounce-wait"
print("Wall and ceiling wheel-side recovery, third-player rotation and rising bounce launch passed.")

from rlc_advanced_moves import predicted_touch
collector = player(0, 0, 18, 25)
collector.air_state = AirState.OnGround
packet, ball = match(collector, 0, 1950, 95)
pad = O(location=vec(115, 340, 70))
packet.boost_pads = [O(is_active=True)]
field_info = O(boost_pads=[pad])
pickup = BotStyle.boost_pickup(packet, collector, ball, controls, field_info)
assert pickup and abs(pickup["steer"]) > .1 and not pickup["boost"]
packet.boost_pads[0].is_active = False
assert BotStyle.boost_pickup(packet, collector, ball, controls, field_info) is None

opponent = player(0, 430, 120)
opponent.team = 1
opponent.physics.velocity = vec(0, -1300, 30)
packet, ball = match(collector, 0, 0, 168)
forecast = predicted_touch(ball, [opponent], .50)
assert forecast and forecast[1] < -220
opponent.physics.velocity.x = 1100
assert predicted_touch(ball, [opponent], .50) is None

carrier = player(0, 3000, 725, 40)
carrier.physics.velocity = vec(0, 780, 500)
packet, ball = match(carrier, 0, 3210, 950)
ball.velocity = vec(0, 460, -200)
move = AdvancedMoves()
move.begin("first-touch-reset-pop", "reset-pop-approach", carrier, 10)
move.reset_roll = 1
command = move.update(packet, 0, controls)
assert command and command["boost"]
carrier.physics.location = vec(0, 3155, 828)
carrier.physics.rotation.roll = math.pi
packet.match_info.frame_num += 4
align = move.update(packet, 0, controls)
assert align and not align["boost"] and not align["jump"]
print("Active reset chase, late wheel alignment, boost-pad correction and collision forecast passed.")

car = player(0, -1000, 94)
car.physics.velocity = vec(0, 870, -400)
car.physics.rotation.pitch = .16
packet, ball = match(car, 0, 1000, 400)
style = BotStyle()
assert not style.recovery_wave_dash(car, ball, controls, 10)["jump"]
car.physics.location.z = 35
dash = style.recovery_wave_dash(car, ball, controls, 24)
assert dash["jump"] and dash["pitch"] == -1 and not dash["boost"]
assert style.recovery_wave_dash(car, ball, controls, 25) is None
car.has_dodged = True
assert BotStyle().recovery_wave_dash(car, ball, controls, 26) is None
car.has_dodged = False
car.physics.rotation.roll = 1
assert BotStyle().recovery_wave_dash(car, ball, controls, 26) is None
print("Wave dash timing, preserved boost, and unavailable or unsafe dodge checks passed.")

from rlc_advanced_moves import goal_lane, reset_orientation, shot_normal
car = player(0, 2100, 600)
car.physics.rotation.roll = math.pi
car.physics.angular_velocity = vec(0, 0, 0)
stable = reset_orientation(car, (0, 1, 0), (0, 0, -1), 1)
assert max(abs(value) for value in stable.values()) < .001
car.physics.rotation.roll -= .20
correct = reset_orientation(car, (0, 1, 0), (0, 0, -1), 1)
assert abs(correct["roll"]) > .65

blocker = player(0, 5020, 145)
blocker.team = 1
blocker.physics.velocity = vec(0, 0, 0)
lane, _ = goal_lane((0, 3900, 300), (0, 720, 0), 1, [blocker])
assert abs(lane[0]) > .22
normal = shot_normal((0, 1, 0), (650, 1250, 0))
assert normal[0] < 0 and normal[1] > .96
print("Four-wheel pose alignment and shot drift compensation passed.")

car = player(0, 0, 620, 45)
packet, ball = match(car, 0, 430, 690)
enemy = player(10, 806, 680)
enemy.team = 1
enemy.physics.velocity = vec(0, -1020, 0)
packet.players.append(enemy)
assert AdvancedMoves.contest(car, ball, [enemy], 436)["boost"]
enemy.physics.velocity.y = 40
assert AdvancedMoves.contest(car, ball, [enemy], 436) is None

print("Reachable 50/50 contest passed.")

from rlc_advanced_moves import aerial_pass_plan
passer = player(0, 300, 18)
passer.air_state = AirState.OnGround
passer.latest_touch = O(game_seconds=4, ball_index=0)
packet, ball = match(passer, 0, 455, 122)
packet.match_info.seconds_elapsed = 4.2
ball.velocity = vec(0, 370, 0)
receiver = player(220, 1940, 18)
receiver.air_state = AirState.OnGround
receiver.physics.velocity = vec(0, 570, 0)
packet.players.append(receiver)
plan = aerial_pass_plan(packet, ball, passer.team)
assert plan and plan.passer == 0 and plan.receiver == 2
sender_policy, receiver_policy = BotStyle(), BotStyle()
assert sender_policy.aerial_pass_controls(packet, 0, ball, 10)["jump"]
assert receiver_policy.aerial_pass_controls(packet, 2, ball, 10)["jump"]
assert BotStyle().aerial_pass_controls(packet, 1, ball, 10) is None
passer.latest_touch.game_seconds = 4.3
receiver.air_state = AirState.InAir
receiver.physics.location.z = 360
ball.location = vec(130, 1620, 370)
ball.velocity = vec(150, 1470, 10)
assert receiver_policy.aerial_pass_controls(packet, 2, ball, 33) is None and receiver_policy.pass_play is None
assert sender_policy.aerial_pass_controls(packet, 0, ball, 33) is None and sender_policy.pass_play is None
print("Both bots select the same pass, leave cover free and hand off on reception.")

from rlc_advanced_moves import ball_path, ceiling_opening, ceiling_time
car = player(0, 0, 1360)
packet, ball = match(car, 3910, 250, 1090)
ball.velocity = vec(0, 350, 35)
assert not ceiling_opening(ball, climbing=True)
ball.location = vec(0, 320, 1610)
ball.velocity = vec(0, 530, 1450)
assert ceiling_opening(ball)
bounce = ceiling_time(ball)
assert 0 < bounce < .35
assert ball_path(ball, bounce + .20)[2] < ball_path(ball, bounce)[2]
touch(car, 1)
car.has_jumped = True
packet.match_info.seconds_elapsed = 1.15
move = AdvancedMoves()
assert move.update(packet, 0, controls) is not None
assert move.stage == "ceiling-rebound"
ball.location = vec(0, 230, 1640)
ball.velocity = vec(0, 410, -590)
packet.match_info.frame_num += 22
assert move.update(packet, 0, controls) is not None
assert move.stage == "reset-pop-approach"
print("Ceiling clearance, post-impact prediction and rebound-to-reset transition passed.")

car = player(0, 2650, 680, 0)
touch(car, 2)
packet, ball = match(car, 0, 2826, 714)
packet.match_info.seconds_elapsed = 2.15
move = AdvancedMoves()
prep = move.update(packet, 0, controls)
assert prep and not prep["jump"] and not prep["boost"] and move.move == "empty-boost-reset"
packet.match_info.frame_num += 4
flick = move.update(packet, 0, controls)
assert flick and flick["jump"] and flick["pitch"] < 0 and not flick["boost"]

car = player(0, 1400, 640, 30)
car.physics.velocity = vec(0, 1290, 0)
touch(car, 2)
packet, ball = match(car, 55, 1850, 666)
packet.players[1].physics.location = vec(38, 1310, 620)
packet.players[1].air_state = AirState.InAir
packet.players[1].physics.velocity = vec(0, 1440, 0)
packet.match_info.seconds_elapsed = 2.2
move = AdvancedMoves()
move.next_attempt = 50
follow = move.update(packet, 0, controls)
assert follow and not follow["jump"]

car = player(0, 3000, 18)
car.air_state = AirState.OnGround
packet, ball = match(car, 33, 3108, 93)
close = BotStyle.close_play(packet, 0, ball, controls)
assert close and close["steer"] != 0 and close["throttle"] == 1
print("Boost-empty reset dodge, retained follow with a trailing ally, and final ground contact steering passed.")

carrier = player(0, 1140, 910, 49)
carrier.physics.velocity.y = 680
carrier.latest_touch = O(game_seconds=1, ball_index=0)
packet, ball = match(carrier, 0, 1400, 1055)
packet.match_info.seconds_elapsed = 1.2
move = AdvancedMoves()
assert move.update(packet, 0, controls) and move.move == "setup-reset-pop"
touch(carrier, 1.23)
ball.location.y = 1320
packet.match_info.frame_num = 24
assert not move.update(packet, 0, controls)["jump"]
assert move.stage == "reset-pop-align"

wall_car = player(3980, 800, 610)
wall_car.air_state = AirState.OnGround
wall_car.physics.rotation.pitch = .60
wall_car.physics.rotation.roll = math.pi / 2
packet, ball = match(wall_car, 3950, 985, 727)
ball.velocity = vec(0, 500, 360)
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] and move.move == "wall-dodge-air-dribble"
wall_car.air_state = AirState.InAir
packet.match_info.frame_num += 2
assert not move.update(packet, 0, controls)["jump"]
packet.match_info.frame_num += 4
assert move.update(packet, 0, controls)["jump"] and move.stage == "wall-dodge-follow"
touch(wall_car, 1)
assert not move.update(packet, 0, controls)["jump"] and move.stage == "carry"
print("Slow carry reset priority and wall launch into aerial carry passed.")

carrier = player(0, 1950, 18)
carrier.air_state = AirState.OnGround
packet, ball = match(carrier, 0, 1980, 148)
ball.velocity.y = 970
defender = player(140, 2510, 18)
defender.team = 1
defender.air_state = AirState.OnGround
defender.physics.velocity.y = -700
packet.players.append(defender)
move = AdvancedMoves()
fake = move.update(packet, 0, controls)
assert move.move == "fake-flick" and fake["jump"] is False and fake["throttle"] < .5
defender.physics.velocity.y = 400
other = AdvancedMoves()
other.update(packet, 0, controls)
assert other.move != "fake-flick"
print("Fake flick requires a defender closing into the lane.")

car = player(0, 800, 18, 45)
car.air_state = AirState.OnGround
car.physics.velocity.y = 900
packet, ball = match(car, 0, 1010, 93)
ball.velocity.y = 550
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] is False and move.stage == "chip"
touch(car, 1)
ball.velocity.z = 280
packet.match_info.frame_num += 6
assert move.update(packet, 0, controls)["jump"] and move.stage == "bounce-rise"
print("Rolling chip waits for a confirmed lifting touch before jumping.")

wall_car = player(3980, 800, 610, 40)
wall_car.air_state = AirState.OnGround
wall_car.physics.rotation.pitch = .48
wall_car.physics.rotation.roll = math.pi / 2
wall_car.physics.velocity = vec(0, 420, 175)
packet, ball = match(wall_car, 3960, 955, 665)
ball.velocity = vec(0, 410, 80)
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] and move.stage == "wall-soft-follow"
wall_car.air_state = AirState.InAir
packet.match_info.frame_num += 6
assert not move.update(packet, 0, controls)["jump"]
touch(wall_car, 1)
assert move.update(packet, 0, controls) and move.stage == "carry"
print("Soft wall touch uses a single jump and keeps the carry after contact.")

car = player(0, 1100, 550, 45)
car.physics.velocity.y = 760
packet, ball = match(car, 0, 1320, 630)
ball.velocity.y = 450
move = AdvancedMoves()
assert move.update(packet, 0, controls) and move.move == "reset-setup-touch"
ball.location.y = 1250
car.physics.velocity.y = 1200
assert move.update(packet, 0, controls)["boost"] is False
touch(car, 1)
assert move.update(packet, 0, controls) and move.stage == "carry"
print("Approaching soft touch releases boost on fast closure and continues after confirmed contact.")


plane = AdvancedMoves.reset_contact_plane
assert plane((18, 20, 128), (20, 25, 130), (0, 0, -1))[2] > .90
assert plane((145, 20, 22), (150, 0, 35), (-1, 0, 0))[0] > .90
assert plane((25, 28, -132), (20, 40, -140), (0, 0, 1))[2] < -.85
car = player(0, 1100, 550, 45)
packet, ball = match(car, 0, 1320, 630)
move = AdvancedMoves()
move.begin("setup-reset-pop", "reset-pop-approach", car, 10)
assert move.reset_fallback(car, ball, [], 234, (0, 1, 0), 35, True) is None
assert move.reset_fallback(car, ball, [], 234, (0, 1, 0), 100, True)
assert move.stage == "carry" and move.reset_count == 0
print("Below, lateral and descending reset geometry, plus fallback without fake reset confirmation, passed.")

from rlc_advanced_moves import ball_forecast, ball_path
ball = O(location=vec(0, 0, 700), velocity=vec(0, 0, 0))
slices = [O(game_seconds=10 + offset, physics=O(location=vec(x, 0, 700)))
          for offset, x in ((0, 0), (.25, 300), (.50, 400))]
token = ball_forecast.set((ball, 10, slices))
try:
    assert abs(ball_path(ball, .375)[0] - 350) < .01
    assert ball_path(ball, .75)[0] == 0
finally:
    ball_forecast.reset(token)
assert ball_path(ball, .375)[0] == 0
print("Native trajectory interpolation, bounds and scoped fallback passed.")

# Exercise the refined planner directly. Most move fixtures use the fallback
# without native prediction, so they cannot catch a failure in this path.
from rlc_advanced_moves import plan_aerial_contact

for x, y, z, vx, vy, vz in (
    (0, 320, 680, 110, 1200, -90),
    (3650, 440, 820, -390, 710, 310),
    (-150, 250, 270, 100, 510, 355),
):
    car = player(x - 50, y - 205, z - 110, 42)
    car.physics.velocity = vec(80, 950, 170)
    packet, ball = match(car, x, y, z)
    ball.velocity = vec(vx, vy, vz)
    result = plan_aerial_contact(car, ball, .24, (0, .8, .6), (0, 1, 0), False)
    target, projected, normal, horizon, outgoing, margin = result
    assert .065 <= horizon <= .52
    assert all(math.isfinite(value) for value in (*target, *projected, *normal, *outgoing, margin))
    assert abs(math.hypot(*normal) - 1) < .001
print("Refined contact planner returns finite candidates for interception, wall lift and rising bounce.")

# A newly acquired ceiling-rebound reset can be spent on the next tick
# when the descending ball is reachable in the dodge plane.
car = player(0, 300, 1330, 35)
packet, ball = match(car, 0, 450, 1390)
ball.velocity = vec(0, 0, -500)
touch(car, 1)
move = AdvancedMoves()
move.begin("first-touch-reset-pop", "reset-pop-align", car, 30)
assert not move.reset_pop(car, ball, (0, 150, 60), 161, (0, 1, 0), 30, True, [])["jump"]
pop = move.reset_pop(car, ball, (0, 150, 60), 161, (0, 1, 0), 31, True, [])
assert pop["jump"] and move.stage == "reset-pop-follow"

from rlc_advanced_moves import basis, directional_reset_roll
car = player(0, 300, 1000, 40)
_, left, up = basis(car.physics.rotation)
assert directional_reset_roll(car, left, .2, 0) > 0
assert directional_reset_roll(car, tuple(-v for v in left), .2, 0) < 0
assert directional_reset_roll(car, up, .2, .27) == .27
assert directional_reset_roll(car, left, .08, .27) == .27

from rlc_advanced_moves import aerial_axis
assert aerial_axis(.10, 2.0, 2.8, .18, 11) < 0
assert aerial_axis(-.10, -2.0, 2.8, .18, 11) > 0
assert aerial_axis(.10, 0, 2.8, .18, 11) > 0
assert aerial_axis(1.0, 0, 2.8, .18, 11) == 1

from rlc_advanced_moves import ContactSimulation, air_controls, box_contact_offset, contact_hitbox

car = player(0, 0, 700, 42)
car.physics.rotation.yaw = 0
car.physics.velocity = vec(900, 0, 0)
car.hitbox, car.hitbox_offset = O(length=120.507, width=86.699, height=38.659), vec(13.876, 0, 20.755)
shape = contact_hitbox(car)
offset = box_contact_offset((1, 0, 0), basis(car.physics.rotation), shape)
assert math.isclose(offset[0], 166.8795) and offset[2] == 20.755
assert air_controls(car, (-1, 0, 0), (0, 0, 1))["yaw"] != 0

if "--rocketsim" in sys.argv:
    from time import perf_counter

    _, ball = match(car, 295, 0, 722)
    _, unreachable = match(car, 295, 900, 722)
    simulation = ContactSimulation()
    assert simulation.prepare(shape)
    first = simulation.rollout(car, ball, (1, 0, 0), .30, 385, shape)
    assert first is not None and first[1][0] > 500
    assert simulation.rollout(car, unreachable, (1, 0, 0), .30, 385, shape) is None
    assert simulation.rollout(car, ball, (1, 0, 0), .30, 385, shape) == first
    simulation.find_contact(car, ball, .20, (1, 0, 0), (.9, 0, .435), True, 0)
    assert simulation.selection is not None
    simulation.find_contact(car, ball, .20, (1, 0, 0), (.9, 0, .435), True, 1)
    assert simulation.plan[0] == 0
    simulation.find_contact(car, unreachable, .20, (1, 0, 0), (.9, 0, .435), True, 2)
    assert simulation.plan[0] == 2

    bots = [ContactSimulation() for _ in range(6)]
    assert all(bot.prepare(shape) for bot in bots)
    start = perf_counter()
    for frame in range(120):
        for bot in bots:
            bot.find_contact(car, ball, .20, (1, 0, 0), (.9, 0, .435), True, frame)
    print(f"RocketSim hit, miss, replay and cache checks passed. Six continuous aerial approaches: "
          f"{perf_counter() - start:.3f}s compute for 120 frames.")
