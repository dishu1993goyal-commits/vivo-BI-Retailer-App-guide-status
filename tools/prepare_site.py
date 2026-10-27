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
THEME = '<script id="biw-theme-js" src="/theme.js?v=3"></script><script id="biw-dashx-js" src="/dashx.js?v=1" defer></script><script id="biw-lang-js" src="/lang.js?v=2" defer></script>'
# Voice notes in the Android apps: the in-app browser has no speech recognition, so the apps provide window.BISpeech
# and this turns it into the standard window.webkitSpeechRecognition before the smart tools load.
SPEECH = ('<script id="biw-speech">(function(){if(!window.BISpeech)return;var cur=null;'
          'function SR(){this.lang="en-IN";this.continuous=false;this.interimResults=false;this.maxAlternatives=1;this.onresult=null;this.onerror=null;this.onend=null;this.onstart=null;this._res=[]}'
          'SR.prototype.start=function(){cur=this;this._res=[];window.BISpeech.start(String(this.lang||"en-IN"),!!this.interimResults)};'
          'SR.prototype.stop=function(){if(cur===this)window.BISpeech.stop()};SR.prototype.abort=function(){if(cur===this)window.BISpeech.abort()};'
          'window.__bisp=function(t,a){var r=cur;if(!r)return;if(t==="start"){r.onstart&&r.onstart({})}'
          'else if(t==="partial"||t==="final"){var it=[{transcript:a,confidence:1}];it.isFinal=t==="final";var res=r._res.slice();res.push(it);if(t==="final")r._res.push(it);'
          'r.onresult&&r.onresult({resultIndex:res.length-1,results:res})}else if(t==="error"){r.onerror&&r.onerror({error:a})}else if(t==="end"){cur=null;r.onend&&r.onend({})}};'
          'window.webkitSpeechRecognition=window.SpeechRecognition=SR})();</script>')

def add_web_layer(html):
    html = re.sub(r'<script id="biw-gate">.*?</script><style id="biw-gate-css">.*?</style>', "", html, flags=re.S)
    html = re.sub(r'<script id="biw-speech">.*?</script>', "", html, flags=re.S)
    html = re.sub(r'<script id="biw-theme-js"[^>]*></script>', "", html)
    html = re.sub(r'<script id="biw-dashx-js"[^>]*></script>', "", html)
    html = re.sub(r'<script id="biw-lang-js"[^>]*></script>', "", html)
    html = html.replace(TAIL, "")
    i = html.find("</head>")   # first </head> is the real one (scripts later contain the text)
    j = html.rfind("</body>")  # last </body> is the real one
    if i < 0 or j < 0 or i > j:
        sys.exit("Couldn't find </head> / </body> in index.html")
    html = html[:i] + HEAD + SPEECH + THEME + html[i:]
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
