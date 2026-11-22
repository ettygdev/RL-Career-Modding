from pathlib import Path
import importlib.util
from types import SimpleNamespace
from unittest.mock import patch

path = Path("src/y_coordination.py")
spec = importlib.util.spec_from_file_location("coordination", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

module._cache = {"active": True, "nonce": "standalone", "expires": 10**15}
module._refresh = 10**15
with patch.dict("os.environ", {"RLC_Y_LAUNCH_TOKEN": "standalone", "RLC_Y_COORDINATION": "1"}):
    assert module._profiles() == module._cache
with patch.dict("os.environ", {"RLC_Y_LAUNCH_TOKEN": "another-launch", "RLC_Y_COORDINATION": "1"}):
    assert module._profiles() is None
with patch.dict("os.environ", {"RLC_Y_LAUNCH_TOKEN": "standalone", "RLC_Y_COORDINATION": "off"}):
    assert module._profiles() is None
with patch.dict("os.environ", {}, clear=True):
    assert module._profiles() is None


def car(name, bot, distance, demolished=0):
    return SimpleNamespace(name=name, is_bot=bot, distance=distance, demolished_timeout=demolished)


team = [(0, car("User", False, 400)), (1, car("Mate", True, 460)), (2, car("Mate 2", True, 480))]
distance = lambda player: player.distance
low = {"teammates": [{"name":"mate","trust":25},{"name":"mate 2","trust":24}]}
neutral = {"teammates": [{"name":"Mate","trust":50},{"name":"Mate 2","trust":50}]}
assert module.select_fallback(team,distance,0,1,low) == 1
assert module.select_fallback(team,distance,0,2,low) == 0
assert module.select_fallback(team,distance,0,1,neutral) == 0
assert module.select_fallback(team,distance,0,1,None) == 0
assert module.select_fallback(team,distance,1,1,low) == 1
assert module.select_fallback(team,distance,0,1,{"teammates":[{"name":"Other","trust":10}]}) == 0
team[1][1].distance = 1000
assert module.select_fallback(team,distance,0,1,low) == 0
events = []
module._emit = lambda config, owner, event, **fields: events.append((event, fields))
team[1][1].distance = 460
module._profiles = lambda: {**low, "mode":"neutral", "nonce":"neutral", "fixture":1, "game":1}
assert module.choose_free(team, distance, 0, 1) == 0
assert events == [("coverage", {"status":"matched"}), ("opportunity", {"override":False, "neutral":0})]
module._profiles = lambda: {**low, "mode":"active", "nonce":"active", "fixture":1, "game":1}
assert module.choose_free(team, distance, 0, 1) == 1
assert events[-1] == ("opportunity", {"override":True, "neutral":0})
print("Contrôle neutre observé et intervention active distingués.")
print("Priorité du gardien : aucun effet hors quasi-égalité, équipe reconnue ou confiance basse.")

events.clear()
position = SimpleNamespace(x=0, y=0, z=600)
physics = SimpleNamespace(location=position, velocity=SimpleNamespace(x=0, y=0, z=0))
info = SimpleNamespace(seconds_elapsed=10.0, is_overtime=False)
players = [player for _, player in team]
for player in players:
    player.team = 0
    player.physics = physics
    player.air_state = "air"
    player.has_jumped = True
    player.has_double_jumped = False
    player.has_dodged = False
    player.latest_touch = None
    player.score_info = SimpleNamespace(goals=0, saves=0)
packet = SimpleNamespace(players=players, balls=[SimpleNamespace(physics=physics)], match_info=info)
module.observe_highlights(packet, 1, True, False, "air")
assert events.pop()[0] == "match-observed"
info.seconds_elapsed = 10.1
players[0].has_jumped = False
players[0].latest_touch = SimpleNamespace(ball_index=0, game_seconds=10.1)
module.observe_highlights(packet, 2, True, False, "air")
assert not events
module.observe_highlights(packet, 1, True, False, "air")
assert events[-1][1]["action"] == "reset"
info.seconds_elapsed = 11.0
players[0].score_info.goals = 1
module.observe_highlights(packet, 1, False, False, "air")
assert events[-1][1]["action"] == "goal" and events[-1][1]["reset"]
module.observe_highlights(packet, 1, False, False, "air")
assert len(events) == 2
players[1].score_info.saves = 1
module.observe_highlights(packet, 1, True, False, "air")
assert events[-1][1]["action"] == "save" and not events[-1][1]["reset"]
print("Paquets simulés : flip reset, but associé, arrêt et absence de doublons.")

fresh = {"name": "Mate", "temperament": 0.35, "fatigue": 0}
tired = {**fresh, "fatigue": 18}
early = module.form_components(fresh, 0, 0.8, 0)
late = module.form_components(tired, 24, 0.8, 280)
assert early[0] > 0 > late[0]
assert late[1] > early[1] and late[2] > early[2]
assert module.form_components({**fresh, "familiarity": 1}, 0, 0.8, 0)[0] < early[0]
skater = SimpleNamespace(demolished_timeout=0, physics=SimpleNamespace(
    location=SimpleNamespace(x=-600, y=0, z=600), velocity=SimpleNamespace(x=1000, y=0, z=0)))
assert module.converging(skater, position)
skater.physics.velocity.x = -1000
assert not module.converging(skater, position)
profile = {**low, "performance": [tired, {**fresh, "name": "Mate 2"}],
           "synergy": 24, "pressure": 0.8, "nonce": "form", "fixture": 2, "game": 5}
module._profiles = lambda: {**profile, "mode": "neutral"}
assert module.match_form(packet, 1, 0.2) == 0.2
module._profiles = lambda: {**profile, "mode": "active"}
assert -1 <= module.match_form(packet, 1, 0.2) < 0.2
assert module.match_form(packet, 1, -1.0) == -1.0
assert module.match_form(packet, 0, 0.2) == 0.2
print("Forme : pression initiale, fatigue, synergie, bornes et contrôle neutre.")
