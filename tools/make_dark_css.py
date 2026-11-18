"""Builds assets/dark.css from assets/app.css.

Every rule in app.css that uses a hard-coded colour gets a dark-mode twin under
html[data-theme="dark"], with light backgrounds turned dark and dark text turned light
(same hue). The colour variables are overridden by hand at the top.
Run again after changing app.css:   python tools/make_dark_css.py
"""
import colorsys, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = (ROOT / 'assets' / 'app.css').read_text(encoding='utf-8')
P = 'html[data-theme="dark"]'
W = ':where(html[data-theme="dark"])'      # zero specificity: the twin rules keep app.css's own order of priority

VARS = """{P}{color-scheme:dark;
  --bg:#0f1420; --card:#171e2c; --ink:#e6eaf2; --muted:#9aa5b8; --line:#2a3447;
  --brand:#2c5fa6; --brand-dk:#3a70bd; --brand-lt:#1c2a42;
  --nv:#2a3242; --nv-ink:#c9d0dc;
  --na:#e5615a; --an:#33a866; --mr:#8b63d6;
  --warn:#e09b1a; --danger:#e0524a;
  --ok-bg:#15301f; --bad-bg:#3a1c1b; --neu-bg:#1d2433; --amb-bg:#3a2e12;
}
{W} .q-text img,{W} .ot img,{W} .st img,{W} .card img{background:#fff;border-radius:6px}
{W} input,{W} select,{W} textarea{background:#0f1522;color:var(--ink)}
{W} ::placeholder{color:#6b778c}
""".replace('{P}', P).replace('{W}', W)

VAR_TEXT = {'--brand': '#8fb8ef', '--brand-dk': '#a9c8f3', '--mr': '#b79af0', '--an': '#5fd08f',
            '--na': '#f08a84', '--danger': '#f08a84', '--warn': '#f2b54a'}
VAR_TEXT_RE = re.compile(r'var\((--brand-dk|--brand|--mr|--an|--na|--danger|--warn)\)')
HEX = re.compile(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b')


def to_rgb(h):
    h = h if len(h) == 6 else ''.join(c * 2 for c in h)
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def hexs(r, g, b):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v * 255))) for v in (r, g, b))


def conv(h, kind):
    r, g, b = to_rgb(h)
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    if kind == 'bg':
        if l < 0.62:
            return None                              # already a strong colour (buttons etc.)
        l2, s2 = 0.13 + (1 - l) * 0.9, s * 0.45
        if s < 0.15:
            hh, s2 = 0.61, 0.3                       # greys/white -> the blue-grey card colour
    elif kind == 'line':
        if l < 0.55:
            return None
        l2, s2 = 0.22 + (1 - l) * 0.8, s * 0.4
        if s < 0.15:
            hh, s2 = 0.61, 0.25
    else:                                            # text
        if l > 0.5 or (s > 0.35 and l > 0.32):
            l2 = max(l, 0.62) if s > 0.35 else None
            if l2 is None or l2 == l:
                return None
            s2 = s
        else:
            l2, s2 = 0.92 - l * 0.6, s * 0.8
    return hexs(*colorsys.hls_to_rgb(hh, l2, min(s2, 1)))


def kind_of(prop):
    if prop in ('color', 'fill', 'caret-color'):
        return 'text'
    if prop.startswith('background') or prop in ('box-shadow',):
        return 'bg'
    if prop.startswith('border') or prop.startswith('outline'):
        return 'line'
    return None


def rules(css):
    """yield (media_or_None, selector, body) for plain rules"""
    i, n, media = 0, len(css), []
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    n = len(css)
    while i < n:
        j = css.find('{', i)
        k = css.find('}', i)
        if k != -1 and (j == -1 or k < j):
            if media:
                media.pop()
            i = k + 1
            continue
        if j == -1:
            break
        sel = css[i:j].strip()
        if sel.startswith('@media') or sel.startswith('@supports'):
            media.append(sel); i = j + 1; continue
        if sel.startswith('@keyframes') or sel.startswith('@font-face'):
            depth, p = 1, j + 1
            while depth and p < n:
                depth += {'{': 1, '}': -1}.get(css[p], 0); p += 1
            i = p; continue
        e = css.find('}', j)
        yield (media[-1] if media else None), sel, css[j + 1:e]
        i = e + 1


out = [VARS]
for media, sel, body in rules(SRC):
    if media and ('print' in media or 'prefers-color-scheme' in media):
        continue
    decls = []
    for d in body.split(';'):
        if ':' not in d:
            continue
        prop, val = d.split(':', 1)
        prop = prop.strip().lower()
        kd = kind_of(prop)
        if kd == 'text' and VAR_TEXT_RE.search(val):        # brand-coloured text -> a brighter shade
            decls.append('%s:%s' % (prop, VAR_TEXT_RE.sub(lambda m: VAR_TEXT[m.group(1)], val.strip())))
            continue
        if kd == 'line' and 'var(--brand)' in val:
            decls.append('%s:%s' % (prop, val.strip().replace('var(--brand)', '#4f86d0')))
            continue
        if not kd or not HEX.search(val):
            continue
        changed = [False]

        def sub(m, kd=kd):
            c = conv(m.group(1), kd)
            if c:
                changed[0] = True
                return c
            return m.group(0)
        v2 = HEX.sub(sub, val.strip())
        if changed[0]:
            decls.append('%s:%s' % (prop, v2))
    if not decls:
        continue
    sels = ','.join('%s %s' % (W, s.strip()) for s in sel.split(','))
    line = '%s{%s}' % (sels, ';'.join(decls))
    out.append('%s{%s}' % (media, line) if media else line)

(ROOT / 'assets' / 'dark.css').write_text(
    '/* AUTO-GENERATED by tools/make_dark_css.py from app.css — do not edit by hand */\n' + '\n'.join(out) + '\n',
    encoding='utf-8')
print('dark.css:', len(out), 'rules')
