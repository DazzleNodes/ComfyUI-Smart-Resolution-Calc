"""Live probe: RGBA pass-through on a running ComfyUI (127.0.0.1:8188), restarted on this code.

Runs the high-value items of tests/checklists/v0.12.8__Feature__rgba-alpha-passthrough.md as API
prompts and checks the saved PNGs:

  T1 img2img, Qwen 2.1 VAE (RGBA)  -> decoded image keeps a transparent background
  T2 img2img, Qwen-Image VAE (RGB) -> runs, RGB output (unchanged behaviour)
  T3 transform (scale/pad) to 1:1  -> IMAGE output is RGBA, bars opaque fill, subject alpha kept
  T4 mask cutout on RGBA image     -> composite applied (fill where mask=0), not skipped
  T5 img2img + img2noise, Qwen 2.1 -> runs, decoded image keeps a transparent background

With the pre-fix code, T1/T5 decode fully opaque (alpha stripped, VAE pads 1.0), T3 errors,
and T4 returns the input unchanged.

Also T6/T7: DazzleOptions fill_alpha = transparent makes the padding / mask fill transparent.

Usage: copy docs/workflow/smartrescalc-rgba-demo.png into ComfyUI's input/, then
  python tests/one-offs/live_rgba_alpha_probe.py [--image NAME_IN_COMFY_INPUT] [--comfy C:/code/ComfyUI_experiment]
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

SERVER = "http://127.0.0.1:8188"
SRC_BASE = {  # a working SmartResolutionCalc config (from a Qwen 2.1 render), alpha-relevant fields overridden per test
    "mode_status_display": "", "aspect_ratio": "3:4 (SD Video Portrait)", "divisible_by": "16", "custom_ratio": False,
    "mode_status": "Calculating...", "custom_aspect_ratio": "5.2:2.5", "batch_size": 1, "scale": 1.0,
    "fill_type": "black", "blend_strength": 0.0, "fill_seed": {"on": True, "value": 2028},
    "image_purpose": "img2img", "fill_blend_strength": 0.0, "cutoff": 0.2, "feature_size": -1,
    "output_image_mode": "auto", "fill_color": "#00ff00", "image_mode": {"on": True, "value": 0},
    "dimension_megapixel": {"on": False, "value": 1}, "dimension_width": {"on": False, "value": 1024},
    "dimension_height": {"on": True, "value": 1024}, "scale_slider": 1,
}
VAES = {"rgba": "qwen_image_2.1_vae_bf16.safetensors", "rgb": "qwen_image_vae.safetensors"}


def graph(name, image, src_overrides, vae="rgba", save="latent", mask=False, fill_alpha=None):
    src = dict(SRC_BASE, **src_overrides, image=["2", 0], vae=["3", 0])
    if mask:
        src["mask"] = ["1", 1]
    if fill_alpha:
        src["dazzle_options"] = ["4", 0]
    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": image}},
        "2": {"class_type": "JoinImageWithAlpha", "inputs": {"image": ["1", 0], "alpha": ["1", 1]}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAES[vae]}},
        "10": {"class_type": "SmartResolutionCalc", "inputs": src},
    }
    if fill_alpha:
        g["4"] = {"class_type": "DazzleOptions", "inputs": {"norm_mode": "auto", "whitening": 1.0, "cutoff_curve": "gaussian",
                                                           "phase_randomize": False, "fill_alpha": fill_alpha}}
    if save == "latent":
        g["11"] = {"class_type": "VAEDecode", "inputs": {"samples": ["10", 6], "vae": ["3", 0]}}
        g["12"] = {"class_type": "SaveImage", "inputs": {"images": ["11", 0], "filename_prefix": f"srcrgba/{name}"}}
    else:
        g["12"] = {"class_type": "SaveImage", "inputs": {"images": ["10", 5], "filename_prefix": f"srcrgba/{name}"}}
    return g


def run(comfy, g):
    req = urllib.request.Request(SERVER + "/prompt", data=json.dumps({"prompt": g}).encode(), headers={"Content-Type": "application/json"})
    try:
        pid = json.loads(urllib.request.urlopen(req, timeout=30).read())["prompt_id"]
    except urllib.error.HTTPError as e:
        return None, f"rejected: {e.read().decode()[:800]}"
    while True:
        h = json.loads(urllib.request.urlopen(f"{SERVER}/history/{pid}", timeout=30).read())
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                err = [m[1] for m in st.get("messages", []) if m[0] == "execution_error"]
                return None, f"error: {(err[0].get('exception_message') if err else st)!s:.600}"
            img = h[pid]["outputs"]["12"]["images"][0]
            return Path(comfy) / "output" / img["subfolder"] / img["filename"], None
        time.sleep(0.5)


def alpha_stats(p):
    im = Image.open(p)
    if im.mode != "RGBA":
        return im, None
    return im, np.asarray(im)[..., 3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", default="smartrescalc-rgba-demo.png",
                    help="transparent PNG in ComfyUI's input/ (copy docs/workflow/smartrescalc-rgba-demo.png there)")
    ap.add_argument("--comfy", default="C:/code/ComfyUI_experiment")
    args = ap.parse_args()
    src_alpha = np.asarray(Image.open(Path(args.comfy) / "input" / args.image).convert("RGBA"))[..., 3]
    print(f"source: {src_alpha.shape[1]}x{src_alpha.shape[0]}, alpha==0 share {(src_alpha == 0).mean():.3f}")
    results = []

    def report(name, ok, detail):
        results.append(ok)
        print(f"[{'OK' if ok else 'FAIL'}] {name}: {detail}")

    for name, kw in [("T1_img2img_rgba_vae", {}),
                     ("T5_img2img_img2noise_rgba_vae", {"src_overrides": {"image_purpose": "img2img + img2noise", "fill_type": "DazNoise: Plasma", "blend_strength": 0.66, "fill_blend_strength": 0.14}})]:
        p, err = run(args.comfy, graph(name, args.image, kw.get("src_overrides", {})))
        if err:
            report(name, False, err)
            continue
        im, a = alpha_stats(p)
        if a is None:
            report(name, False, f"{im.mode} {im.size}: no alpha channel")
        else:
            report(name, (a <= 2).mean() > 0.3, f"{im.mode} {im.size}, alpha<=2 share {(a <= 2).mean():.3f} (opaque-only would be 0)")

    p, err = run(args.comfy, graph("T2_img2img_rgb_vae", args.image, {}, vae="rgb"))
    report("T2_img2img_rgb_vae", err is None and Image.open(p).mode == "RGB", err or f"{Image.open(p).mode} {Image.open(p).size}")

    p, err = run(args.comfy, graph("T3_scale_pad_1to1", args.image, {
        "image_mode": {"on": False, "value": 0}, "aspect_ratio": "1:1 (Square - Instagram/Profile)",
        "output_image_mode": "transform (scale/pad)", "fill_type": "custom_color"}, save="image"))
    if err:
        report("T3_scale_pad_1to1", False, err)
    else:
        im, a = alpha_stats(p)
        if a is None:
            report("T3_scale_pad_1to1", False, f"{im.mode} {im.size}: no alpha channel")
        else:
            h = a.shape[0]
            bar_rows = h // 6 - 2  # 3:2 in a square leaves 1/6 of the height above and below
            bars_opaque = (a[:bar_rows] == 255).all() and (a[h - bar_rows:] == 255).all()
            middle = a[h // 6 + 2: h - h // 6 - 2]
            report("T3_scale_pad_1to1", bars_opaque and (middle == 0).mean() > 0.3,
                   f"{im.mode} {im.size}, bars opaque={bars_opaque}, transparent share inside image {(middle == 0).mean():.3f}")

    p, err = run(args.comfy, graph("T4_mask_cutout", args.image, {"fill_type": "custom_color"}, save="image", mask=True))
    if err:
        report("T4_mask_cutout", False, err)
    else:
        im, a = alpha_stats(p)
        arr = np.asarray(im.convert("RGBA").resize((src_alpha.shape[1], src_alpha.shape[0]), Image.NEAREST))
        subject = src_alpha >= 250  # LoadImage mask = 1 - alpha -> mask 0 on the subject -> fill there
        green = (arr[..., 1] > 200) & (arr[..., 0] < 60) & (arr[..., 2] < 60)
        # the source's "solid" alpha is 252-253, so the mask there is ~0.008, not 0: blended alpha
        # is ~0.9999 and SaveImage truncates it to 254
        report("T4_mask_cutout", im.mode == "RGBA" and green[subject].mean() > 0.9 and (arr[..., 3][subject] >= 254).all(),
               f"{im.mode} {im.size}, subject replaced by opaque green fill: {green[subject].mean():.3f}")

    # T6/T7: DazzleOptions fill_alpha = transparent (needs a server restarted on the fill_alpha code)
    p, err = run(args.comfy, graph("T6_scale_pad_transparent", args.image, {
        "image_mode": {"on": False, "value": 0}, "aspect_ratio": "1:1 (Square - Instagram/Profile)",
        "output_image_mode": "transform (scale/pad)", "fill_type": "custom_color"}, save="image", fill_alpha="transparent"))
    if err:
        report("T6_scale_pad_transparent", False, err)
    else:
        im, a = alpha_stats(p)
        h = a.shape[0] if a is not None else 0
        bar_rows = h // 6 - 2
        # the source's "solid" alpha is 252-253, not 255
        ok = a is not None and (a[:bar_rows] == 0).all() and (a[h - bar_rows:] == 0).all() and (a[h // 6 + 2: h - h // 6 - 2] >= 250).mean() > 0.3
        green = np.asarray(im)[:bar_rows, :, 1].mean() if a is not None else 0
        report("T6_scale_pad_transparent", ok, f"{im.mode} {im.size}, bars transparent={ok}, bar RGB green mean {green:.0f} (fill kept underneath)")

    p, err = run(args.comfy, graph("T7_mask_transparent", args.image, {"fill_type": "custom_color"}, save="image", mask=True, fill_alpha="transparent"))
    if err:
        report("T7_mask_transparent", False, err)
    else:
        im, a = alpha_stats(p)
        arr = np.asarray(im.convert("RGBA").resize((src_alpha.shape[1], src_alpha.shape[0]), Image.NEAREST))
        subject = src_alpha >= 250
        # fill alpha 0 blended with fg alpha a at mask (1 - a): out = (1 - a) * a, at most ~5/255 for a >= 250/255
        report("T7_mask_transparent", im.mode == "RGBA" and (arr[..., 3][subject] <= 5).all(),
               f"{im.mode} {im.size}, subject (mask fill area) alpha max {arr[..., 3][subject].max()}")

    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
