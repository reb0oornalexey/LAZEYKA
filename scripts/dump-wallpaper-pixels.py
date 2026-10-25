"""Раскладывает встроенные обои в маленькие массивы пикселей (для проверок без sharp).
Запуск: python scripts/dump-wallpaper-pixels.py"""
import json, os
from PIL import Image

root = os.path.join(os.path.dirname(__file__), '..', 'src', 'renderer', 'src', 'assets', 'wallpapers')
out = {}
for name in ('anime', 'crimson', 'orange'):
    im = Image.open(os.path.join(root, name + '.webp')).convert('RGB')
    im.thumbnail((64, 64))
    out[name] = [list(p) for p in im.getdata()]
with open(os.path.join(os.path.dirname(__file__), 'wallpaper-pixels.json'), 'w') as f:
    json.dump(out, f)
print({k: len(v) for k, v in out.items()})
