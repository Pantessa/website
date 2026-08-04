#!/usr/bin/env python3
"""One-shot Yeetful -> Pantessa display-string sweep. Infrastructure stays:
domains, env names, identifiers, DB slugs, repo paths, npm package refs,
and paid-catalog service names ("Yeetful · Claude"). Dry run by default;
pass --apply to write."""
import re, subprocess, sys, unicodedata

APPLY = '--apply' in sys.argv
WORD = re.compile(r'[A-Za-z0-9_]')
CATALOG_VENDORS = ('Claude', 'GPT', 'Snapshot', 'Nansen', 'House')

files = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split()

def skip_file(p):
    if '/' not in p and p.endswith('.md'):
        return True  # root-level internal docs, not the website
    if p.startswith(('archive/', '.claude/')):
        return True
    if p.endswith(('.png', '.jpg', '.jpeg', '.ico', '.woff', '.woff2', '.webp', '.pdf', '.zip')):
        return True
    return False

pat = re.compile(r'yeetful', re.IGNORECASE)
changed_files = 0
kept_log, changed_log = [], []

for path in files:
    if skip_file(path):
        continue
    try:
        text = open(path, encoding='utf-8').read()
    except (UnicodeDecodeError, FileNotFoundError):
        continue
    out = []
    last = 0
    dirty = False
    for m in pat.finditer(text):
        s, e = m.span()
        tok = m.group(0)
        pre = text[s - 1] if s > 0 else ''
        post = text[e] if e < len(text) else ''
        keep = False
        # domains: yeetful.com, *-mcp.yeetful.com, also yeetful.vercel.app
        if text[e:e + 4] == '.com' or text[e:e + 7] == '.vercel':
            keep = True
        # glued to identifier chars: useYeetfulStore, YEETFUL_, yeetful_ai...
        elif WORD.match(pre or ' ') or WORD.match(post or ' '):
            keep = True
        # repo paths github.com/Yeetful, Yeetful/free-mcps
        elif post == '/' or pre == '/':
            keep = True
        # lowercase = npm package name, SDK function, slugs, hostnames — keep ALL
        # except the styled brand wordmark rendered as a text node (>yeetful<),
        # which is display. Code/mono/npm contexts are package refs even there.
        elif tok == 'yeetful':
            ctx = text[max(0, s - 70):s]
            wordmark = (pre == '>' or post == '<') and not any(
                k in ctx for k in ('<code', 'npm i', 'npm install', '"mono"', "'mono'"))
            if not wordmark:
                keep = True
        # paid-catalog service names "Yeetful · Vendor" (DB/marketplace entries)
        elif text[e:e + 3] == ' · ' and text[e + 3:].lstrip('*').startswith(CATALOG_VENDORS):
            keep = True
        if keep:
            kept_log.append(f'{path}: ...{text[max(0,s-30):e+30]!r}...')
            continue
        repl = {'Yeetful': 'Pantessa', 'yeetful': 'pantessa', 'YEETFUL': 'PANTESSA'}.get(tok)
        if repl is None:  # mixed-case oddity: normalize by first char
            repl = 'Pantessa' if tok[0] == 'Y' else 'pantessa'
        changed_log.append(f'{path}: ...{text[max(0,s-30):e+30]!r}... -> {repl}')
        out.append(text[last:s]); out.append(repl); last = e
        dirty = True
    if dirty:
        out.append(text[last:])
        if APPLY:
            open(path, 'w', encoding='utf-8').write(''.join(out))
        changed_files += 1

print(f'files touched: {changed_files}')
print(f'occurrences changed: {len(changed_log)}')
print(f'occurrences kept: {len(kept_log)}')
with open('/tmp/rebrand-changed.log', 'w') as f: f.write('\n'.join(changed_log))
with open('/tmp/rebrand-kept.log', 'w') as f: f.write('\n'.join(kept_log))
print('logs: /tmp/rebrand-changed.log /tmp/rebrand-kept.log')
