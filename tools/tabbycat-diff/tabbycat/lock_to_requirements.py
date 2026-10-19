"""Turns Tabbycat's Pipfile.lock into a pinned requirements.txt (default packages only).

    python -I lock_to_requirements.py <tabbycat>/Pipfile.lock requirements.txt

Avoids installing pipenv just to read the lockfile; versions are exactly the locked ones.
"""
import json
import sys


def main(lock_path, out_path):
    with open(lock_path, encoding="utf-8") as handle:
        lock = json.load(handle)
    lines = [f"{name}{spec['version']}" for name, spec in sorted(lock["default"].items()) if "version" in spec]
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"{len(lines)} pinned packages -> {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
