from pathlib import Path
from types import SimpleNamespace as Obj
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
from rlbot.flat import AirState, ControllerState, MatchPhase
from rlc_bot_style import BotStyle


def vec(x, y, z=0):
    return Obj(x=x, y=y, z=z)


def car(name, position, bot=True, team=0):
    return Obj(name=name, player_id=name, is_bot=bot, team=team, air_state=AirState.OnGround,
               demolished_timeout=-1, boost=80, dodge_timeout=1,
               physics=Obj(location=position, velocity=vec(800, 0), rotation=Obj(yaw=0, pitch=0, roll=0), angular_velocity=vec(0,0,0)))


zen = car("zen", vec(100, 200, 18))
cover = car("cover", vec(-900, -400, 18))
ball = Obj(physics=Obj(location=vec(780, 240, 480), velocity=vec(0, 100, 40)))
packet = Obj(match_info=Obj(frame_num=120, match_phase=MatchPhase.Active),
             players=[zen, cover], balls=[ball])
wanted = ControllerState(throttle=1, boost=True)
profile = ("session-match-0", {"zen": {"isPublic": True, "mechanics": 98}})

with patch("rlc_bot_style._profiles", return_value=profile), patch("rlc_bot_style._quick_chat_active", return_value=False):
    style = BotStyle()
    first = style.apply(packet, 0, wanted)
    assert first.jump and first.pitch > 0
    zen.air_state = AirState.InAir
    packet.match_info.frame_num = 127
    assert not style.apply(packet, 0, wanted).jump
    packet.match_info.frame_num = 130
    follow = style.apply(packet, 0, wanted)
    assert follow.jump and follow.pitch == follow.yaw == follow.roll == 0
    packet.match_info.frame_num = 134
    assert style.apply(packet, 0, wanted) is wanted
    zen.air_state = AirState.OnGround
    assert style.apply(packet, 0, wanted) is wanted  # Cooldown
    packet.players = [zen]
    assert BotStyle().apply(packet, 0, wanted) is wanted  # Last defender
    packet.players = [zen, cover, car("human", vec(720, 230, 18), bot=False)]
    assert BotStyle().apply(packet, 0, wanted) is wanted  # Give the human room
    packet.players = [zen, cover]
    packet.match_info.match_phase = MatchPhase.Kickoff
    assert BotStyle().apply(packet, 0, wanted) is wanted
    packet.match_info.match_phase = MatchPhase.Active
    with patch("rlc_bot_style._quick_chat_active", return_value=True):
        assert BotStyle().apply(packet, 0, wanted) is wanted
with patch("rlc_bot_style._profiles", return_value=None):
    assert BotStyle().apply(packet, 0, wanted) is wanted

print("Native fast aerial timing, protected kickoff, cooldown, cover and Quick Chat verified.")
