import sys, re
S = open('/home/claude/site-branch/survey.html').read()
css = S.split('<style>')[1].split('</style>')[0]
lines = S.split('\n')
core = '\n'.join(lines[203:366]) + '\n' + lines[491] + '\n' + '\n'.join(lines[493:505])
assert core.strip().startswith('var $') and 'function sheet(' in core and core.rstrip().endswith('}'), core[-200:]
for src, dst in [('chat.src.html', 'chat.html'), ('matrix.src.html', 'matrix.html'), ('security.src.html', 'security.html'), ('directory.src.html', 'directory.html'), ('visits.src.html', 'visits.html'), ('knowledge.src.html', 'knowledge.html'), ('affordability.src.html', 'affordability.html'), ('hub.src.html', 'hub.html'), ('reports.src.html', 'reports.html'), ('help.src.html', 'help.html'), ('disputes.src.html', 'disputes.html'), ('hygiene.src.html', 'hygiene.html'), ('engage.src.html', 'engage.html'), ('schemes.src.html', 'schemes.html'), ('admin-tools.src.html', 'admin-tools.html'), ('invite.src.html', 'invite.html'), ('tool.src.html', 'tool.html'), ('studio.src.html', 'studio.html'), ('fieldnotes.src.html', 'fieldnotes.html'), ('toolactivity.src.html', 'toolactivity.html'), ('schemecalc.src.html', 'schemecalc.html'), ('mailer.src.html', 'mailer.html'), ('config.src.html', 'config.html'), ('hygcheck.src.html', 'hygcheck.html'), ('sheetjoin.src.html', 'sheetjoin.html'), ('targetsplit.src.html', 'targetsplit.html'), ('guide.src.html', 'guide.html'), ('statemap.src.html', 'statemap.html'), ('faces.src.html', 'faces.html'), ('reviewdeck.src.html', 'reviewdeck.html'), ('insights.src.html', 'insights.html'), ('business.src.html', 'business.html'), ('calendar.src.html', 'calendar.html'), ('myday.src.html', 'myday.html'), ('access.src.html', 'access.html'), ('deckstudio.src.html', 'deckstudio.html'), ('pmail.src.html', 'pmail.html'), ('applab.src.html', 'applab.html'), ('portals.src.html', 'portals.html'), ('rewards.src.html', 'rewards.html'), ('newsletter.src.html', 'newsletter.html'), ('appguide.src.html', 'appguide.html'), ('geolocate.src.html', 'geolocate.html')]:
    try: t = open('/home/claude/site-branch/tools/pages/' + src).read()
    except FileNotFoundError: continue
    t = t.replace('/*@@CSS@@*/', css).replace('  /*@@CORE@@*/', core)
    if 'theme.js' not in t: t = t.replace('</head>', '<script src="theme.js?v=6"></script>\n</head>', 1)
    if 'lang.js' not in t: t = t.replace('</head>', '<script src="lang.js?v=3" defer></script>\n</head>', 1)
    if 'access.js' not in t and dst != 'invite.html': t = t.replace('</head>', '<script src="access.js?v=1"></script>\n</head>', 1)
    if 'cust.js' not in t and dst != 'invite.html': t = t.replace('</head>', '<script src="cust.js?v=64"></script>\n</head>', 1)
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
groups.append({'g': '📑 Dashboard tabs', 'k': 'tab', 'items': [['tab:' + a, b, ''] for a, b in [('overview', 'Overview'), ('rank', 'Rankings'), ('trend', 'Trends'), ('app', 'Retailer app'), ('retv', 'Active retailers'), ('sd', 'Support desk'), ('plan', 'Action plan'), ('news', 'BI Newsletter'), ('creative', 'HO Creative'), ('cfg', 'Configuration'), ('rm', 'Roadmap 2027'), ('how', 'How to use'), ('kq4', 'KPI framework'), ('grw', 'Growth'), ('cmp', 'Compare'), ('onb', 'Onboarded'), ('q3', 'Q3 rankings'), ('dl', 'Get the app'), ('tl', 'Smart tools')]]})
groups.append({'g': '🔎 Dashboard filters', 'k': 'flt', 'items': [['flt:period', 'Period filter', ''], ['flt:range', 'Custom date range', ''], ['flt:state', 'State filter', ''], ['flt:kpi', 'KPI category filter', '']]})
groups.append({'g': '⬇️ Dashboard reports & downloads', 'k': 'rep', 'items': [['rep:export', 'Export & share menu (files for states)', ''], ['rep:excel', 'Excel downloads', ''], ['rep:png', 'Save PNG', ''], ['rep:share', 'Share card', ''], ['rep:creative', 'Creative / one-pager', ''], ['rep:import', 'Import data (admin)', ''], ['rep:leaders', 'Edit leaders (admin)', ''], ['rep:guides', 'Guides menu', '']]})
open('/home/claude/site-branch/access-catalog.js', 'w').write('// generated by tools/pages/build.py — do not edit\nwindow.BIACCESS_CAT = ' + json.dumps(groups, ensure_ascii=False) + ';\n')
print('access-catalog.js', sum(len(g['items']) for g in groups), 'features')
