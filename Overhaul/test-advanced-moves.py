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
packet, ball = match(car, 0, 195, 560)
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
packet, ball = match(car, 0, 130, 1050)
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

car = player(0, 0, 630, 48)
car.has_jumped = False
car.physics.rotation.pitch = .48
packet, ball = match(car, 0, 150, 685)
move = AdvancedMoves()
start = move.update(packet, 0, controls)
assert move.move == "musty" and not start["jump"]
packet.match_info.frame_num = 19
assert move.update(packet, 0, controls)["pitch"] == 1

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
print("All four sequences, confirmed reset transitions, cover cancellation and shot projection passed.")

car = player(0, 0, 560)
car.physics.velocity = vec(0, 230, 0)
packet, ball = match(car, 0, 200, 640)
move = AdvancedMoves()
result = move.update(packet, 0, controls)
assert move.move == "zen-touch" and not result["boost"] and result["roll"] != 0
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
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] is False
assert move.stage == "pop-approach"
car.physics.location.y = 50
packet.match_info.frame_num += 5
assert move.update(packet, 0, controls)["jump"] is True
car.air_state = AirState.InAir
car.physics.location = vec(0, 110, 85)
packet.match_info.frame_num += 13
assert move.update(packet, 0, controls)["jump"] is False
packet.match_info.frame_num += 5
second = move.update(packet, 0, controls)
assert second["jump"] and second["pitch"] == second["yaw"] == 0
assert move.stage == "pop-follow"
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
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] is False
assert move.stage == "reset-pop-approach"
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
    packet, ball = match(car, 0, 325, 805)
    packet.match_info.match_phase = MatchPhase.Active
    style = BotStyle()
    output = style.apply(packet, 0, controls)
    assert style.advanced.move == "first-touch-reset-pop"
    outputs.append(output)
assert outputs[0].jump == outputs[1].jump
assert abs(outputs[0].pitch) < abs(outputs[1].pitch)
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

car = player(3810, 1070, 505)
car.physics.rotation.yaw = .43
packet, ball = match(car, 3980, 1146, 510)
move = AdvancedMoves()
assert move.update(packet, 0, controls)["jump"] is False
assert move.move in ("wall-pinch", "kuxir-pinch")
packet.match_info.frame_num += 4
car.physics.location.x = 3846
assert move.update(packet, 0, controls)["jump"] is True
print("Open-net shot, challenge yield, roof-pop choice, 45-degree flick and pinch timing passed.")

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
assert move.stage == "pop-approach"
print("Wall and ceiling wheel-side recovery, third-player rotation and rising bounce launch passed.")
