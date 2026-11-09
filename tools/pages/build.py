import sys, re
S = open('/home/claude/site-branch/survey.html').read()
css = S.split('<style>')[1].split('</style>')[0]
lines = S.split('\n')
core = '\n'.join(lines[203:366]) + '\n' + lines[491] + '\n' + '\n'.join(lines[493:505])
assert core.strip().startswith('var $') and 'function sheet(' in core and core.rstrip().endswith('}'), core[-200:]
for src, dst in [('chat.src.html', 'chat.html'), ('brandmat.src.html', 'brandmat.html'), ('salary.src.html', 'salary.html'), ('khata.src.html', 'khata.html'), ('matrix.src.html', 'matrix.html'), ('security.src.html', 'security.html'), ('directory.src.html', 'directory.html'), ('visits.src.html', 'visits.html'), ('knowledge.src.html', 'knowledge.html'), ('affordability.src.html', 'affordability.html'), ('hub.src.html', 'hub.html'), ('reports.src.html', 'reports.html'), ('help.src.html', 'help.html'), ('disputes.src.html', 'disputes.html'), ('hygiene.src.html', 'hygiene.html'), ('engage.src.html', 'engage.html'), ('schemes.src.html', 'schemes.html'), ('admin-tools.src.html', 'admin-tools.html'), ('invite.src.html', 'invite.html'), ('tool.src.html', 'tool.html'), ('studio.src.html', 'studio.html'), ('fieldnotes.src.html', 'fieldnotes.html'), ('toolactivity.src.html', 'toolactivity.html'), ('schemecalc.src.html', 'schemecalc.html'), ('mailer.src.html', 'mailer.html'), ('config.src.html', 'config.html'), ('hygcheck.src.html', 'hygcheck.html'), ('sheetjoin.src.html', 'sheetjoin.html'), ('targetsplit.src.html', 'targetsplit.html'), ('guide.src.html', 'guide.html'), ('statemap.src.html', 'statemap.html'), ('faces.src.html', 'faces.html'), ('reviewdeck.src.html', 'reviewdeck.html'), ('insights.src.html', 'insights.html'), ('business.src.html', 'business.html'), ('calendar.src.html', 'calendar.html'), ('myday.src.html', 'myday.html'), ('access.src.html', 'access.html'), ('deckstudio.src.html', 'deckstudio.html'), ('pmail.src.html', 'pmail.html'), ('applab.src.html', 'applab.html'), ('portals.src.html', 'portals.html'), ('rewards.src.html', 'rewards.html'), ('newsletter.src.html', 'newsletter.html'), ('appguide.src.html', 'appguide.html'), ('geolocate.src.html', 'geolocate.html'), ('storelocator.src.html', 'storelocator.html'), ('producthub.src.html', 'producthub.html'), ('recommend.src.html', 'recommend.html'), ('schemeassist.src.html', 'schemeassist.html'), ('retailerpay.src.html', 'retailerpay.html'), ('payplanner.src.html', 'payplanner.html'), ('schemepolicy.src.html', 'schemepolicy.html'), ('toolbuilder.src.html', 'toolbuilder.html'), ('retailerportal.src.html', 'retailerportal.html'), ('imeiunblock.src.html', 'imeiunblock.html'), ('schemeroi.src.html', 'schemeroi.html'), ('forecast.src.html', 'forecast.html'), ('compete.src.html', 'compete.html'), ('manuals.src.html', 'manuals.html')]:
    try: t = open('/home/claude/site-branch/tools/pages/' + src).read()
    except FileNotFoundError: continue
    t = t.replace('/*@@CSS@@*/', css).replace('  /*@@CORE@@*/', core)
    if dst == 'khata.html': open('/home/claude/site-branch/' + dst, 'w').write(t); print('built', dst, len(t)); continue   # stands alone: shop owners have no BI login
    if 'theme.js' not in t: t = t.replace('</head>', '<script src="theme.js?v=8"></script>\n</head>', 1)
    if 'lang.js' not in t: t = t.replace('</head>', '<script src="lang.js?v=3" defer></script>\n</head>', 1)
    if 'access.js' not in t and dst != 'invite.html': t = t.replace('</head>', '<script src="access.js?v=2"></script>\n</head>', 1)
    if 'cust.js' not in t and dst != 'invite.html': t = t.replace('</head>', '<script src="cust.js?v=65"></script>\n</head>', 1)
    open('/home/claude/site-branch/' + dst, 'w').write(t)
    print('built', dst, len(t))

# ---- access-catalog.js: every switchable feature (tools from the hub, admin settings, dashboard tabs/filters/reports) ----
import json
H = open('/home/claude/site-branch/tools/pages/hub.src.html').read()
cats = H.split('var CATS = [')[1].split('\n  ];')[0]
groups, admin = [], []
for blk in re.finditer(r'\{ id: "([a-z]+)", icon: "([^"]+)", name: "([^"]+)"[^\[]*items: \[(.*?)\] \}', cats, re.S):
    cid, icon, name, body = blk.groups()
    items = [[ 'tool:' + m.group(1), m.group(3), m.group(5) ] for m in re.finditer(r'\["([a-z0-9]+)", "([^"]+)", "([^"]+)", (null|"[a-z]+"), "([nt]:[^"]+)"', body)]
    if not items: continue
    if cid == 'admin': admin = items
    else: groups.append({'g': icon + ' ' + name, 'k': 'tool', 'items': items})
admin.append(['tool:access', 'Access control (master)', 't:access.html'])
admin += [['adm:design', 'Design studio (themes, art, cards, tabs)', ''], ['adm:banners', 'Edit dashboard banners', ''], ['adm:affdata', 'Affordability data & AI keys', 't:affordability.html#data'], ['adm:afftpl', 'Publish offer report form', ''], ['adm:affprice', 'Set official phone prices', '']]
groups.append({'g': '🛡️ Admin settings & configuration', 'k': 'adm', 'items': admin})
groups.append({'g': '📑 Dashboard tabs', 'k': 'tab', 'items': [['tab:' + a, b, ''] for a, b in [('overview', 'Overview'), ('rank', 'Rankings'), ('trend', 'Trends'), ('app', 'Retailer app'), ('retv', 'Active retailers'), ('sd', 'Support desk'), ('plan', 'Action plan'), ('news', 'BI Newsletter'), ('creative', 'HO Creative'), ('cfg', 'Configuration'), ('rm', 'Roadmap 2027'), ('how', 'How to use'), ('kq4', 'KPI framework'), ('grw', 'Growth'), ('cmp', 'Compare'), ('onb', 'Onboarded'), ('q3', 'Q3 rankings'), ('dl', 'Get the app'), ('tl', 'Smart tools'), ('pro_ms', 'Monthly summary'), ('pro_cc', 'Command Center'), ('pro_hm', 'Heatmap Matrix'), ('pro_opp', 'Opportunity Finder'), ('pro_sim', 'Target Simulator'), ('pro_trk', 'Action Tracker'), ('pro_alr', 'Alerts & Rules'), ('pro_dq', 'Data Health'), ('pro_rep', 'Report Builder'), ('pro_studio', 'One-Page Studio'), ('pro_op', 'Monthly one-pager')]]})
groups.append({'g': '🔎 Dashboard filters', 'k': 'flt', 'items': [['flt:period', 'Period filter', ''], ['flt:range', 'Custom date range', ''], ['flt:state', 'State filter', ''], ['flt:kpi', 'KPI category filter', '']]})
groups.append({'g': '⬇️ Dashboard reports & downloads', 'k': 'rep', 'items': [['rep:export', 'Export & share menu (files for states)', ''], ['rep:excel', 'Excel downloads', ''], ['rep:png', 'Save PNG', ''], ['rep:share', 'Share card', ''], ['rep:creative', 'Creative / one-pager', ''], ['rep:import', 'Import data (admin)', ''], ['rep:leaders', 'Edit leaders (admin)', ''], ['rep:guides', 'Guides menu', '']]})
open('/home/claude/site-branch/access-catalog.js', 'w').write('// generated by tools/pages/build.py — do not edit\nwindow.BIACCESS_CAT = ' + json.dumps(groups, ensure_ascii=False) + ';\n')
print('access-catalog.js', sum(len(g['items']) for g in groups), 'features')
# ---- formula.js: the Studio formula engine for the browser, made from the server's copy (one source of truth) ----
_fx = open('/home/claude/site-branch/netlify/lib/formula-core.mjs').read()
_fx = re.sub(r'^export (const|function) ', r'\1 ', _fx, flags=re.M)
open('/home/claude/site-branch/formula.js', 'w').write('// generated by tools/pages/build.py from netlify/lib/formula-core.mjs — do not edit\n(function () {\n' + _fx + '\nwindow.BIFX = { parse: parse, compile: compile, evaluate: evaluate, test: test, truthy: truthy, refs: refs, computeAll: computeAll, FUNCTIONS: FUNCTIONS };\n})();\n')
print('formula.js', len(_fx), 'chars')
# ---- salcalc.js: salary & incentive engine for the browser, from the server's copy (one source of truth) ----
_sc = open('/home/claude/site-branch/netlify/lib/salcalc-core.mjs').read()
_names = re.findall(r'^export (?:const|function) (\w+)', _sc, re.M)
_sc = re.sub(r'^export ', '', _sc, flags=re.M)
open('/home/claude/site-branch/salcalc.js', 'w').write('// generated by tools/pages/build.py from netlify/lib/salcalc-core.mjs — do not edit\n(function () {\n' + _sc + '\nwindow.SALCALC = { ' + ', '.join(n + ': ' + n for n in _names) + ' };\n})();\n')
print('salcalc.js', len(_sc), 'chars')
# ---- guidedata.js: the user-guide entries (Tool manuals generator reads them) ----
_g = open('/home/claude/site-branch/tools/pages/guide.src.html').read()
_i = _g.index('var G = ['); _j = _g.index('\n  ];', _i)
open('/home/claude/site-branch/guidedata.js', 'w').write('// generated by tools/pages/build.py from guide.src.html — do not edit\n// [id, cat, icon, name, who, what, steps[], example, tips[], open target]\nwindow.BIGUIDE = ' + _g[_i + 8:_j + 4].strip() + ';\n')
print('guidedata.js', _j - _i, 'chars')
# ---- appfeats.js: the vivo Retailer app features listed on the dashboard (Tool manuals can document each one) ----
_ix = open('/home/claude/site-branch/index.html').read()
_af = _ix.split('const APP_FEATS = [', 1)[1].split('];', 1)[0]
_feats = [[m.group(1), m.group(2), m.group(3)] for m in re.finditer(r"\['([a-z0-9]+)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\]", _af)]
open('/home/claude/site-branch/appfeats.js', 'w').write('// generated by tools/pages/build.py from index.html (APP_FEATS) — do not edit\nwindow.BIAPPFEATS = ' + json.dumps(_feats, ensure_ascii=False) + ';\n')
print('appfeats.js', len(_feats), 'features')

# Shop Khata UI strings (whitelist for the Hindi / Hinglish switch — only these are ever translated, never names or data)
import re as _re, json as _json
_src = open('/home/claude/site-branch/tools/pages/khata.src.html').read()
_js = _src[_src.index('<script>'):]
for _a, _b in [('var SAMPLE = {', '  function samples()'), ('var ALIAS = {', 'var UNITW'), ('window.KH_CAT', '\n')]:
    if _a in _js: _i = _js.index(_a); _j = _js.index(_b, _i); _js = _js[:_i] + _js[_j:]
_out = set()
def _lits(code):   # string literals of a JS source (skips comments and regex literals)
    i, n, prev = 0, len(code), ''
    while i < n:
        c = code[i]
        if c in '"\'`':
            q, j, buf = c, i + 1, []
            while j < n and code[j] != q:
                if code[j] == '\\' and j + 1 < n: buf.append(code[j:j + 2]); j += 2; continue
                buf.append(code[j]); j += 1
            yield ''.join(buf); i = j + 1; prev = 'x'; continue
        if c == '/' and i + 1 < n and code[i + 1] == '/': j = code.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and i + 1 < n and code[i + 1] == '*': j = code.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        if c == '/' and prev in '(,=:[!&|?{};+-*%<>~^' :
            j, cls = i + 1, False
            while j < n and code[j] != '\n':
                if code[j] == '\\': j += 2; continue
                if code[j] == '[': cls = True
                elif code[j] == ']': cls = False
                elif code[j] == '/' and not cls: break
                j += 1
            i = j + 1; prev = 'x'; continue
        if not c.isspace(): prev = c
        i += 1
for _raw in _lits(_js):
    if len(_raw) < 2 or len(_raw) > 400 or '\n' in _raw: continue
    _lit = _raw.replace('\\"', '"').replace("\\'", "'").replace('\\n', ' ')
    for _piece in _re.split(r'<[^>]*>|\{name\}', _lit):
        _p = _re.sub(r'\s+', ' ', _piece).strip(' ·—:|,.()')
        _p = _re.sub(r'₹?\d[\d,]*(?:\.\d+)?', '{#}', _p).strip()
        if len(_p) < 2 or not _re.search(r'[A-Za-z]{2}', _p): continue
        if _re.search(r"' \+|\+ '|\" \+|\+ \"|^[>\"'#]|[<>]", _p): continue
        if _re.search(r"^[+&|?:]|[+&|?]$|\b(esc|rs|rs2|dt|dS|qf|num|pname)\(|\w\.\w+\s*[?(]|&&|\|\||\? \(|\) \+", _p): continue
        if _re.search(r'[=;{}\[\]\\]|function|return|var |\.\w+\(|^[a-z0-9_\-]+$|^[#.\w-]+:|https?:|/api|data:|^\w+\(|px\b|rgba?\(|var\(--|^[a-z]+[A-Z]\w*$', _p.replace('{#}', '')): continue
        if _re.match(r'^[a-z][a-z0-9\-]*( [a-z][a-z0-9\-]*)?$', _p) and len(_p) < 14 and ' ' not in _p: continue
        _out.add(_p[:300])
open('/home/claude/site-branch/khata-strings.js', 'w').write('// Shop Khata UI strings (generated by tools/pages/build.py — do not edit)\nwindow.KH_STR=' + _json.dumps(sorted(_out), ensure_ascii=False) + ';\n')
print('khata strings', len(_out))
