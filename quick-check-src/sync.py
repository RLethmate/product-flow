#!/usr/bin/env python3
"""Erzeugt aus der einen Quelle die beiden Deployments.

Quelle:
    app/index.html      Markup und CSS, mit den Platzhaltern
                        <!--QC_CONFIG--> und <!--QC_APP-->
    app/app.js          gemeinsame Logik für beide Modi
    app/config.solo.js  Konfiguration Einzelmodus
    app/config.team.js  Konfiguration Teammodus

Ziele:
    ../static/quick-check/index.html          Einzelmodus, GitHub Pages
    server/public/quick-check/index.html      Teammodus, eigener Server
    server/public/fonts, server/public/images Marken-Assets für den Teammodus

Beide Ziele sind selbstenthaltene Einzeldateien: Konfiguration und Logik werden
eingesetzt, nicht nachgeladen. Änderungen gehören immer in app/, niemals in die
erzeugten Dateien.

Aufruf:  python3 sync.py
"""

import shutil
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent
REPO = SRC.parent

APP_DIR = SRC / "app"
TEMPLATE = APP_DIR / "index.html"
APP_JS = APP_DIR / "app.js"

FONTS = ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf",
         "SourceSans3-Regular.ttf", "SourceSans3-Bold.ttf"]

TARGETS = [
    ("solo", REPO / "static" / "quick-check" / "index.html"),
    ("team", SRC / "server" / "public" / "quick-check" / "index.html"),
]


def script_block(code, label):
    """Verpackt JavaScript in ein script-Element.

    '</script' im Code würde das Element vorzeitig beenden, deshalb wird die
    Sequenz maskiert. Für den JavaScript-Parser ist das gleichwertig.
    """
    safe = code.replace("</script", "<\\/script")
    return "  <!-- %s -->\n  <script>\n%s\n  </script>" % (label, safe)


def build(mode):
    template = TEMPLATE.read_text(encoding="utf8")
    config = (APP_DIR / ("config.%s.js" % mode)).read_text(encoding="utf8")
    app = APP_JS.read_text(encoding="utf8")

    for placeholder in ("<!--QC_CONFIG-->", "<!--QC_APP-->"):
        if placeholder not in template:
            sys.exit("Platzhalter %s fehlt in %s" % (placeholder, TEMPLATE))

    out = template.replace("<!--QC_CONFIG-->", script_block(config, "Konfiguration: %s" % mode))
    out = out.replace("<!--QC_APP-->", script_block(app, "Anwendungslogik"))

    banner = ("<!-- ERZEUGT von quick-check-src/sync.py (Modus: %s). "
              "Nicht direkt bearbeiten, sondern quick-check-src/app/. -->\n" % mode)
    return banner + out


def main():
    for mode, target in TARGETS:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(build(mode), encoding="utf8")
        print("geschrieben: %s (%d Zeilen)" %
              (target.relative_to(REPO), build(mode).count("\n") + 1))

    # Marken-Assets für den Teammodus. Im Einzelmodus liegen sie schon unter
    # /fonts und /images, weil die Seite Teil der Hugo-Site ist.
    pub = SRC / "server" / "public"
    (pub / "fonts").mkdir(parents=True, exist_ok=True)
    (pub / "images").mkdir(parents=True, exist_ok=True)

    for name in FONTS:
        src = REPO / "static" / "fonts" / name
        if src.exists():
            shutil.copy2(src, pub / "fonts" / name)
        else:
            print("  Hinweis: Schrift fehlt, übersprungen: %s" % name)

    favicon = REPO / "static" / "images" / "favicon.png"
    if favicon.exists():
        shutil.copy2(favicon, pub / "images" / "favicon.png")

    print("Assets für den Teammodus aktualisiert:", pub.relative_to(REPO))


if __name__ == "__main__":
    main()
