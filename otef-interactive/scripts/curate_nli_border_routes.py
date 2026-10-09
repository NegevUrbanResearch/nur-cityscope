from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR / "otef_layer_processing"))

from otef_layer_processing.nli_border_route_prepare import prepare_release
from otef_layer_processing.nli_border_route_release import publish_release, rollback_release


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare or explicitly publish a reviewed NLI border-route release")
    parser.add_argument("--repo-root", type=Path, help="repository root (defaults to this script's worktree)")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--check", action="store_true")
    modes.add_argument("--prepare", action="store_true")
    modes.add_argument("--apply", action="store_true")
    modes.add_argument("--rollback", type=Path, metavar="JOURNAL")
    parser.add_argument("--recipe", type=Path)
    parser.add_argument("--staging-dir", type=Path)
    parser.add_argument("--prepared-dir", type=Path)
    parser.add_argument("--outputs-closed", action="store_true")
    parser.add_argument("--preview-reference", type=Path)
    parser.add_argument("--audit-only", action="store_true",
                        help="write a nonpublishable diagnostic bundle when the known baseline beat fixture mismatch is the only verifier failure")
    args = parser.parse_args(argv)
    repo_root = (args.repo_root or Path(__file__).resolve().parents[2]).resolve()
    recipe = (args.recipe or repo_root / "otef-interactive/scripts/nli-border-route-curation.json").resolve()
    if args.rollback:
        rollback_release(args.rollback.resolve())
        print(json.dumps({"status": "rolled_back", "journal": str(args.rollback.resolve())}))
        return 0
    if args.apply:
        if not args.prepared_dir:
            parser.error("--apply requires --prepared-dir")
        result = publish_release(args.prepared_dir.resolve(), outputs_closed=args.outputs_closed)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["status"] == "published" or result["status"] == "unchanged" else 1
    if args.prepare and not args.staging_dir:
        parser.error("--prepare requires --staging-dir")
    if args.audit_only and not args.prepare:
        parser.error("--audit-only requires --prepare")
    result = prepare_release(repo_root, recipe, args.staging_dir or repo_root,
                             preview_reference=args.preview_reference,
                             mode="prepare" if args.prepare else "check",
                             audit_only=args.audit_only)
    print(json.dumps(result, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
