"""Install or remove only the RLCareer Overhaul bot style hooks."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent

PATCHES = {
    "nexto/v5/bot.py": [(
        "        if held is not None:\n            return held\n        return self.controls\n",
        "        if held is not None:\n            return held\n"
        "        from rlc_bot_style import adjust  # RLCareer Overhaul bot styles\n"
        "        return adjust(self, packet, self.index, self.controls)\n",
    )],
    "ripple/ripple_strength.py": [(
        "            controls[self.index] = held\n        self.log(packet, controls)\n",
        "            controls[self.index] = held\n"
        "        elif self.index in controls:\n"
        "            from rlc_bot_style import adjust  # RLCareer Overhaul bot styles\n"
        "            controls = dict(controls)\n"
        "            controls[self.index] = adjust(self, packet, self.index, controls[self.index])\n"
        "        self.log(packet, controls)\n",
    )],
    "calibrate/relay.py": [(
        "        self.tactics = tactics\n        self.warned = False\n",
        "        self.tactics = tactics\n"
        "        self._rlc_style_relay = bool(tactics and any(set(gear) - {'form'} for gear in tactics.gears.values()))\n"
        "        self.warned = False\n",
    ), (
        "        self.tactics.observe(msg)\n        if self.form:\n",
        "        self.tactics.observe(msg)\n"
        "        if self._rlc_style_relay:\n"
        "            from rlc_bot_style import _directory  # RLCareer Overhaul bot styles\n"
        "            self._rlc_style_packet = flat.CorePacket.unpack(body).message if _directory else None\n"
        "        if self.form:\n",
    ), (
        "                                                             controller_state=held)).pack()\n        return None\n",
        "                                                             controller_state=held)).pack()\n"
        "        packet = getattr(self, '_rlc_style_packet', None)\n"
        "        if packet is not None:\n"
        "            from rlc_bot_style import adjust  # RLCareer Overhaul bot styles\n"
        "            control = adjust(self, packet, msg.player_index, msg.controller_state)\n"
        "            if control is not msg.controller_state:\n"
        "                return flat.InterfacePacket(flat.PlayerInput(player_index=msg.player_index, controller_state=control)).pack()\n"
        "        return None\n",
    )],
}


def replace(path, data):
    temporary = path.with_suffix(path.suffix + ".rlc-style.tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("rlbot", type=Path)
    cli.add_argument("--restore", action="store_true")
    args = cli.parse_args()
    updates = []
    for relative, patches in PATCHES.items():
        path = args.rlbot / relative
        original = path.read_bytes()
        crlf = b"\r\n" in original
        data = original.decode("utf-8").replace("\r\n", "\n")
        # Recognize hooks installed before the launcher was renamed.
        data = data.replace("# Career" + "+ bot styles", "# RLCareer Overhaul bot styles")
        for clean, patched in patches:
            old, new = (patched, clean) if args.restore else (clean, patched)
            if new in data:
                continue
            if data.count(old) != 1:
                raise SystemExit(f"Unsupported Hub source: {relative}")
            data = data.replace(old, new)
        compile(data, str(path), "exec")
        encoded = (data.replace("\n", "\r\n") if crlf else data).encode("utf-8")
        if encoded != original:
            updates.append((path, original, encoded, ROOT / "backup/bot-style" / relative))
    if not args.restore:
        for name in ("rlc_advanced_moves.py", "rlc_bot_style.py"):
            helper = (ROOT / "src" / name).read_bytes()
            compile(helper, name, "exec")
            replace(args.rlbot / name, helper)
    for _, original, _, backup in updates:
        if not args.restore and not backup.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            backup.write_bytes(original)
    try:
        for path, _, data, _ in updates:
            replace(path, data)
    except OSError:
        for path, original, _, _ in updates:
            if path.read_bytes() != original:
                replace(path, original)
        raise
    print(f"RLCareer Overhaul bot styles {'removed' if args.restore else 'installed'} ({len(updates)} files updated)")


if __name__ == "__main__":
    main()
