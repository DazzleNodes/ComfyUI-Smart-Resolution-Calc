"""
measure_seed_metadata.py -- ground-truth probe for SmartResCalc seed persistence.

For every SmartResolutionCalc node in each workflow found in:
  * ComfyUI output images (.webp with WAS Node Suite EXIF, .png with tEXt chunks)
  * saved workflow .json files
report, side by side:
  * the seed widget value saved in widgets_values / widgets_values_by_name
  * node.properties.dazzle_last_seed (the recycle buffer mirror, v0.12.2+)
  * the fill_seed actually sent to Python (from the embedded API prompt, images only)
and whether the embedded property equals its own run or the previous image's run.

Used on 2026-09-06 to establish:
  * dazzle_last_seed is present in 19/19 node instances (data path is reliable)
  * random-mode saves carry -1 in the widget, fixed-mode saves carry the seed
  * the embedded dazzle_last_seed is one run stale (7/7 consecutive pairs)
  * the intercept's widgets_values snapshot patches never land (9/9)
See private/claude/2026-09-06__11-16-36__dev-workflow-seed-recall-after-workflow-reload.md

Usage:
  python tests/one-offs/measure_seed_metadata.py [paths or globs ...]
  (default: C:/code/ComfyUI_experiment/output/d3/*.webp)
"""
import glob
import json
import os
import struct
import sys
import zlib

SEED_WIDGET_INDEX = 11  # fill_seed position in SmartResolutionCalc widgets_values


def _json_after(blob: bytes):
    """Parse the first balanced {...} JSON object at the start of blob."""
    depth = 0
    for idx, ch in enumerate(blob):
        if ch == ord('{'):
            depth += 1
        elif ch == ord('}'):
            depth -= 1
            if depth == 0:
                return json.loads(blob[:idx + 1].decode('utf-8', 'ignore'))
    return None


def from_webp(path):
    data = open(path, 'rb').read()
    out = {}
    off = 12
    while off + 8 <= len(data):
        tag = data[off:off + 4]
        size = struct.unpack('<I', data[off + 4:off + 8])[0]
        if tag == b'EXIF':
            exif = data[off + 8:off + 8 + size]
            for name, keys in (('workflow', (b'Workflow:', b'workflow:')),
                               ('prompt', (b'Prompt:', b'prompt:'))):
                for key in keys:
                    # A field starts at a NUL (or the buffer start) and its
                    # value starts with '{'. A bare substring search can hit
                    # text inside the other field's JSON (e.g. a note saying
                    # "prompt: ..." or a URL containing "workflow"), which is
                    # what happened on 2026-09-26 with a newer frontend embed.
                    k = -1
                    start = 0
                    while True:
                        k = exif.find(key, start)
                        if k < 0:
                            break
                        at_field_start = (k == 0 or exif[k - 1] == 0)
                        value_is_json = exif[k + len(key):k + len(key) + 1] == b'{'
                        if at_field_start and value_is_json:
                            break
                        start = k + 1
                    if k >= 0:
                        out[name] = _json_after(exif[k + len(key):])
                        break
        off += 8 + size + (size & 1)
    return out


def from_png(path):
    data = open(path, 'rb').read()
    out = {}
    off = 8
    while off + 8 <= len(data):
        size = struct.unpack('>I', data[off:off + 4])[0]
        tag = data[off + 4:off + 8]
        body = data[off + 8:off + 8 + size]
        if tag in (b'tEXt', b'zTXt', b'iTXt'):
            key, _, rest = body.partition(b'\x00')
            if tag == b'zTXt':
                rest = zlib.decompress(rest[1:])
            elif tag == b'iTXt':
                # compression flag, method, language tag, translated keyword
                comp = rest[0]
                rest = rest[2:]
                rest = rest.split(b'\x00', 2)[-1]
                if comp:
                    rest = zlib.decompress(rest)
            if key in (b'workflow', b'prompt'):
                try:
                    out[key.decode()] = json.loads(rest.decode('utf-8', 'ignore'))
                except Exception as e:  # noqa: BLE001
                    out[key.decode() + '_err'] = str(e)
        off += 12 + size
    return out


def load(path):
    p = path.lower()
    if p.endswith('.webp'):
        return from_webp(path)
    if p.endswith('.png'):
        return from_png(path)
    if p.endswith('.json'):
        return {'workflow': json.load(open(path, encoding='utf-8'))}
    return {}


def main(argv):
    patterns = argv or [r"C:/code/ComfyUI_experiment/output/d3/*.webp"]
    files = []
    for pat in patterns:
        files.extend(sorted(glob.glob(pat)) or [pat])

    rows = []
    prev_prompt_seed = {}
    for path in files:
        blobs = load(path)
        wf, pr = blobs.get('workflow'), blobs.get('prompt')
        if not wf:
            print(f"{os.path.basename(path)}: no embedded workflow")
            continue
        for n in wf.get('nodes', []):
            if n.get('type') != 'SmartResolutionCalc':
                continue
            nid = n['id']
            wv = n.get('widgets_values', [None] * (SEED_WIDGET_INDEX + 1))[SEED_WIDGET_INDEX]
            wv = wv.get('value') if isinstance(wv, dict) else wv
            bn = (n.get('widgets_values_by_name') or {}).get('fill_seed')
            bn = bn.get('value') if isinstance(bn, dict) else bn
            prop = (n.get('properties') or {}).get('dazzle_last_seed')
            pseed = None
            if pr:
                fs = pr.get(str(nid), {}).get('inputs', {}).get('fill_seed')
                pseed = fs.get('value') if isinstance(fs, dict) else fs
            rows.append({
                'file': os.path.basename(path)[:19], 'node': nid, 'widget': wv, 'by_name': bn,
                'prop': prop, 'prompt': pseed,
                'prop==own': (pseed is not None and prop == pseed),
                'prop==prev': (nid in prev_prompt_seed and prop == prev_prompt_seed[nid]),
            })
            if pseed is not None:
                prev_prompt_seed[nid] = pseed

    hdr = f"{'file':<20}{'node':<6}{'widget':<18}{'by_name':<18}{'prop dazzle_last':<18}{'prompt (sent)':<18}{'own':<6}prev"
    print(hdr)
    for r in rows:
        print(f"{r['file']:<20}{r['node']:<6}{str(r['widget']):<18}{str(r['by_name']):<18}"
              f"{str(r['prop']):<18}{str(r['prompt']):<18}{str(r['prop==own']):<6}{r['prop==prev']}")
    n = len(rows)
    print(f"\nrows={n} widget_shows_seed={sum(1 for r in rows if r['widget'] == r['prop'] and r['prop'] is not None)} "
          f"widget=-1_with_prop={sum(1 for r in rows if r['widget'] == -1 and r['prop'] is not None)} "
          f"prop_missing={sum(1 for r in rows if r['prop'] is None)} "
          f"prop==own_run={sum(1 for r in rows if r['prop==own'])}/{sum(1 for r in rows if r['prompt'] is not None)} "
          f"prop==prev_run={sum(1 for r in rows if r['prop==prev'])}")


if __name__ == '__main__':
    main(sys.argv[1:])
