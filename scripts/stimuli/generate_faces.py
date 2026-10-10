"""
Generate the "Faces in the Noise" stimulus set (classroom adaptation of the
Noise Pareidolia Test; Yokoi et al., 2014; Mamiya et al., 2016).

WHY GENERATED: the original figshare stimulus set (doi 10.6084/m9.figshare.3187669)
could not be downloaded from the build environment (network policy blocked
figshare.com). Rather than use placeholders, we re-implement the published
construction principle -- greyscale faces embedded in 1/f-spectrum visual noise
in a minority of images -- with procedurally rendered faces whose exact position
is known. These are NOT the validated NPT stimuli.

Reproducible: fixed seeds; `python3 scripts/stimuli/generate_faces.py` rewrites
stimuli/faces/*.webp and stimuli/faces_manifest.json. The manifest is byte-identical;
image pixels match up to the WebP encoder (lossy, quality 90: mean change ~1.6/255 grey levels,
invisible next to the noise SD of ~43 levels; chosen to make the images ~3x smaller for phones).

Requires numpy + Pillow.
"""
import hashlib, json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
STIM_DIR = os.environ.get("STIMULI_OUT", os.path.join(ROOT, "stimuli"))
OUT_PUBLIC = os.path.join(STIM_DIR, "faces")          # participant-visible images (opaque names)
OUT_PRIVATE = os.path.join(STIM_DIR, "private_faces")  # reveal-only images (served behind instructor/projector key)
SIZE = 420
MASTER_SEED = 20261009
NOISE_EXPONENT = 1.5   # amplitude ~ 1/f^1.5  => power spectrum ~ 1/f^3 (as described for the NPT)


def pink_noise(rng, n=SIZE, exponent=NOISE_EXPONENT):
    fx = np.fft.fftfreq(n)[:, None]
    fy = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx ** 2 + fy ** 2)
    f[0, 0] = 1.0
    amp = 1.0 / f ** exponent
    amp[0, 0] = 0.0
    phase = rng.uniform(0, 2 * np.pi, (n, n))
    spec = amp * np.exp(1j * phase)
    img = np.real(np.fft.ifft2(spec))
    img = (img - img.mean()) / img.std()
    return img


def gauss(u, v, cu, cv, su, sv):
    return np.exp(-(((u - cu) / su) ** 2 + ((v - cv) / sv) ** 2) / 2)


def render_face(h_px, params, rng):
    """Render a Lambert-shaded greyscale face on an (h_px x h_px*0.8) canvas.
    Returns (luminance in [0,1], alpha mask in [0,1])."""
    w_px = int(round(h_px * 0.82))
    v, u = np.mgrid[-1.15:1.15:complex(0, h_px), -0.95:0.95:complex(0, w_px)]
    p = params
    head_a, head_b = 0.74 * p["width"], 1.0
    r2 = (u / head_a) ** 2 + (v / head_b) ** 2
    inside = r2 < 1
    z = np.where(inside, np.sqrt(np.clip(1 - r2, 0, 1)), 0.0) * 0.9
    ex, ey = 0.30 * p["eye_sep"], -0.10 + p["eye_y"]
    for s in (-1, 1):
        z -= 0.17 * gauss(u, v, s * ex, ey, 0.16, 0.10)               # eye sockets
        z += 0.06 * gauss(u, v, s * ex, ey - 0.19, 0.22, 0.055)       # brow ridge
        z += 0.06 * gauss(u, v, s * 0.42, 0.22, 0.17, 0.18)           # cheekbones
        z += 0.04 * gauss(u, v, s * 0.10, 0.30 + p["nose_len"], 0.06, 0.05)  # nostril wings
    nose_tip = 0.27 + p["nose_len"]
    ridge = np.clip((v - (ey - 0.05)) / (nose_tip - (ey - 0.05)), 0, 1)
    z += 0.22 * ridge ** 1.3 * gauss(u, v, 0, v, 0.065, 1) * (v < nose_tip + 0.05)
    z += 0.10 * gauss(u, v, 0, nose_tip, 0.085, 0.07)
    my = 0.56 + p["mouth_y"]
    z += 0.035 * gauss(u, v, 0, my - 0.05, 0.19, 0.035)               # upper lip
    z += 0.05 * gauss(u, v, 0, my + 0.06, 0.16, 0.045)                # lower lip
    z -= 0.03 * gauss(u, v, 0, my + 0.20, 0.12, 0.05)                 # mentolabial fold
    z += 0.05 * gauss(u, v, 0, 0.86, 0.17, 0.10)                      # chin
    z = np.where(inside, z, 0)
    # normals & Lambert shading
    dzdv, dzdu = np.gradient(z, 2.3 / h_px, 1.9 / w_px)
    n = np.stack([-dzdu, -dzdv, np.ones_like(z)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    L = np.array(p["light"]); L = L / np.linalg.norm(L)
    shade = np.clip((n * L).sum(-1), 0, 1)
    albedo = np.full_like(z, 0.78)
    for s in (-1, 1):
        albedo -= 0.55 * gauss(u, v, s * ex, ey + 0.005, 0.055, 0.04)               # iris/pupil
        albedo -= 0.45 * gauss(u, v, s * ex, ey - 0.20, 0.15, 0.028) * p["brow"]     # eyebrows
        albedo -= 0.35 * gauss(u, v, s * 0.085, nose_tip + 0.06, 0.03, 0.022)       # nostrils
    albedo -= 0.45 * gauss(u, v, 0, my, 0.17, 0.016)                                # mouth line
    albedo -= 0.12 * gauss(u, v, 0, my + 0.02, 0.16, 0.06)                          # lips
    # hair: dark cap with texture above the forehead
    hair_line = -0.62 + p["hair"]
    hair = np.clip((hair_line - v) / 0.12, 0, 1) * inside
    hair_tex = 0.12 * rng.standard_normal(z.shape)
    albedo = albedo * (1 - hair) + (0.22 + hair_tex) * hair
    lum = 0.18 + 0.82 * shade
    img = np.clip(albedo * lum, 0, 1)
    # soft elliptical alpha so the face dissolves into the noise
    alpha = np.clip((1.0 - r2) / 0.6, 0, 1) ** 2
    return img, alpha


def blur(img, k):
    if k <= 0:
        return img
    x = np.arange(-3 * k, 3 * k + 1)
    g = np.exp(-x ** 2 / (2 * k * k)); g /= g.sum()
    img = np.apply_along_axis(lambda r: np.convolve(r, g, mode="same"), 1, img)
    return np.apply_along_axis(lambda c: np.convolve(c, g, mode="same"), 0, img)


def to_image(arr, path):
    a = np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(a, "L").save(path, "WEBP", quality=90, method=6)


def opaque_id(tag):
    return hashlib.sha256(f"apophenia-lab:{MASTER_SEED}:{tag}".encode()).hexdigest()[:12]


def make_stimulus(idx, face_spec, rng):
    noise = pink_noise(rng)
    base = 0.5 + 0.17 * noise
    entry = {"hasFace": face_spec is not None}
    face_layer = np.zeros_like(base); alpha_full = np.zeros_like(base)
    if face_spec:
        fimg, alpha = render_face(face_spec["height"], face_spec["params"], rng)
        fimg = blur(fimg, face_spec.get("blur", 1.8))
        fh, fw = fimg.shape
        top = face_spec["cy"] - fh // 2; left = face_spec["cx"] - fw // 2
        layer = np.zeros_like(base); a = np.zeros_like(base)
        layer[top:top + fh, left:left + fw] = fimg - fimg[alpha > 0.5].mean()
        a[top:top + fh, left:left + fw] = alpha
        face_layer, alpha_full = layer, a
        c = face_spec["contrast"]
        # additive embedding: the face modulates local luminance on top of the noise
        base = base + c * a * layer
        entry.update({
            "face": {
                # normalised [0,1] coordinates of the face-centre and ellipse radii
                "cx": face_spec["cx"] / SIZE, "cy": face_spec["cy"] / SIZE,
                "rx": (fw * 0.74 * face_spec["params"]["width"] / 1.9) / SIZE,
                "ry": (fh / 2.3) / SIZE,
                "contrast": c, "difficulty": face_spec["difficulty"],
            }
        })
    return np.clip(base, 0, 1), face_layer, alpha_full, entry


def main():
    os.makedirs(OUT_PUBLIC, exist_ok=True); os.makedirs(OUT_PRIVATE, exist_ok=True)
    for d in (OUT_PUBLIC, OUT_PRIVATE):
        for f in os.listdir(d):
            if f.endswith((".png", ".webp")):
                os.remove(os.path.join(d, f))
    rng = np.random.default_rng(MASTER_SEED)

    def face(cx, cy, h, contrast, difficulty, **kw):
        prm = {"width": 1.0, "eye_sep": 1.0, "eye_y": 0.0, "nose_len": 0.0, "mouth_y": 0.0,
               "brow": 1.0, "hair": 0.0, "light": [-0.45, -0.55, 0.75]}
        prm.update(kw)
        return {"cx": cx, "cy": cy, "height": h, "contrast": contrast, "difficulty": difficulty, "params": prm}

    # Scored set: 20 images, 5 with a face (25%), 15 noise-only. Mamiya et al. (2016): 8/40 (20%).
    face_specs = [
        face(150, 175, 225, 0.95, "moderate", width=1.0, light=[-0.5, -0.5, 0.75]),
        face(275, 245, 205, 0.75, "hard", width=0.93, eye_sep=1.05, nose_len=0.03, hair=0.05, light=[0.4, -0.6, 0.7]),
        face(225, 160, 195, 0.72, "hard", width=1.05, eye_y=0.02, mouth_y=-0.02, brow=1.2, light=[-0.2, -0.7, 0.7]),
        face(150, 265, 215, 0.88, "moderate", width=0.97, eye_sep=0.95, nose_len=-0.02, hair=-0.05, light=[0.5, -0.4, 0.75]),
        face(285, 150, 190, 0.6, "very hard", width=1.0, brow=0.8, light=[-0.4, -0.6, 0.7]),
    ]
    layout = ["face" if i in (2, 6, 11, 14, 18) else "noise" for i in range(20)]
    manifest = {"generator": "scripts/stimuli/generate_faces.py", "masterSeed": MASTER_SEED,
                "noise": "Gaussian-phase noise with amplitude spectrum 1/f^1.5 (power 1/f^3), z-scored, mean luminance 0.5, SD 0.17",
                "size": SIZE, "practice": [], "scored": []}
    fi = 0
    for i, kind in enumerate(layout):
        spec = face_specs[fi] if kind == "face" else None
        if spec: fi += 1
        img, layer, alpha, entry = make_stimulus(i, spec, rng)
        sid = opaque_id(f"scored-{i}")
        to_image(img, os.path.join(OUT_PUBLIC, f"{sid}.webp"))
        if spec:
            # reveal image: the hidden face shown at high contrast without noise
            to_image(np.clip(0.5 + 0.9 * alpha * layer, 0, 1), os.path.join(OUT_PRIVATE, f"{sid}-face.webp"))
        entry.update({"id": sid, "file": f"faces/{sid}.webp", "index": i})
        manifest["scored"].append(entry)

    # Practice: one clearly visible face and one noise-only image (not scored)
    for j, spec in enumerate([face(210, 205, 230, 1.0, "easy (practice)"), None]):
        img, layer, alpha, entry = make_stimulus(100 + j, spec, rng)
        sid = opaque_id(f"practice-{j}")
        to_image(img, os.path.join(OUT_PUBLIC, f"{sid}.webp"))
        entry.update({"id": sid, "file": f"faces/{sid}.webp", "index": j})
        manifest["practice"].append(entry)

    with open(os.path.join(STIM_DIR, "faces_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("wrote", len(manifest["scored"]), "scored +", len(manifest["practice"]), "practice images")


if __name__ == "__main__":
    sys.exit(main())
