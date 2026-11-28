"""Install the Quick Chat tactic hook without discarding unrelated Hub changes."""
import argparse
from hashlib import sha256
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("rlbot", type=Path)
parser.add_argument("--restore", action="store_true")
args = parser.parse_args()
source = args.rlbot / "career_tactics.py"
root = Path(__file__).resolve().parent
backup = root / "backup" / "career_tactics.quick-chat.original.py"
old_patch = "60ea0d5d9ca0c32143832ddaadf50813e804dca7905fbf123b876a964e245e1a"
original_hash = "77a2a26123ef23c78484b917ffeda0bbb9259cadce71c3c4c33738aa7a6fa1ee"
marker = b"# RLC Quick Chat v2"

def clean_hash(data):
    return sha256(data.replace(b"\r\n", b"\n")).hexdigest()

def replace_file(target, data):
    temporary = target.with_suffix(".rlc-quick-chat.tmp")
    temporary.write_bytes(data)
    temporary.replace(target)

data = source.read_bytes()
if backup.exists() and clean_hash(backup.read_bytes()) != original_hash:
    raise SystemExit("Quick Chat: original backup does not match this Hub.")
if sha256(data).hexdigest() == old_patch:
    data = backup.read_bytes()

newline = b"\r\n" if b"\r\n" in data else b"\n"
before = newline.join([
    b"        if not keepers or not packet.balls or self.index >= len(packet.players):",
    b"            self.pad = None",
    b"            return None",
])
after = newline.join([
    b"        if not packet.balls or self.index >= len(packet.players):",
    b"            self.pad = None",
    b"            return None",
    b"        # RLC Quick Chat v2",
    b"        me = packet.players[self.index]",
    b"        if me.demolished_timeout <= 0 and me.air_state == AirState.OnGround:",
    b"            from rlc_quick_chat import quick_role",
    b"            handled, controls = quick_role(self, packet, me)",
    b"            if handled:",
    b"                return controls",
    b"        if not keepers:",
    b"            self.pad = None",
    b"            return None",
])
original = data.replace(after, before, 1) if marker in data else data
if original.count(before) != 1 or clean_hash(original) != original_hash:
    raise SystemExit("Quick Chat: unsupported career_tactics.py")
patched = original.replace(before, after, 1)
if marker in data and data != patched:
    raise SystemExit("Quick Chat: the patched file has additional changes.")
if args.restore:
    replace_file(source, original)
else:
    compile(patched, str(source), "exec")
    backup.parent.mkdir(exist_ok=True)
    if not backup.exists():
        backup.write_bytes(original)
    replace_file(args.rlbot / "rlc_quick_chat.py", (root / "src" / "rlc_quick_chat.py").read_bytes())
    replace_file(source, patched)
