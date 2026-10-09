"""Create a staged NLI runtime pack with pinned shelters, leaving input unchanged."""

import argparse
import json
from pathlib import Path
from otef_layer_processing.nli_shelters import stage_shelter_cohort, DEFAULT_FIXTURE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    args = parser.parse_args()
    print(
        json.dumps(stage_shelter_cohort(args.pack, args.output, args.fixture), indent=2)
    )


if __name__ == "__main__":
    main()
