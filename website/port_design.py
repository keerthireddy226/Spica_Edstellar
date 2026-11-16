"""Ports ~/Downloads/spica 2.html into the Next.js website as the Home page.
Writes: website/app/home.css (all selectors scoped to .sd, dark theme removed,
site fonts), website/lib/homeMarkup.ts (body markup), website/public/home.js
(the design's script, run once per visit to Home)."""
import json
import os
import re

SRC = os.path.expanduser("~/Downloads/spica 2.html")
W = os.path.dirname(os.path.abspath(__file__))
s = open(SRC, encoding="utf-8").read()

css = re.findall(r"<style[^>]*>(.*?)</style>", s, re.S)[0]
scripts = re.findall(r"<script([^>]*)>(.*?)</script>", s, re.S)
main_js = scripts[2][1]
body = s[s.find("<body"):]
body = body[body.find(">") + 1 : body.rfind("</body>")]


def scope_selector(sel: str) -> str:
    sel = sel.strip()
    if not sel:
        return sel
    if sel.startswith(":root[data-theme"):
        return None
    for root in (":root", "html, body", "html", "body"):
        if sel == root:
            return ".sd"
    if sel.startswith("body::") or sel.startswith("body:"):
        return ".sd" + sel[4:]
    if sel == "*" or sel.startswith("*,") or sel.startswith("*::"):
        return ".sd " + sel
    m = re.match(r"^\.(anim|io)\b(.*)$", sel)
    if m:
        return f".sd.{m.group(1)}{m.group(2)}"
    return ".sd " + sel


def scope_rules(block: str) -> str:
    out = []
    i = 0
    while i < len(block):
        j = block.find("{", i)
        if j == -1:
            out.append(block[i:])
            break
        head = block[i:j].strip()
        # find matching brace
        depth, k = 1, j + 1
        while depth and k < len(block):
            if block[k] == "{":
                depth += 1
            elif block[k] == "}":
                depth -= 1
            k += 1
        inner = block[j + 1 : k - 1]
        if head.startswith("@keyframes"):
            out.append(f"{head}{{{inner}}}\n")
        elif head.startswith("@media"):
            if "prefers-color-scheme: dark" in head:
                pass
            else:
                out.append(f"{head}{{{scope_rules(inner)}}}\n")
        else:
            sels = [scope_selector(x) for x in head.split(",")]
            if all(x is None for x in sels):
                pass
            else:
                sels = [x for x in sels if x]
                out.append(f"{', '.join(sels)}{{{inner}}}\n")
        i = k
    return "".join(out)


css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
scoped = scope_rules(css)
# Site fonts (self-hosted by next/font) instead of Google Fonts.
scoped = scoped.replace('--display: "Outfit",', "--display: var(--font-display), \"Outfit\",")
scoped = scoped.replace('--body: "Inter",', "--body: var(--font-body), \"Inter\",")
scoped = scoped.replace('--logo: "Playfair Display",', "--logo: var(--font-logo), \"Playfair Display\",")
scoped = "/* Generated from spica 2.html by port_design.py. Every rule is scoped to .sd (the Home page). */\n" + scoped
scoped += """
/* Added for the Spica site: sign-in link, paired buttons, no gap above the site footer. */
.sd .bar-right{ display: inline-flex; align-items: center; gap: 18px; flex-wrap: wrap; justify-content: flex-end; }
.sd .signin-link{ color: var(--on-band, #fff); text-decoration: none; font-weight: 500; font-size: 15px; opacity: .92; }
.sd .signin-link:hover{ opacity: 1; text-decoration: underline; }
main:has(.sd) + .site .site-footer{ margin-top: 0; }
@media (max-width: 720px){ .sd .signin-link{ display: none; } }
"""
open(f"{W}/app/home.css", "w").write(scoped)

# ---- markup
APP = "https://spica-edstellar-kohl.vercel.app"
body = re.sub(r"<script[^>]*>.*?</script>", "", body, flags=re.S)
body = re.sub(r"<footer.*?</footer>", "", body, flags=re.S)
# Sign in next to the demo button in the top bar.
body = body.replace(
    '<a class="btn light small" href="#demo">Book a free demo</a>\n    </div>',
    '<span class="bar-right"><a class="signin-link" href="__APP__/learner/login">Sign in</a><a class="btn light small" href="#demo">Book a free demo</a></span>\n    </div>',
    1,
)
body = body.replace('<a class="btn ghost" href="#reports">See a sample report</a>', '<a class="btn ghost" href="__APP__/sample-report?test=speakingListening">See a sample report</a>')
body = body.replace('<a class="btn light small" href="#demo">Ask about plans</a>', '<span class="bar-right"><a class="btn light small" href="/pricing">See all prices</a><a class="btn light small" href="#demo">Ask about plans</a></span>')
# One card per level test (A1 to C2) instead of a single "Level tests, A1 to C2" card.
LEVELS = [
    ("A1", "Beginner", "Checking the basics: simple everyday phrases and questions"),
    ("A2", "Elementary", "Checking routine tasks and simple exchanges at work"),
    ("B1", "Intermediate", "Checking independent English for work and travel"),
    ("B2", "Upper intermediate", "Checking fluent English for most work roles"),
    ("C1", "Advanced", "Checking advanced English for demanding, senior roles"),
    ("C2", "Proficient", "Checking near-expert English for specialist roles"),
]
m = re.search(r'<article class="test lvltest">.*?</article>', body, re.S)
if m:
    card = m.group(0)
    cards = []
    for code, name, good in LEVELS:
        c = card.replace("<h3>Level tests, A1 to C2</h3>", f"<h3>{code} level test</h3>")
        c = c.replace('<p class="gf">One chosen level, about 28 questions</p>', f'<p class="gf">{name} · 28 questions, all at {code}</p>')
        c = c.replace("<b>Good for</b>Checking whether someone has reached a level", f"<b>Good for</b>{good}")
        cards.append(c)
    body = body.replace(card, "\n      ".join(cards), 1)
body = body.replace("__APP__", APP)
open(f"{W}/lib/homeMarkup.ts", "w").write("// Generated from spica 2.html by port_design.py. Edit the design or the script, then run it again.\nexport const HOME_MARKUP = " + json.dumps(body) + ";\n")

# ---- script: run once per visit; classes on the page wrapper instead of <html>; endpoint from a setting.
js = main_js.replace("var root = document.documentElement;", 'var root = document.querySelector(".sd");').replace('var FORM_ENDPOINT = ""; // TODO: CRM endpoint (POST FormData)', 'var FORM_ENDPOINT = window.SPICA_FORM_ENDPOINT || ""; // Edstellar form system (POST FormData); set NEXT_PUBLIC_FORM_ENDPOINT')
wrapper = """window.__spicaHome = function () {
  var root = document.querySelector(".sd");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "1";
  var motionOK = !window.matchMedia || !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (motionOK) root.classList.add("anim");
  if (motionOK && "IntersectionObserver" in window) root.classList.add("io");
""" + js + "\n};\n"
open(f"{W}/public/home.js", "w").write(wrapper)
print("css", len(scoped), "markup", len(body), "js", len(wrapper))
print("FORM_ENDPOINT hooked:", "SPICA_FORM_ENDPOINT" in wrapper, "| sign-in added:", "signin-link" in body)
