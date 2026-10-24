import sys, re
S = open('/home/claude/site-branch/survey.html').read()
css = S.split('<style>')[1].split('</style>')[0]
lines = S.split('\n')
core = '\n'.join(lines[203:366]) + '\n' + lines[491] + '\n' + '\n'.join(lines[493:505])
assert core.strip().startswith('var $') and 'function sheet(' in core and core.rstrip().endswith('}'), core[-200:]
for src, dst in [('chat.src.html', 'chat.html'), ('matrix.src.html', 'matrix.html'), ('security.src.html', 'security.html'), ('directory.src.html', 'directory.html'), ('visits.src.html', 'visits.html'), ('knowledge.src.html', 'knowledge.html'), ('affordability.src.html', 'affordability.html'), ('hub.src.html', 'hub.html'), ('reports.src.html', 'reports.html'), ('help.src.html', 'help.html'), ('disputes.src.html', 'disputes.html'), ('hygiene.src.html', 'hygiene.html'), ('engage.src.html', 'engage.html'), ('schemes.src.html', 'schemes.html'), ('admin-tools.src.html', 'admin-tools.html'), ('invite.src.html', 'invite.html'), ('tool.src.html', 'tool.html'), ('studio.src.html', 'studio.html')]:
    try: t = open('/home/claude/site-branch/tools/pages/' + src).read()
    except FileNotFoundError: continue
    t = t.replace('/*@@CSS@@*/', css).replace('  /*@@CORE@@*/', core)
    if 'cust.js' not in t and dst != 'invite.html': t = t.replace('</head>', '<script src="cust.js?v=63"></script>\n</head>', 1)
    open('/home/claude/site-branch/' + dst, 'w').write(t)
    print('built', dst, len(t))
