#!/usr/bin/env python3
"""Update both layer trees without running setup; optionally process source layers."""

import argparse
import subprocess
import sys
from pathlib import Path

from fetch_data import fetch_latest


def _processing_python(scripts_dir):
    windows = scripts_dir / ".venv" / "Scripts" / "python.exe"
    unix = scripts_dir / ".venv" / "bin" / "python"
    return str(next((path for path in (windows, unix) if path.is_file()), Path(sys.executable)))


def _django_running():
    try:
        result = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", "nur-api"],
            capture_output=True, text=True, check=False,
        )
    except FileNotFoundError:
        return False
    return result.returncode == 0 and result.stdout.strip() == "true"


def run_update(repository_root, process=False):
    repository_root = Path(repository_root)
    scripts_dir = repository_root / "otef-interactive" / "scripts"
    public_dir = repository_root / "otef-interactive" / "public"
    changed = fetch_latest(public_dir)
    if process:
        subprocess.run(
            [
                _processing_python(scripts_dir), str(scripts_dir / "process_layers.py"),
                "--source", str(public_dir / "source" / "layers"),
                "--output", str(public_dir / "processed" / "layers"),
            ],
            cwd=repository_root, check=True,
        )
    if _django_running():
        subprocess.run(
            ["docker", "compose", "exec", "-T", "nur-api", "python", "manage.py", "import_otef_data", "--layers-only"],
            cwd=repository_root, check=True,
        )
    else:
        print("Django is not running. After starting it, rerun this command to refresh layer groups.")
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--process", action="store_true", help="Run source layer processing after downloading")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    run_update(root, process=args.process)


if __name__ == "__main__":
    main()
