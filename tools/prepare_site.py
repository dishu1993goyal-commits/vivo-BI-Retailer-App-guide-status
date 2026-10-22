"""Run before publishing a new dashboard index.html:
  python3 tools/prepare_site.py
- recompresses oversized embedded images (max 1600 px, WebP) so the page loads faster
- writes states.json (the dashboard's state list) used by the apps' sign-up dropdown
"""
import base64, io, json, re, sys
from PIL import Image

p = "index.html"
t = open(p, encoding="utf-8").read()
seen = {}

def opt(m):
    b = m.group(2)
    if b in seen:
        return seen[b]
    out = m.group(0)
    if len(b) > 60 * 1024:
        try:
            im = Image.open(io.BytesIO(base64.b64decode(b)))
            im.load()
            w, h = im.size
            s = min(1.0, 1600 / max(w, h))
            if s < 1:
                im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=80, method=6)
            nb = base64.b64encode(buf.getvalue()).decode()
            if len(nb) < len(b) * 0.9:
                out = "data:image/webp;base64," + nb
        except Exception as e:
            print("skip image:", e)
    seen[b] = out
    return out

t2 = re.sub(r"data:image/([a-z+]+);base64,([A-Za-z0-9+/=]+)", opt, t)
if t2 != t:
    open(p, "w", encoding="utf-8").write(t2)
print("index.html: %.2f MB -> %.2f MB" % (len(t) / 1e6, len(t2) / 1e6))

m = re.search(r'<script type="application/json" id="dd">(.*?)</script>', t2, re.S)
states = []
if m:
    d = json.loads(m.group(1))
    setup = (d.get("setup") or [{}])[0]
    states = sorted({x["state"] for x in setup.get("states", []) if x.get("state")})
if not states:
    sys.exit("No state list found in the dashboard data; states.json not written.")
json.dump({"states": states}, open("states.json", "w"), ensure_ascii=False, indent=1)
print("states.json:", len(states), "states")
