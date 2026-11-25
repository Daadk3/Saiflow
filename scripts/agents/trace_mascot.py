"""
Traces an agent mascot PNG into SVG parts that can move on their own.

    python3 scripts/agents/trace_mascot.py content-writer      # one mascot
    python3 scripts/agents/trace_mascot.py --all                # every config

Each mascot has a config in scripts/agents/rigs/<id>.json and the output goes
to components/agents/rigs/art/<id>.ts. Needs numpy and Pillow only. Only
needed again if a PNG changes.

How it works
- Every pixel is sorted into the mascot's palette (outline ink plus fills).
- The eyes and mouth are lifted out (the component draws them, so they can
  blink and smile) and the body colour is painted in where they were.
- The picture is cut into parts by the polygons in the config: the body,
  each arm or hand, and the prop. A part can carry a pivot (the joint it
  turns around), a disk of body colour at the pivot (so turning never opens
  a gap) and an "under" polygon: body that is hidden behind the part in the
  picture and shows when the part moves. Under areas get the body colour and
  a fresh outline.
- Each part is painted as stacked colour patches, biggest first, so holes
  (an outline around a fill, a star inside a bag) come out right. Holes you
  can see through (a bag handle) are cut out (draw with fill-rule evenodd). Parts that
  are drawn earlier reach a few pixels under later ones, so there are no
  hairline seams. At rest the parts add up to the original picture.
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONFIGS = os.path.join(ROOT, "scripts", "agents", "rigs")
OUT_DIR = os.path.join(ROOT, "components", "agents", "rigs", "art")


# ---------- small image tools (numpy only) ----------

def label_components(mask):
    """8-connected labelling using row runs and union-find. Returns (labels, n)."""
    H, W = mask.shape
    parent = [0]

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    runs_prev = []
    run_rows = []
    for y in range(H):
        row = mask[y]
        if not row.any():
            runs_prev = []
            run_rows.append([])
            continue
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        starts = np.nonzero(d == 1)[0]
        ends = np.nonzero(d == -1)[0]
        runs = []
        j = 0
        for s, e in zip(starts, ends):
            lab = len(parent)
            parent.append(lab)
            # 8-connected: overlap with [s-1, e+1)
            while j < len(runs_prev) and runs_prev[j][1] < s:
                j += 1
            k = j
            while k < len(runs_prev) and runs_prev[k][0] <= e:
                a, b = find(lab), find(runs_prev[k][2])
                if a != b:
                    parent[max(a, b)] = min(a, b)
                k += 1
            runs.append((s, e, lab))
        run_rows.append(runs)
        runs_prev = runs
    roots = {}
    out = np.zeros((H, W), np.int32)
    for y, runs in enumerate(run_rows):
        for s, e, lab in runs:
            r = find(lab)
            if r not in roots:
                roots[r] = len(roots) + 1
            out[y, s:e] = roots[r]
    return out, len(roots)


def hdilate(mask, w):
    if w <= 0:
        return mask.copy()
    c = np.cumsum(np.pad(mask.astype(np.int32), ((0, 0), (w + 1, w))), axis=1)
    return (c[:, 2 * w + 1:] - c[:, : -2 * w - 1]) > 0


def dilate(mask, r):
    """Dilation by a disk of radius r (union of shifted horizontal segments)."""
    if r <= 0:
        return mask.copy()
    H, W = mask.shape
    out = np.zeros_like(mask)
    cache = {}
    for dy in range(-r, r + 1):
        w = int((r * r - dy * dy) ** 0.5)
        if w not in cache:
            cache[w] = hdilate(mask, w)
        s = cache[w]
        if dy >= 0:
            out[dy:] |= s[: H - dy]
        else:
            out[:dy] |= s[-dy:]
    return out


def fill_holes(mask):
    lab, n = label_components(~mask)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return ~np.isin(lab, list(border))


def largest(mask):
    lab, n = label_components(mask)
    if n <= 1:
        return mask
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    return lab == sizes.argmax()


def blur(mask, r=2):
    f = mask.astype(float)
    for axis in (0, 1):
        pad = [(r + 1, r) if a == axis else (0, 0) for a in (0, 1)]
        c = np.cumsum(np.pad(f, pad), axis=axis)
        f = (c[2 * r + 1:] - c[: -2 * r - 1]) / (2 * r + 1) if axis == 0 else (c[:, 2 * r + 1:] - c[:, : -2 * r - 1]) / (2 * r + 1)
    return f


def poly_mask(points, shape):
    H, W = shape
    img = Image.new("L", (W, H), 0)
    ImageDraw.Draw(img).polygon([tuple(p) for p in points], fill=1)
    return np.array(img).astype(bool)


def disk_mask(c, r, shape):
    H, W = shape
    yy, xx = np.mgrid[0:H, 0:W]
    return (xx - c[0]) ** 2 + (yy - c[1]) ** 2 <= r * r


# ---------- outline tracing ----------

def trace(mask):
    """Outer boundary of a mask as pixel-corner points."""
    m = np.pad(mask, 1).astype(np.uint8)
    H, W = m.shape
    ys, xs = np.nonzero(m)
    i = np.lexsort((xs, ys))[0]
    x, y, d = xs[i], ys[i], 0
    pts = [(x, y)]
    dirs = [(1, 0), (0, 1), (-1, 0), (0, -1)]

    def filled(px, py):
        return 0 <= px < W and 0 <= py < H and m[py, px]

    start = (x, y, d)
    for _ in range(10 ** 7):
        dx, dy = dirs[d]
        x += dx
        y += dy
        if d == 0:
            L, R = (x, y - 1), (x, y)
        elif d == 1:
            L, R = (x, y), (x - 1, y)
        elif d == 2:
            L, R = (x - 1, y), (x - 1, y - 1)
        else:
            L, R = (x - 1, y - 1), (x, y - 1)
        if filled(*L):
            d = (d - 1) % 4
        elif not filled(*R):
            d = (d + 1) % 4
        pts.append((x, y))
        if (x, y, d) == start:
            break
    return [(px - 1, py - 1) for px, py in pts]


def rdp(pts, eps):
    pts = np.array(pts, float)

    def rec(a, b):
        if b <= a + 1:
            return [a]
        p, q = pts[a], pts[b]
        seg = q - p
        L = np.hypot(*seg)
        sub = pts[a + 1: b]
        dist = np.hypot(*(sub - p).T) if L == 0 else np.abs(seg[0] * (sub[:, 1] - p[1]) - seg[1] * (sub[:, 0] - p[0])) / L
        k = dist.argmax()
        if dist[k] > eps:
            return rec(a, a + 1 + k) + rec(a + 1 + k, b)
        return [a]

    sys.setrecursionlimit(100000)
    idx = rec(0, len(pts) - 1) + [len(pts) - 1]
    return pts[idx]


def soften(pts, k):
    P = np.array(pts, float)
    if np.allclose(P[0], P[-1]):
        P = P[:-1]
    if len(P) < 2 * k + 3:
        k = max(0, (len(P) - 3) // 2)
    out = np.zeros_like(P)
    for s in range(-k, k + 1):
        out += np.roll(P, s, axis=0)
    out /= 2 * k + 1
    return np.vstack([out, out[:1]])


def smooth_path(poly):
    P = np.array(poly, float)
    if np.allclose(P[0], P[-1]):
        P = P[:-1]
    n = len(P)
    s = f"M{P[0][0]:.0f} {P[0][1]:.0f}"
    for i in range(n):
        p0, p1, p2, p3 = P[i - 1], P[i], P[(i + 1) % n], P[(i + 2) % n]
        # Catmull-Rom handles, capped at a third of the segment so a short
        # segment at a corner never overshoots into a spike.
        seg = np.hypot(*(p2 - p1)) / 3
        h1 = (p2 - p0) / 6
        h2 = (p3 - p1) / 6
        n1 = np.hypot(*h1)
        n2 = np.hypot(*h2)
        if n1 > seg:
            h1 *= seg / n1
        if n2 > seg:
            h2 *= seg / n2
        c1 = p1 + h1
        c2 = p2 - h2
        s += f"C{c1[0]:.0f} {c1[1]:.0f} {c2[0]:.0f} {c2[1]:.0f} {p2[0]:.0f} {p2[1]:.0f}"
    return s + "Z"


def to_path(mask, eps=1.2, k=3, r=2):
    m = blur(blur(mask, r), r) > 0.5 if r else mask
    if not m.any():
        m = mask
    m = largest(m)
    return smooth_path(rdp(soften(trace(m), k), eps))


# ---------- the rig ----------

def hexcol(c):
    return "#%02x%02x%02x" % tuple(int(v) for v in c)


def build(cfg):
    src = os.path.join(ROOT, "public", "agents", cfg["src"])
    im = np.array(Image.open(src).convert("RGBA")).astype(int)
    H, W = im.shape[:2]
    rgb, alpha = im[..., :3], im[..., 3]
    names = list(cfg["palette"])
    cols = np.array([cfg["palette"][n] for n in names], float)
    d = ((rgb[..., None, :] - cols[None, None]) ** 2).sum(-1)
    lab = d.argmin(-1)
    opaque = alpha >= 128
    lab[~opaque] = -1
    # True colours: the median of the pixels in each class.
    exact = {}
    for i, n in enumerate(names):
        px = rgb[(lab == i) & (alpha > 250) & (d.min(-1) < 900)]
        exact[n] = hexcol(np.median(px, axis=0)) if len(px) else hexcol(cols[i])
    ink = names.index(cfg.get("ink", "ink"))
    body = names.index(cfg["body"])

    # Small specks (anti-aliasing between two fills) join their neighbours.
    min_area = cfg.get("minArea", 30)
    for i in range(len(names)):
        cl, cn = label_components(lab == i)
        if cn == 0:
            continue
        sizes = np.bincount(cl.ravel())
        for j in np.nonzero(sizes[1:] < min_area)[0] + 1:
            m = cl == j
            ring = dilate(m, 2) & ~m & opaque
            nb = lab[ring]
            nb = nb[nb != i]
            if len(nb):
                lab[m] = np.bincount(nb[nb >= 0]).argmax() if (nb >= 0).any() else i

    # Eyes and mouth: ink blobs at the given points.
    inkl, _ = label_components(lab == ink)
    eyes = []
    face_ink = np.zeros((H, W), bool)
    for e in cfg["eyes"]:
        x, y = e["at"]
        k = inkl[y, x]
        assert k, f"no ink at eye {e['at']}"
        m = inkl == k
        face_ink |= m
        ys, xs = np.nonzero(m)
        eye = dict(cx=round(xs.mean(), 1), cy=round(ys.mean(), 1), rx=round((np.ptp(xs) + 1) / 2, 1), ry=round((np.ptp(ys) + 1) / 2, 1))
        if e.get("shape") == "path":
            eye["d"] = to_path(m, 0.6, 2, 1)
        eyes.append(eye)
    mx, my = cfg["mouth"]["at"]
    k = inkl[my, mx]
    assert k, "no ink at mouth"
    mouth_m = inkl == k
    face_ink |= mouth_m
    ys, xs = np.nonzero(mouth_m)
    mouth = dict(d=to_path(mouth_m, 0.6, 2, 1), x0=int(xs.min()), x1=int(xs.max()), y0=int(ys.min()), y1=int(ys.max()))
    extra_face = []
    for f in cfg["mouth"].get("inside", []):
        # Colours inside an open mouth (a tongue) go with the mouth.
        fl, _ = label_components(lab == names.index(f))
        inner = fill_holes(mouth_m) & ~mouth_m
        for j in np.unique(fl[inner]):
            if j:
                m = fl == j
                face_ink |= m
                extra_face.append((exact[f], to_path(m, 0.6, 2, 1)))
    mouth["inner"] = extra_face
    lab[dilate(face_ink, 3) & opaque & (dilate(fill_holes(face_ink), 3))] = body
    for f in cfg.get("paintBody", []):
        lab[poly_mask(f, (H, W)) & opaque] = body

    # Parts.
    region = {"body": opaque.copy()}
    order = ["body"]
    parts = cfg.get("parts", [])
    for p in parts:
        m = poly_mask(p["poly"], (H, W)) & opaque
        for q in order:
            region[q] &= ~m
        region[p["name"]] = m
        order.append(p["name"])
    colours = {q: lab.copy() for q in order}

    # Hidden body under parts, with a fresh outline.
    for p in parts:
        if "under" not in p:
            continue
        u = poly_mask(p["under"], (H, W))
        host = p.get("underHost", "body")
        later = np.zeros((H, W), bool)
        for q in order[order.index(host) + 1:]:
            later |= region[q]
        u &= later | region[host]
        width = p.get("outline", cfg.get("outline", 22))
        ring = dilate(u, width) & ~u & ~region[host] & later
        new = (u | ring) & ~region[host]
        colours[host][u & ~region[host]] = names.index(p.get("underFill", cfg["body"]))
        colours[host][ring] = ink
        region[host] |= new

    # Pivot disks of body colour, so a turning part never opens a gap.
    for p in parts:
        if "disk" not in p:
            continue
        dm = disk_mask(p["pivot"], p["disk"], (H, W)) & (lab == body) & ~region[p["name"]]
        region[p["name"]] |= dm
        colours[p["name"]][dm] = body

    # Earlier parts reach under later ones (no hairline seams).
    for i, q in enumerate(order):
        later = np.zeros((H, W), bool)
        for r in order[i + 1:]:
            later |= region[r]
        grow = dilate(region[q], 5) & later & opaque & ~region[q]
        region[q] |= grow

    # Paint each part as stacked colour patches.
    layers = []
    z = cfg.get("z", order)
    for q in z:
        reg = region[q]
        patches = []
        for i, n in enumerate(names):
            m = reg & (colours[q] == i)
            if not m.any():
                continue
            cl, cn = label_components(m)
            sizes = np.bincount(cl.ravel())
            for j in range(1, cn + 1):
                if sizes[j] < min_area:
                    continue
                cm = cl == j
                filled = fill_holes(cm)
                # See-through holes (a bag handle) stay open.
                see = filled & ~cm & ~opaque
                holes = []
                if see.sum() >= min_area:
                    hl, hn = label_components(see)
                    hs = np.bincount(hl.ravel())
                    holes = [hl == h for h in range(1, hn + 1) if hs[h] >= min_area]
                patches.append((filled.sum(), exact[n], cm, filled, holes))
        patches.sort(key=lambda t: -t[0])
        for area, col, cm, filled, holes in patches:
            thin = (cm.sum() / max(area, 1)) < 0.35 and area < 4000
            path = to_path(filled, 1.0, 2 if thin else 3, 1 if thin else 2)
            for h in holes:
                path += to_path(h, 1.0, 2, 1)
            layers.append([q, col, path])
    out = dict(
        layers=layers,
        eyes=eyes,
        mouth=mouth,
        pivots={p["name"]: list(p["pivot"]) for p in parts if "pivot" in p},
        colours=exact,
        size=[W, H],
    )
    return out


def write_ts(rid, cfg, out):
    lines = [
        f"/**",
        f" * {cfg.get('title', rid)} mascot, traced from public/agents/{cfg['src']}",
        f" * by scripts/agents/trace_mascot.py (config: scripts/agents/rigs/{rid}.json).",
        f" * Generated: change the config or the picture, then run the script again.",
        f" */",
        "",
        'import type { RigArt } from "../types";',
        "",
        "const art: RigArt = {",
        "  layers: [",
    ]
    for q, col, path in out["layers"]:
        lines.append(f'    ["{q}", "{col}", "{path}"],')
    lines.append("  ],")
    lines.append("  eyes: [")
    for e in out["eyes"]:
        extra = f', d: "{e["d"]}"' if "d" in e else ""
        lines.append(f'    {{ cx: {e["cx"]}, cy: {e["cy"]}, rx: {e["rx"]}, ry: {e["ry"]}{extra} }},')
    lines.append("  ],")
    m = out["mouth"]
    lines.append("  mouth: {")
    lines.append(f'    d: "{m["d"]}",')
    lines.append(f"    box: [{m['x0']}, {m['y0']}, {m['x1']}, {m['y1']}],")
    if m["inner"]:
        lines.append("    inner: [" + ", ".join(f'["{c}", "{p}"]' for c, p in m["inner"]) + "],")
    lines.append("  },")
    lines.append(f'  ink: "{out["colours"][cfg.get("ink", "ink")]}",')
    lines.append(f'  bodyColour: "{out["colours"][cfg["body"]]}",')
    lines.append("  pivots: {")
    for k, v in out["pivots"].items():
        lines.append(f"    {k}: [{v[0]}, {v[1]}],")
    lines.append("  },")
    lines.append("};")
    lines.append("")
    lines.append("export default art;")
    lines.append("")
    path = os.path.join(OUT_DIR, f"{rid}.ts")
    open(path, "w").write("\n".join(lines))
    # Match the repo's formatting, if Prettier is installed.
    try:
        subprocess.run(["npx", "--no-install", "prettier", "--write", path],
                       cwd=ROOT, check=False, capture_output=True)
    except OSError:
        pass
    return path


def main(argv):
    ids = sorted(f[:-5] for f in os.listdir(CONFIGS) if f.endswith(".json")) if argv[:1] == ["--all"] else argv
    debug = os.environ.get("RIG_DEBUG_DIR")
    for rid in ids:
        cfg = json.load(open(os.path.join(CONFIGS, f"{rid}.json")))
        out = build(cfg)
        print("wrote", write_ts(rid, cfg, out), len(out["layers"]), "layers")
        if debug:
            os.makedirs(debug, exist_ok=True)
            json.dump(out, open(os.path.join(debug, f"{rid}.json"), "w"))


if __name__ == "__main__":
    main(sys.argv[1:])
