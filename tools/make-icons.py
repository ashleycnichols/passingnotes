"""Turn one square logo into every icon the app needs.

Usage: python3 tools/make-icons.py path/to/logo.png
Needs Pillow (pip install pillow). The logo should be square, at least 1024x1024,
with a solid background that fills the whole square (iPhone rounds the corners itself).
"""
import sys
from PIL import Image

src = Image.open(sys.argv[1]).convert('RGB')
w, h = src.size
side = min(w, h)
src = src.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))

def save(size, name, pad=0.0):
    if pad:
        bg = src.getpixel((2, 2))
        canvas = Image.new('RGB', (side, side), bg)
        inner = int(side * (1 - 2 * pad))
        canvas.paste(src.resize((inner, inner), Image.LANCZOS), ((side - inner) // 2,) * 2)
        img = canvas
    else:
        img = src
    img.resize((size, size), Image.LANCZOS).save(f'icons/{name}', optimize=True)

save(180, 'apple-touch-icon.png')
save(192, 'icon-192.png')
save(512, 'icon-512.png')
save(512, 'icon-maskable-512.png', pad=0.1)
print('Done. Bump the ?v= numbers in index.html, commit and push.')
