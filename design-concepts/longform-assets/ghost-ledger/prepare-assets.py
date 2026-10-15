from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SOURCE = Path(__file__).resolve().parent
TARGET = SOURCE.parents[2] / "miniprogram" / "assets" / "books" / "ghost-ledger"
TARGET.mkdir(parents=True, exist_ok=True)


def prepare(name, size, cover=False):
    source = SOURCE / f"{name}-original.png"
    if not source.exists():
        print(f"missing source: {source.name}")
        return
    target = TARGET / f"{name}.webp"
    if target.exists():
        print(f"already prepared: {target.name}")
        return

    image = Image.open(source).convert("RGB")
    if cover:
        wash = Image.new("RGBA", image.size, (0, 0, 0, 0))
        painter = ImageDraw.Draw(wash)
        for y in range(0, 450, 2):
            alpha = int(125 * (1 - y / 450))
            painter.rectangle((0, y, image.width, y + 1), fill=(4, 10, 17, alpha))
        image = Image.alpha_composite(image.convert("RGBA"), wash).convert("RGB")
        painter = ImageDraw.Draw(image)
        font = Path("C:/Windows/Fonts/simhei.ttf")
        title = ImageFont.truetype(str(font), 120)
        subtitle = ImageFont.truetype(str(font), 68)
        painter.text((64, 48), "\u9547\u8be1\u53f8", font=title, fill="#f7edd9", stroke_width=2, stroke_fill="#141b24")
        painter.text((72, 205), "\u6211\u4ee5\u529f\u7c3f", font=subtitle, fill="#e9cd95", stroke_width=2, stroke_fill="#141b24")
        painter.text((72, 286), "\u65a9\u5996", font=subtitle, fill="#e9cd95", stroke_width=2, stroke_fill="#141b24")

    image = image.resize(size, Image.Resampling.LANCZOS)
    image.save(target, "WEBP", quality=82, method=6)
    print(f"prepared: {target.name}, {target.stat().st_size} bytes")


prepare("cover", (640, 960), cover=True)
for portrait in ("lu-zhao", "xu-qingtang", "he-tingzhou", "sikong-jin"):
    prepare(portrait, (512, 768))
prepare("blackwater-pass", (960, 640))
