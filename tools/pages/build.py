import sys, re
S = open('/home/claude/site-branch/survey.html').read()
css = S.split('<style>')[1].split('</style>')[0]
lines = S.split('\n')
core = '\n'.join(lines[203:366]) + '\n' + lines[491] + '\n' + '\n'.join(lines[493:505])
assert core.strip().startswith('var $') and 'function sheet(' in core and core.rstrip().endswith('}'), core[-200:]
for src, dst in [('chat.src.html', 'chat.html'), ('matrix.src.html', 'matrix.html'), ('security.src.html', 'security.html'), ('directory.src.html', 'directory.html')]:
    try: t = open('/home/claude/site-branch/tools/pages/' + src).read()
    except FileNotFoundError: continue
    t = t.replace('/*@@CSS@@*/', css).replace('  /*@@CORE@@*/', core)
    open('/home/claude/site-branch/' + dst, 'w').write(t)
    print('built', dst, len(t))
