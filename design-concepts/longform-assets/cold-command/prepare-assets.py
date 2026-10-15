from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SOURCE = Path(__file__).resolve().parent
TARGET = SOURCE.parents[2] / "miniprogram" / "assets" / "books" / "cold-command"
TARGET.mkdir(parents=True, exist_ok=True)
source = SOURCE / "cover-original.png"
image = Image.open(source).convert("RGB")
overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)
for y in range(0, 520, 2):
    draw.rectangle((0, y, image.width, y + 1), fill=(7, 12, 20, int(150 * (1 - y / 520))))
image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
font_path = Path("C:/Windows/Fonts/simhei.ttf")
title = ImageFont.truetype(str(font_path), 120)
subtitle = ImageFont.truetype(str(font_path), 58)
draw = ImageDraw.Draw(image)
draw.text((66, 52), "寒门掌兵", font=title, fill="#f7f2e8", stroke_width=2, stroke_fill="#152238")
draw.text((72, 200), "账上少一石，城下就多一具尸", font=subtitle, fill="#dbe7f3", stroke_width=1, stroke_fill="#152238")
image.resize((640, 960), Image.Resampling.LANCZOS).save(TARGET / "cover.webp", "WEBP", quality=84, method=6)
print(TARGET / "cover.webp")
