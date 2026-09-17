"""Compare fixed-profile PNGs; retain a visible difference image on failure."""
import argparse
from pathlib import Path
from PIL import Image, ImageChops

parser = argparse.ArgumentParser()
parser.add_argument("baseline", type=Path)
parser.add_argument("actual", type=Path)
parser.add_argument("--channel-tolerance", type=int, default=24)
parser.add_argument("--changed-fraction", type=float, default=0.005)
args = parser.parse_args()
expected = {path.name for path in args.baseline.glob("*.png")}
actual = {path.name for path in args.actual.glob("*.png") if not path.name.endswith(".diff.png")}
assert expected and expected == actual, f"Capture set differs: missing={expected - actual}, extra={actual - expected}"
failures = []
for name in sorted(expected):
    with Image.open(args.baseline / name) as reference, Image.open(args.actual / name) as result:
        if reference.size != result.size:
            failures.append(f"{name}: {reference.size} != {result.size}")
            continue
        difference = ImageChops.difference(reference.convert("RGB"), result.convert("RGB"))
        red, green, blue = difference.split()
        maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        mask = maximum.point(lambda value: 255 if value > args.channel_tolerance else 0)
        changed = mask.histogram()[255] / (reference.width * reference.height)
        if changed > args.changed_fraction:
            difference.save(args.actual / (name[:-4] + ".diff.png"))
            failures.append(f"{name}: {changed:.2%} changed")
assert not failures, "\n".join(failures)
print(f"PASS: {len(expected)} visual baselines")
