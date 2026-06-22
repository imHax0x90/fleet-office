"""Récupère des modèles de gym (GLB) depuis Poly Pizza + leurs licences.

Usage: .venv/bin/python tools/scrape_gym_assets.py

Sort les .glb dans public/vendor/models/ext/ et un CREDITS.json (titre/auteur/licence/url).
Les assets seront ensuite NORMALISÉS via Blender (échelle/pivot) avant usage.
"""
from __future__ import annotations
import json
import pathlib
import re
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "vendor" / "models" / "ext"
OUT.mkdir(parents=True, exist_ok=True)

# terme de recherche -> nom de fichier cible
TERMS = {
    "treadmill": "treadmill",
    "bench press": "bench",
    "kettlebell": "kettlebell",
    "dumbbell": "dumbbell",
    "barbell": "barbell",
    "squat rack": "squat_rack",
}


def grab(page, term, fname, credits):
    # 1) recherche -> 1er modèle
    page.goto(f"https://poly.pizza/search/{term.replace(' ', '%20')}", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(3500)
    link = None
    for a in page.query_selector_all("a[href^='/m/']"):
        href = a.get_attribute("href")
        if href:
            link = "https://poly.pizza" + href
            break
    if not link:
        print(f"[{term}] aucun modèle trouvé"); return
    # 2) page modèle -> <model-viewer src=".../<uuid>.glb.br">
    page.goto(link, wait_until="networkidle", timeout=45000)
    page.wait_for_timeout(1500)
    src = None
    mv = page.query_selector("model-viewer")
    if mv:
        src = mv.get_attribute("src")
    if not src:
        print(f"[{term}] pas de model-viewer src (page {link})"); return
    title = (page.title() or fname).split("-")[0].split("|")[0].strip()
    body_txt = page.inner_text("body")[:4000]
    m = re.search(r"(CC0|CC-?BY(?:-[A-Z]{2})*|Creative Commons[^\n]*|Public Domain)", body_txt, re.I)
    lic = m.group(1) if m else "?"
    ma = re.search(r"[Bb]y\s+([A-Za-z0-9 _.\-]{2,40})", body_txt)
    author = ma.group(1).strip() if ma else "?"
    credits[fname] = {"title": title, "author": author, "license": lic, "source": link, "glb": src}
    print(f"[{term}] src OK · {lic} · {author} · {src}")


def main():
    credits = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36")
        for term, fname in TERMS.items():
            page = ctx.new_page()
            try:
                grab(page, term, fname, credits)
            except Exception as e:
                print(f"[{term}] ERREUR: {str(e)[:200]}")
            finally:
                page.close()
            time.sleep(1)
        browser.close()
    # 3) téléchargement hors navigateur : le serveur renvoie le GLB décompressé
    #    si on n'annonce pas Accept-Encoding: br (referer requis).
    ok = 0
    for fname, info in credits.items():
        try:
            req = urllib.request.Request(info["glb"], headers={
                "User-Agent": "Mozilla/5.0", "Referer": "https://poly.pizza/", "Accept-Encoding": "identity",
            })
            data = urllib.request.urlopen(req, timeout=40).read()
            if data[:4] != b"glTF":
                print(f"[{fname}] téléchargé mais pas un GLB (magic {data[:4]!r})"); continue
            (OUT / f"{fname}.glb").write_bytes(data)
            info["bytes"] = len(data)
            ok += 1
            print(f"[{fname}] GLB {len(data)} o")
        except Exception as e:
            print(f"[{fname}] download KO: {str(e)[:160]}")
    (OUT / "CREDITS.json").write_text(json.dumps(credits, indent=2, ensure_ascii=False))
    print(f"\n{ok}/{len(credits)} GLB téléchargés -> {OUT}")


if __name__ == "__main__":
    main()
