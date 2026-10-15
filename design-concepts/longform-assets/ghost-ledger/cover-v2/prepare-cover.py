import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


def main():
    parser = argparse.ArgumentParser(description="Typeset the approved ink cover without changing the original.")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--title-font", type=Path, default=Path("C:/Windows/Fonts/STXINGKA.TTF"))
    parser.add_argument("--body-font", type=Path, default=Path("C:/Windows/Fonts/simhei.ttf"))
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    artwork = ImageOps.exif_transpose(Image.open(args.source)).convert("RGB")
    artwork = ImageOps.fit(artwork, (1024, 1536), method=Image.Resampling.LANCZOS)
    # Keep lettering clear of the head; the provider did not reserve enough space.
    cover = Image.new("RGB", artwork.size, artwork.getpixel((512, 40)))
    cover.paste(artwork, (0, 360))
    draw = ImageDraw.Draw(cover)
    title = ImageFont.truetype(str(args.title_font), 244)
    subtitle = ImageFont.truetype(str(args.body_font), 72)
    author = ImageFont.truetype(str(args.body_font), 32)
    draw.text((90, 52), "镇诡司", font=title, fill="#1c1c1c", anchor="lt", stroke_width=2)
    draw.text((98, 300), "我以功簿斩妖", font=subtitle, fill="#1c1c1c", anchor="lt")
    draw.line((100, 414, 184, 414), fill="#ca2927", width=5)
    draw.text((208, 400), "唐渡 著", font=author, fill="#494949", anchor="lt")
    full = directory / "cover-typeset.png"
    optimized = directory / "cover-ink-v2.webp"
    cover.save(full, "PNG")
    cover.resize((640, 960), Image.Resampling.LANCZOS).save(optimized, "WEBP", quality=87, method=6)
    thumbnail = directory / "thumbnail-120.png"
    cover.resize((120, 180), Image.Resampling.LANCZOS).save(thumbnail, "PNG")
    print(f"Typeset: {full}")
    print(f"Optimized: {optimized}, {optimized.stat().st_size} bytes")
    print(f"Thumbnail: {thumbnail}")


if __name__ == "__main__":
    main()
