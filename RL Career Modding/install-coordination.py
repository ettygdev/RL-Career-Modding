"""Install or restore the small RL Career tactics adapter."""
from pathlib import Path
import argparse
import shutil

parser = argparse.ArgumentParser()
parser.add_argument("root", type=Path, help="RL Career Hub installation folder")
parser.add_argument("--restore", action="store_true")
parser.add_argument("--previous-helper", type=Path)
args = parser.parse_args()
base = Path(__file__).resolve().parent
root = args.root.resolve() / "resources" / "rlbot"
target = root / "career_tactics.py"
helper = root / "y_coordination.py"
backup = base / "backup" / "career_tactics.py"
source = base / "src" / "y_coordination.py"


def patched(data, highlights=True, performance=True):
    newline = b"\r\n" if b"\r\n" in data else b"\n"
    old = b"        return min(team, key=lambda kp: dist(kp[1]))[0]" + newline
    new = newline.join([
        b"        neutral = min(team, key=lambda kp: dist(kp[1]))[0]",
        b"        try:",
        b"            from y_coordination import choose_free",
        b"        except ImportError:",
        b"            return neutral",
        b"        return choose_free(team, dist, neutral, self.index)",
        b"",
    ])
    if data.count(old) != 1:
        raise SystemExit("Unexpected keeper code. The Hub file was not modified.")
    result = data.replace(old, new)
    if highlights:
        anchor = b"        self.last_phase = phase" + newline
        if result.count(anchor) != 1:
            raise SystemExit("Unexpected packet loop. The Hub file was not modified.")
        hook = newline.join([
            b"        try:",
            b"            from y_coordination import observe_highlights",
            b"            observe_highlights(packet, self.index, phase == MatchPhase.Active,",
            b"                               phase in (MatchPhase.Kickoff, MatchPhase.Countdown), AirState.InAir)",
            b"        except (ImportError, AttributeError, KeyError, TypeError, ValueError):",
            b"            pass",
            b"",
        ])
        result = result.replace(anchor, hook + anchor)
    if performance:
        anchor = b"    def form_shift(self, packet):" + newline
        if result.count(anchor) != 1:
            raise SystemExit("Unexpected form hook. The Hub file was not modified.")
        hook = newline.join([
            b"    def form_shift(self, packet):",
            b"        baseline = self.native_form_shift(packet)",
            b"        if packet.match_info.match_phase != MatchPhase.Active:",
            b"            return baseline",
            b"        try:",
            b"            from y_coordination import match_form",
            b"            return match_form(packet, self.index, baseline)",
            b"        except (ImportError, AttributeError, KeyError, TypeError, ValueError):",
            b"            return baseline",
            b"",
            b"    def native_form_shift(self, packet):",
            b"",
        ])
        result = result.replace(anchor, hook)
    compile(result, str(target), "exec")
    return result


def replace(path, data):
    stage = path.with_suffix(path.suffix + ".y-staging")
    with stage.open("xb") as file:
        file.write(data)
    try:
        stage.replace(path)
    finally:
        if stage.exists():
            stage.unlink()


existing = target.read_bytes()
if args.restore:
    original = backup.read_bytes()
    if existing not in (original, patched(original)):
        raise SystemExit("The Hub file has changed since installation. No restore was attempted.")
    if existing != original:
        replace(target, original)
    if helper.exists() and helper.read_bytes() == source.read_bytes():
        helper.unlink()
    print("Native keeper tactics restored.")
else:
    original = backup.read_bytes() if backup.exists() else existing
    new = patched(original)
    if existing not in (original, new, patched(original, performance=False),
                        patched(original, highlights=False, performance=False)):
        raise SystemExit("The Hub file has changed since installation. No patch was applied.")
    data = source.read_bytes()
    compile(data, str(helper), "exec")
    current_helper = helper.read_bytes() if helper.exists() else None
    previous_helper = args.previous_helper.read_bytes() if args.previous_helper else None
    if current_helper not in (None, data, previous_helper):
        raise SystemExit("An unrelated tactics helper already exists.")
    if not backup.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup)
    if current_helper != data:
        replace(helper, data)
    if existing != new:
        replace(target, new)
    print("Keeper tactics adapter installed. Original backed up.")
