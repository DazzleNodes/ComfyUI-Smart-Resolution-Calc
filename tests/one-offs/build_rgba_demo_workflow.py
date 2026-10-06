"""Build docs/workflow/SmartResCalc-RGBA-Alpha-Demo.json and its transparent test image.

The demo: one transparent PNG -> Join Image with Alpha -> two SmartResCalc nodes padding it to
1:1 with a green fill. Left: no DazzleOptions (fill is opaque, as always). Right: DazzleOptions
fill_alpha = transparent (the padding stays transparent; the image's own transparency is kept
in both).

The SmartResCalc node's widget values are written by NAME, in the order the current frontend
serialises them (from a workflow saved on frontend 1.53 / SmartResCalc 0.12.7), and also stored as
widgets_values_named. Saved widget values are positional, so copying them from an older workflow
(the first version of this demo copied the v0.12.0 mask demo) shifts every value by one slot.
Sockets (image, vae, ...) still come from SmartResCalc-Mask-Test-Workflow.json.

Usage: python tests/one-offs/build_rgba_demo_workflow.py   (writes into docs/workflow/)
"""
import copy
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "workflow"
TEMPLATE = OUT_DIR / "SmartResCalc-Mask-Test-Workflow.json"
DEMO_IMAGE = "smartrescalc-rgba-demo.png"

# Current widget order (frontend 1.53, SmartResCalc 0.12.7+); the frontend restores widgets_values by position
SRC_WIDGETS = {
    "aspect_ratio": "1:1 (Square - Instagram/Profile)",
    "divisible_by": "16",
    "custom_ratio": False,
    "mode_status": "Calculating...",
    "custom_aspect_ratio": "16:9",
    "batch_size": 1,
    "scale": 1,
    "fill_type": "custom_color",
    "color_picker_button": None,
    "blend_strength": 0,
    "fill_seed": {"on": True, "value": 2028},
    "image_purpose": "img2img",
    "fill_blend_strength": 0,
    "cutoff": 0.2,
    "spectral_blend_2d": {"blend": 0, "cutoff": 0.2},
    "feature_size": -1,
    "output_image_mode": "transform (scale/pad)",
    "fill_color": "#00ff00",
    "image_mode": {"on": False, "value": 0},
    "copy_from_image": None,
    "dimension_megapixel": {"on": False, "value": 1},
    "dimension_width": {"on": False, "value": 1024},
    "dimension_height": {"on": True, "value": 1024},
}

NOTE = """## RGBA (alpha) demo

Copy `docs/workflow/smartrescalc-rgba-demo.png` into ComfyUI's `input/` folder (or pick any transparent PNG).

**Join Image with Alpha** turns LoadImage's IMAGE + MASK back into one RGBA image. Both SmartResCalc nodes pad it from 3:2 to 1:1 with a green fill (`transform (scale/pad)`):

- **Left, no Dazzle Options:** the padding is the opaque green fill (the default, same as before).
- **Right, Dazzle Options `fill_alpha = transparent`:** the padding is transparent; the green is still in the RGB underneath. `fill_alpha` is the last dropdown on the Dazzle Options node (`opaque` / `transparent`).

In both, the ring's own transparent areas stay transparent. Open the saved PNGs (`output/SmartResCalc-RGBA-demo/`) in an editor that shows transparency.

`fill_alpha` also applies to the mask cutout's fill. RGB images are unaffected.
"""


def make_demo_image(path):
    im = Image.new("RGBA", (600, 400), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((150, 50, 450, 350), fill=(230, 60, 80, 255))
    d.ellipse((240, 140, 360, 260), fill=(0, 0, 0, 0))  # the hole stays transparent
    d.rectangle((40, 170, 560, 230), fill=(250, 200, 60, 255))
    im.save(path)


def main():
    make_demo_image(OUT_DIR / DEMO_IMAGE)
    template = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    src = next(n for n in template["nodes"] if n["type"] == "SmartResolutionCalc")

    def src_node(id, x, dazzle_link, out_link):
        n = copy.deepcopy(src)
        n.update(id=id, pos=[x, 0], order=id)
        n["inputs"] = [i for i in n["inputs"] if not i.get("widget")]
        n["widgets_values"] = list(SRC_WIDGETS.values())
        n["widgets_values_named"] = dict(SRC_WIDGETS)
        for inp in n["inputs"]:
            inp["link"] = {"image": 2 + (id == 5), "dazzle_options": dazzle_link}.get(inp["name"])
        for out in n["outputs"]:
            out["links"] = [out_link] if out["name"] == "image" else []
        return n

    nodes = [
        {"id": 1, "type": "LoadImage", "pos": [0, 0], "size": [320, 360], "flags": {}, "order": 0, "mode": 0,
         "inputs": [], "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [10], "slot_index": 0},
                                   {"name": "MASK", "type": "MASK", "links": [11], "slot_index": 1}],
         "properties": {"Node name for S&R": "LoadImage"}, "widgets_values": [DEMO_IMAGE, "image"]},
        {"id": 2, "type": "JoinImageWithAlpha", "pos": [360, 0], "size": [240, 50], "flags": {}, "order": 1, "mode": 0,
         "inputs": [{"name": "image", "type": "IMAGE", "link": 10}, {"name": "alpha", "type": "MASK", "link": 11}],
         "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": [2, 3], "slot_index": 0}],
         "properties": {"Node name for S&R": "JoinImageWithAlpha"}},
        {"id": 3, "type": "DazzleOptions", "pos": [1000, 650], "size": [340, 260],
         "flags": {}, "order": 2, "mode": 0, "inputs": [{"name": "options_in", "type": "DAZZLE_OPTIONS", "link": None, "shape": 7}],
         "outputs": [{"name": "options", "type": "DAZZLE_OPTIONS", "links": [12], "slot_index": 0}],
         "properties": {"Node name for S&R": "DazzleOptions"}, "widgets_values": ["auto", 1.0, "gaussian", False, "transparent"]},
        src_node(4, 640, None, 13),
        src_node(5, 1000, 12, 14),
        {"id": 6, "type": "SaveImage", "title": "Default: opaque fill", "pos": [640, 650], "size": [320, 360], "flags": {}, "order": 6, "mode": 0,
         "inputs": [{"name": "images", "type": "IMAGE", "link": 13}], "outputs": [],
         "properties": {"Node name for S&R": "SaveImage"}, "widgets_values": ["SmartResCalc-RGBA-demo/opaque-fill"]},
        {"id": 7, "type": "SaveImage", "title": "fill_alpha = transparent", "pos": [1360, 650], "size": [320, 360], "flags": {}, "order": 7, "mode": 0,
         "inputs": [{"name": "images", "type": "IMAGE", "link": 14}], "outputs": [],
         "properties": {"Node name for S&R": "SaveImage"}, "widgets_values": ["SmartResCalc-RGBA-demo/transparent-fill"]},
        {"id": 8, "type": "MarkdownNote", "title": "Read me", "pos": [0, 420], "size": [600, 420], "flags": {}, "order": 8, "mode": 0,
         "inputs": [], "outputs": [], "properties": {}, "widgets_values": [NOTE]},
    ]
    links = [[10, 1, 0, 2, 0, "IMAGE"], [11, 1, 1, 2, 1, "MASK"], [2, 2, 0, 4, 0, "IMAGE"], [3, 2, 0, 5, 0, "IMAGE"],
             [12, 3, 0, 5, [i["name"] for i in src["inputs"]].index("dazzle_options"), "DAZZLE_OPTIONS"],
             [13, 4, 5, 6, 0, "IMAGE"], [14, 5, 5, 7, 0, "IMAGE"]]
    wf = {"last_node_id": 8, "last_link_id": 14, "nodes": nodes, "links": links, "groups": [], "config": {},
          "extra": {"ds": {"scale": 0.7, "offset": [40, 60]}}, "version": 0.4}
    out = OUT_DIR / "SmartResCalc-RGBA-Alpha-Demo.json"
    out.write_text(json.dumps(wf, indent=2), encoding="utf-8")
    print(f"wrote {out} and {OUT_DIR / DEMO_IMAGE}")


if __name__ == "__main__":
    main()
