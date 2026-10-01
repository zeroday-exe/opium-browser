import math
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OPIUM = ROOT / "opium"
ENGINE = Path(sys.argv[1]).resolve()
BRANDING = ENGINE / "browser" / "branding" / "opium"
APP_FILES = ENGINE / "browser" / "app" / "opium"
SENTINEL = 'pref("opium.enabled", true);'
FONT_ZIP = "https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip"
FONT_FILE = "JetBrainsMonoNerdFont"
FONT_FAMILY = "JetBrainsMono Nerd Font"
FONT_WEIGHTS = ("Regular", "Medium", "Bold")
UBLOCK ="https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi"

TEXT_SUFFIXES = {".ftl", ".properties", ".sh", ".nsi", ".dtd", ".inc", ".build", ".mn", ".css", ".xhtml", ".manifest"}
NAMES = [
    ("Firefox Developer Edition", "Opium"),
    ("Mozilla Developer Preview", "Opium"),
    ("Firefox Nightly", "Opium"),
    ("Nightly", "Opium"),
    ("Firefox", "Opium"),
]


def render_logo(size):
    s = 1024
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((60, 60, s - 60, s - 60), fill=(176, 108, 255, 200))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(40)))

    disc = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(disc)
    r0 = s // 2 - 90
    for i in range(r0, 0, -2):
        t = i / r0
        col = (
            int(224 * (1 - t) + 60 * t),
            int(168 * (1 - t) + 16 * t),
            int(255 * (1 - t) + 120 * t),
            255,
        )
        d.ellipse((s // 2 - i - 40 * (1 - t), s // 2 - i - 60 * (1 - t), s // 2 + i - 40 * (1 - t), s // 2 + i - 60 * (1 - t)), fill=col)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse((90, 90, s - 90, s - 90), fill=255)
    img.paste(disc, (0, 0), mask)

    flake = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    f = ImageDraw.Draw(flake)
    cx = cy = s / 2
    arm = 290
    w = 44
    for k in range(6):
        a = k * math.pi / 3 - math.pi / 2
        ex, ey = cx + arm * math.cos(a), cy + arm * math.sin(a)
        f.line((cx, cy, ex, ey), fill=(255, 255, 255, 255), width=w)
        f.ellipse((ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2), fill=(255, 255, 255, 255))
        for side in (-1, 1):
            bx, by = cx + arm * 0.58 * math.cos(a), cy + arm * 0.58 * math.sin(a)
            b = a + side * math.pi / 4
            tx, ty = bx + arm * 0.3 * math.cos(b), by + arm * 0.3 * math.sin(b)
            f.line((bx, by, tx, ty), fill=(255, 255, 255, 255), width=int(w * 0.8))
            f.ellipse((tx - w * 0.4, ty - w * 0.4, tx + w * 0.4, ty + w * 0.4), fill=(255, 255, 255, 255))
    f.ellipse((cx - 60, cy - 60, cx + 60, cy + 60), fill=(255, 255, 255, 255))
    halo = flake.filter(ImageFilter.GaussianBlur(18))
    img.alpha_composite(halo)
    img.alpha_composite(flake)
    return img.resize((size, size), Image.LANCZOS)


def write_logo_over(path):
    suffix = path.suffix.lower()
    if suffix == ".ico":
        render_logo(256).save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        return
    with Image.open(path) as old:
        w, h = old.size
        mode = old.mode
    if suffix == ".bmp":
        bg = Image.new("RGB", (w, h), (13, 7, 24))
        side = int(min(w, h) * 0.7)
        logo = render_logo(side)
        bg.paste(logo, ((w - side) // 2, (h - side) // 2), logo)
        bg.save(path)
        return
    side = min(w, h)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    logo = render_logo(side)
    canvas.alpha_composite(logo, ((w - side) // 2, (h - side) // 2))
    if mode not in ("RGBA", "LA", "P"):
        canvas = canvas.convert("RGB")
    canvas.save(path)


def logo_svg():
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<defs><radialGradient id="g" cx=".4" cy=".35" r=".7">'
        '<stop offset="0" stop-color="#e0a8ff"/><stop offset="1" stop-color="#3c1078"/></radialGradient></defs>'
        '<circle cx="32" cy="32" r="29" fill="url(#g)"/>'
        '<g stroke="#fff" stroke-width="3" stroke-linecap="round">'
        + "".join(
            f'<line x1="32" y1="32" x2="{32 + 18 * math.cos(k * math.pi / 3 - math.pi / 2):.2f}" y2="{32 + 18 * math.sin(k * math.pi / 3 - math.pi / 2):.2f}"/>'
            for k in range(6)
        )
        + "</g></svg>\n"
    )


def build_branding():
    if BRANDING.exists():
        shutil.rmtree(BRANDING)
    shutil.copytree(ENGINE / "browser" / "branding" / "unofficial", BRANDING)
    for p in BRANDING.rglob("*"):
        if not p.is_file():
            continue
        suffix = p.suffix.lower()
        if suffix in TEXT_SUFFIXES or p.name == "configure.sh":
            text = p.read_text(encoding="utf-8")
            for a, b in NAMES:
                text = re.sub(rf"\b{re.escape(a)}\b", b, text)
            p.write_text(text, encoding="utf-8")
        elif suffix in (".png", ".ico", ".bmp"):
            write_logo_over(p)
        elif suffix == ".svg":
            p.write_text(logo_svg(), encoding="utf-8")
    cfg = BRANDING / "configure.sh"
    text = cfg.read_text(encoding="utf-8")
    text = re.sub(r"MOZ_APP_DISPLAYNAME=.*", "MOZ_APP_DISPLAYNAME=Opium", text)
    if "MOZ_APP_DISPLAYNAME" not in text:
        text += "MOZ_APP_DISPLAYNAME=Opium\n"
    cfg.write_text(text, encoding="utf-8")
    render_logo(512).save(ROOT / "opium" / "logo.png")


def fetch_fonts():
    target = APP_FILES / "fonts"
    target.mkdir(parents=True, exist_ok=True)
    if all((target / f"{FONT_FILE}-{w}.ttf").exists() for w in FONT_WEIGHTS):
        return
    archive = APP_FILES / "font.zip"
    urllib.request.urlretrieve(FONT_ZIP, archive)
    with zipfile.ZipFile(archive) as z:
        for w in FONT_WEIGHTS:
            (target / f"{FONT_FILE}-{w}.ttf").write_bytes(z.read(f"{FONT_FILE}-{w}.ttf"))
    archive.unlink()


def font_faces():
    weights = {"Regular": 400, "Medium": 500, "Bold": 700}
    return "".join(
        f'@font-face {{ font-family: "{FONT_FAMILY}"; src: url("fonts/{FONT_FILE}-{w}.ttf"); font-weight: {weights[w]}; }}\n'
        for w in FONT_WEIGHTS
    )


def build_css():
    files = OPIUM / "files"
    chrome = (files / "userChrome.css").read_text(encoding="utf-8")
    content = (files / "userContent.css").read_text(encoding="utf-8")
    font_rule = f'#main-window, #main-window *, menupopup, panel {{ font-family: "{FONT_FAMILY}", monospace !important; }}\n'
    return (
        font_faces()
        + '@-moz-document url("chrome://browser/content/browser.xhtml") {\n'
        + font_rule
        + chrome
        + "\n}\n"
        + content
    )


def install_files():
    APP_FILES.mkdir(parents=True, exist_ok=True)
    for name in ("policies.json", "autoconfig.js", "opium.cfg", "opium-start.html"):
        shutil.copy2(OPIUM / "files" / name, APP_FILES / name)
    fetch_fonts()
    (APP_FILES / "opium.css").write_text(build_css(), encoding="utf-8")
    xpi = APP_FILES / "uBlock0@raymondhill.net.xpi"
    if not xpi.exists():
        urllib.request.urlretrieve(UBLOCK, xpi)

    mozbuild = ENGINE / "browser" / "app" / "moz.build"
    text = mozbuild.read_text(encoding="utf-8")
    if "opium/policies.json" not in text:
        text += (
            "\nFINAL_TARGET_FILES += ['opium/opium-start.html', 'opium/opium.cfg', 'opium/opium.css']\n"
            "FINAL_TARGET_FILES.defaults.pref += ['opium/autoconfig.js']\n"
            "FINAL_TARGET_FILES.distribution += ['opium/policies.json']\n"
            "FINAL_TARGET_FILES.fonts += ["
            + ", ".join(f"'opium/fonts/{FONT_FILE}-{w}.ttf'" for w in FONT_WEIGHTS)
            + "]\n"
            "FINAL_TARGET_FILES.distribution.extensions += ['opium/uBlock0@raymondhill.net.xpi']\n"
        )
        mozbuild.write_text(text, encoding="utf-8")

    manifest = ENGINE / "browser" / "installer" / "package-manifest.in"
    text = manifest.read_text(encoding="utf-8")
    if "opium.cfg" not in text:
        text += (
            "\n[opium]\n"
            "@BINPATH@/opium-start.html\n"
            "@BINPATH@/opium.cfg\n"
            "@BINPATH@/opium.css\n"
            "@BINPATH@/defaults/pref/autoconfig.js\n"
            "@BINPATH@/distribution/policies.json\n"
            "@BINPATH@/distribution/extensions/uBlock0@raymondhill.net.xpi\n"
            + "".join(f"@BINPATH@/fonts/{FONT_FILE}-{w}.ttf\n" for w in FONT_WEIGHTS)
        )
        manifest.write_text(text, encoding="utf-8")


def install_prefs():
    target = ENGINE / "browser" / "app" / "profile" / "firefox.js"
    text = target.read_text(encoding="utf-8")
    if SENTINEL not in text:
        prefs = (OPIUM / "prefs" / "opium.js").read_text(encoding="utf-8")
        text += "\n" + SENTINEL + "\n" + prefs + "\n"
        target.write_text(text, encoding="utf-8")


def main():
    shutil.copy2(ROOT / "mozconfig", ENGINE / "mozconfig")
    build_branding()
    install_files()
    install_prefs()
    print("prepared", ENGINE)


if __name__ == "__main__":
    main()
