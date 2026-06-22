#!/usr/bin/env python3
"""Recherche via scrapling des skills/MCP pertinents pour un métier, écrit un rapport markdown.
Usage: python scrape_skills.py "<role>" "<outfile.md>"
"""
import sys, json, datetime
from scrapling.fetchers import Fetcher

role = (sys.argv[1] if len(sys.argv) > 1 else "developer").strip()
out = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/skills_{role}.md"

queries = [f"{role} mcp server", f"{role} claude skill", f"{role} agent tool"]
seen = {}
for q in queries:
    url = "https://api.github.com/search/repositories?q=" + q.replace(" ", "+") + "&sort=stars&per_page=6"
    try:
        p = Fetcher.get(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "fleet-office"})
        j = json.loads(getattr(p, "body", "") or "{}")
        for it in j.get("items", []):
            fn = it.get("full_name")
            if fn and fn not in seen:
                seen[fn] = {"name": fn, "desc": (it.get("description") or "").replace("\n", " ")[:150],
                            "url": it.get("html_url"), "stars": it.get("stargazers_count", 0)}
    except Exception as e:
        sys.stderr.write(f"warn {q}: {e}\n")

items = sorted(seen.values(), key=lambda x: -x["stars"])[:12]
lines = [f"# Skills & MCP suggérés — métier : {role}",
         f"_Recherché via scrapling (GitHub) le {datetime.datetime.now():%Y-%m-%d %H:%M}._",
         "", "À évaluer puis, si pertinent, proposer l'installation :", ""]
for it in items:
    lines.append(f"- **{it['name']}** ⭐{it['stars']} — {it['desc']}")
    lines.append(f"  {it['url']}")
if not items:
    lines.append("_(aucun résultat)_")
open(out, "w").write("\n".join(lines) + "\n")
print(f"WROTE {len(items)} -> {out}")
