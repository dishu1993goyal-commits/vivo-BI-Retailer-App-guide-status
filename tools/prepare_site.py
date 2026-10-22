"""Run before publishing a new dashboard index.html:
  python3 tools/prepare_site.py            (live: updates index.html)
  python3 tools/prepare_site.py --preview  (writes web-preview.html, index.html unchanged)
- recompresses oversized embedded images (max 1600 px, WebP) so the page loads faster
- writes states.json (the dashboard's state list) used by the apps' sign-up dropdown
- adds the web layer (login, profile, search, BI Assistant, support desk, admin tools) for the
  dashboard link; the Android apps skip it because they have these features natively
"""
import base64, io, json, re, sys
from PIL import Image

PREVIEW = "--preview" in sys.argv
p = "index.html"
t = open(p, encoding="utf-8").read()

HEAD = ('<script id="biw-gate">(function(){var u=navigator.userAgent;if(/; wv\\)/.test(u)||window.AndroidDL||window.BIAI)return;'
        'document.documentElement.classList.add("biw-web","biw-locked");})();</script>'
        '<style id="biw-gate-css">html.biw-locked body>*:not(#biw-root){visibility:hidden!important}'
        'html.biw-locked body{background:#0b0b0c}</style>')
TAIL = '<script id="biw-loader" src="/web.js" defer></script>'

def add_web_layer(html):
    html = re.sub(r'<script id="biw-gate">.*?</script><style id="biw-gate-css">.*?</style>', "", html, flags=re.S)
    html = html.replace(TAIL, "")
    i = html.find("</head>")   # first </head> is the real one (scripts later contain the text)
    j = html.rfind("</body>")  # last </body> is the real one
    if i < 0 or j < 0 or i > j:
        sys.exit("Couldn't find </head> / </body> in index.html")
    html = html[:i] + HEAD + html[i:]
    j = html.rfind("</body>")
    return html[:j] + TAIL + html[j:]
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
t2 = add_web_layer(t2)
if PREVIEW:
    open("web-preview.html", "w", encoding="utf-8").write(t2)
    print("web-preview.html written (index.html unchanged)")
elif t2 != t:
    open(p, "w", encoding="utf-8").write(t2)
print("dashboard: %.2f MB -> %.2f MB" % (len(t) / 1e6, len(t2) / 1e6))

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
