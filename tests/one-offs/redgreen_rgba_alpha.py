"""Red-green audit for tests/test_rgba_alpha.py.

Undoes each RGBA fix one at a time (in the source file, restored afterwards), runs the
suite, and reports which tests went red. A mutant that leaves every test green means the
tests don't detect that fix. Sources are verified byte-identical after each run.

Usage: python tests/one-offs/redgreen_rgba_alpha.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "py" / "smart_resolution_calc.py"
IMG = ROOT / "py" / "image_utils.py"
OPT = ROOT / "py" / "dazzle_options.py"

MUTANTS = [
    ("encode trims to 3 again", SRC,
     'pixels = pixels[:, :, :, :getattr(vae, "output_channels", 3)]',
     'pixels = pixels[:, :, :, :3]'),
    ("img2noise trims to 3 again", SRC,
     'pixels = transformed[:, :, :, :getattr(vae, "output_channels", 3)]',
     'pixels = transformed[:, :, :, :3]'),
    ("old-ComfyUI default keeps alpha", SRC,
     'pixels = pixels[:, :, :, :getattr(vae, "output_channels", 3)]',
     'pixels = pixels[:, :, :, :getattr(vae, "output_channels", 4)]'),
    ("scale/pad canvas stays 3-channel", IMG,
     "    canvas = match_channels(create_empty_image(target_width, target_height, fill_type, fill_color, batch_size, fill_image), channels, fill_alpha)\n\n    # Calculate centering offsets",
     "    canvas = create_empty_image(target_width, target_height, fill_type, fill_color, batch_size, fill_image)\n\n    # Calculate centering offsets"),
    ("crop/pad canvas stays 3-channel", IMG,
     "    # Create canvas with target dimensions (channels match the input: RGBA input -> fill gets fill_alpha)\n    canvas = match_channels(",
     "    # Create canvas with target dimensions (channels match the input: RGBA input -> fill gets fill_alpha)\n    canvas = (lambda c, _, __: c)("),
    ("composite refuses RGB bg again", IMG,
     "            bg = match_channels(bg, fg.shape[3], fill_alpha)",
     '            raise ValueError(f"bg channels {bg.shape[3]} cannot match fg channels {fg.shape[3]}")'),
    ("added channel ignores its value (always transparent)", IMG,
     "channels - c), value,",
     "channels - c), 0.0,"),
    # --- fill_alpha (feature): neutralise what the option does, keep every signature ---
    ("resolver ignores 'transparent'", OPT,
     'return 0.0 if get_option(dazzle_options, "fill_alpha", "opaque") == "transparent" else 1.0',
     'return 1.0'),
    ("missing option defaults to transparent", OPT,
     'get_option(dazzle_options, "fill_alpha", "opaque") == "transparent"',
     'get_option(dazzle_options, "fill_alpha", "transparent") == "transparent"'),
    ("DazzleOptions node defaults to transparent", OPT,
     'options_in=None, fill_alpha="opaque"):',
     'options_in=None, fill_alpha="transparent"):'),
    ("scale/pad ignores fill_alpha", IMG,
     "fill_image), channels, fill_alpha)\n\n    # Calculate centering offsets",
     "fill_image), channels, 1.0)\n\n    # Calculate centering offsets"),
    ("crop/pad ignores fill_alpha", IMG,
     "(channels match the input: RGBA input -> fill gets fill_alpha)\n    canvas = match_channels(create_empty_image(target_width, target_height, fill_type, fill_color, batch_size, fill_image), channels, fill_alpha)",
     "(channels match the input: RGBA input -> fill gets fill_alpha)\n    canvas = match_channels(create_empty_image(target_width, target_height, fill_type, fill_color, batch_size, fill_image), channels, 1.0)"),
    ("composite ignores fill_alpha", IMG,
     "bg = match_channels(bg, fg.shape[3], fill_alpha)",
     "bg = match_channels(bg, fg.shape[3], 1.0)"),
    ("context does not resolve fill_alpha", SRC,
     "self.fill_alpha: float = resolve_fill_alpha(self.dazzle_options)",
     "self.fill_alpha: float = 1.0"),
    ("calculate_dimensions drops fill_alpha", SRC,
     "use_image_for_output=ctx.use_image_for_output, fill_alpha=ctx.fill_alpha",
     "use_image_for_output=ctx.use_image_for_output"),
    ("output scale/pad drops fill_alpha", SRC,
     "output_image = _transform_image_scale_pad(image, w, h, fill_type, fill_color, fill_image, fill_alpha)",
     "output_image = _transform_image_scale_pad(image, w, h, fill_type, fill_color, fill_image)"),
    ("output crop/pad drops fill_alpha", SRC,
     "output_image = _transform_image_crop_pad(image, w, h, fill_type, fill_color, fill_image, fill_alpha)",
     "output_image = _transform_image_crop_pad(image, w, h, fill_type, fill_color, fill_image)"),
    ("output mask composite drops fill_alpha", SRC,
     "_composite_with_mask(fg, bg, fitted_mask, fill_alpha)",
     "_composite_with_mask(fg, bg, fitted_mask)"),
    ("img2noise scale/pad drops fill_alpha", SRC,
     "transformed = _transform_image_scale_pad(image, w, h, fill_type, fill_color, fill_image, resolve_fill_alpha(opts))",
     "transformed = _transform_image_scale_pad(image, w, h, fill_type, fill_color, fill_image)"),
    ("noise cache key ignores fill_alpha", SRC,
     "opts_cache_key = (opts.get('norm_mode', 'auto'), resolve_fill_alpha(opts))",
     "opts_cache_key = (opts.get('norm_mode', 'auto'),)"),
]


def run_suite():
    r = subprocess.run([sys.executable, "tests/test_rgba_alpha.py"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    fails = [l.split("FAIL: ")[1].split(":")[0] for l in r.stdout.splitlines() if "FAIL: " in l]
    return r.returncode, fails


def main():
    originals = {p: p.read_bytes() for p in (SRC, IMG, OPT)}
    code, fails = run_suite()
    print(f"baseline: exit {code}, failing {fails}")
    if code != 0:
        sys.exit("baseline must be green")
    survivors = 0
    for name, path, old, new in MUTANTS:
        text = originals[path].decode("utf-8")
        if "\r\n" in text:  # anchors are written with \n; match the file's line endings
            old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
        assert text.count(old) == 1, f"{name}: anchor found {text.count(old)} times"
        try:
            path.write_bytes(text.replace(old, new).encode("utf-8"))
            code, fails = run_suite()
        finally:
            path.write_bytes(originals[path])
        assert path.read_bytes() == originals[path], f"{path} not restored"
        status = "KILLED" if code != 0 else "SURVIVED"
        survivors += code == 0
        print(f"[{status}] {name}: red = {fails}")
    print(f"\n{len(MUTANTS) - survivors}/{len(MUTANTS)} killed; sources restored byte-identical")
    sys.exit(1 if survivors else 0)


if __name__ == "__main__":
    main()
