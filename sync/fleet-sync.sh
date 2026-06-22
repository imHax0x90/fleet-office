#!/usr/bin/env bash
# fleet-sync.sh — rapatrie dans la session courante les échanges faits depuis un AUTRE appareil
# (tel/iPad/web) via Fleet Office. Lit le journal ~/.fleet/sync/<sid>.jsonl (écrit par
# l'orchestrateur) + le transcript de la session, et ressort les échanges non encore synchronisés.
# Résolution de la session : argument explicite > $CLAUDE_CODE_SESSION_ID (session courante) >
# .jsonl le plus récent du dossier courant (fallback).
# Usage : fleet-sync.sh [sessionId|préfixe]
set -uo pipefail
ARG="${1:-}"
CWD="$(pwd)"
python3 - "$ARG" "$CWD" <<'PY'
import sys, os, json, glob, re, time

arg = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
cwd = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
envsid = os.environ.get("CLAUDE_CODE_SESSION_ID", "").strip()
home = os.path.expanduser("~")
projects = os.path.join(home, ".claude", "projects")
syncdir = os.path.join(home, ".fleet", "sync")

def enc(p):  # encodage Claude Code du cwd en nom de dossier projet
    return re.sub(r'[/.]', '-', p)

# --- résolution session + transcript ---
transcript = None
sid = None
if arg:  # 1) argument explicite (préfixe)
    hits = glob.glob(os.path.join(projects, "*", arg + "*.jsonl"))
    if hits:
        transcript = max(hits, key=os.path.getmtime); sid = os.path.basename(transcript)[:-6]
if not sid and envsid:  # 2) session COURANTE (env Claude Code) — fiable même si même cwd partagé
    sid = envsid
    hits = glob.glob(os.path.join(projects, "*", envsid + ".jsonl"))
    if hits:
        transcript = hits[0]
if not sid:  # 3) fallback : .jsonl le plus récent du dossier courant
    cands = glob.glob(os.path.join(projects, enc(cwd), "*.jsonl"))
    if not cands:
        print("Aucune session Claude trouvée pour ce dossier (" + cwd + ")."); sys.exit(0)
    transcript = max(cands, key=os.path.getmtime); sid = os.path.basename(transcript)[:-6]

sidecar = os.path.join(syncdir, sid + ".jsonl")
ckpt = os.path.join(syncdir, sid + ".synced")
if not os.path.exists(sidecar):
    print("Aucun échange distant à synchroniser pour cette session."); sys.exit(0)

last = ""
try:
    with open(ckpt) as f: last = f.read().strip()
except Exception: last = ""

# --- entrées du journal plus récentes que le checkpoint ---
remote = []
with open(sidecar) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try: e = json.loads(line)
        except Exception: continue
        if (e.get("ts", "") > last) and (e.get("user", "") or "").strip():
            remote.append(e)
if not remote:
    print("Aucun nouvel échange distant à synchroniser (déjà à jour)."); sys.exit(0)

# --- transcript -> liste ordonnée (type, texte, ts) ---
def content_text(msg):
    c = msg.get("content")
    if isinstance(c, str): return c.strip()
    if isinstance(c, list):
        out = []
        for b in c:
            if isinstance(b, dict) and b.get("type") == "text": out.append(b.get("text", ""))
            elif isinstance(b, str): out.append(b)
        return "\n".join(out).strip()
    return ""

entries = []
if transcript and os.path.exists(transcript):
    with open(transcript, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: o = json.loads(line)
            except Exception: continue
            t = o.get("type")
            if t in ("user", "assistant"):
                # synthetic = tour injecté, non saisi par l'humain (résumé de compaction de contexte)
                synthetic = bool(o.get("isCompactSummary") or o.get("isVisibleInTranscriptOnly"))
                entries.append((t, content_text(o.get("message") or {}), o.get("timestamp", ""), synthetic))

def match_remote(txt):
    # égalité, ou préfixe (le transcript peut avoir un suffixe : bloc pièces jointes).
    # PAS de "contains" : éviterait de matcher un résumé de compaction qui cite le message.
    for e in remote:
        ru = (e.get("user", "") or "").strip()
        if ru and (txt == ru or txt.startswith(ru)):
            return e
    return None

# --- apparier : user distant + réponses assistant jusqu'au PROCHAIN message distant ---
# On saute les tours `user` synthétiques intercalés (ex. résumé de compaction de contexte) :
# la frontière d'un échange n'est PAS un user quelconque, mais le prochain message distant.
exchanges = []; matched_ts = []
i, n = 0, len(entries)
while i < n:
    t, txt, ts, syn = entries[i]
    e = match_remote(txt) if (t == "user" and txt and not syn) else None
    if e:
        replies = []; j = i + 1
        while j < n:
            tj, txtj, _, synj = entries[j]
            # frontière = prochain VRAI tour humain (texte non vide, non synthétique). On saute
            # ainsi les résumés de compaction et les tool_results (texte vide) intercalés.
            if tj == "user" and txtj and not synj: break
            if tj == "assistant" and txtj: replies.append(txtj)
            j += 1
        try: htime = time.strftime("%H:%M", time.localtime(e.get("at", 0) / 1000))
        except Exception: htime = ""
        exchanges.append((e.get("device", "app"), htime, (e.get("user", "") or "").strip(), "\n".join(replies).strip()))
        matched_ts.append(e.get("ts", "")); i = j
    else:
        i += 1

if not exchanges:
    print("Messages reçus depuis un autre appareil (réponses pas encore dans le transcript) :\n")
    for e in remote:
        print(f"- [{e.get('device','app')}] {(e.get('user','') or '').strip()}")
    sys.exit(0)

print(f"{len(exchanges)} échange(s) traité(s) depuis un autre appareil pendant ton absence :\n")
for dev, htime, u, a in exchanges:
    tag = dev + (f" · {htime}" if htime else "")
    print(f"📱 Toi ({tag}) :\n{u}\n")
    print(f"🤖 Claude (cette session, ailleurs) :\n{a if a else '(réponse non textuelle / non capturée)'}\n")
    print("────────\n")

# --- avancer le checkpoint uniquement sur ce qui a été réellement apparié ---
os.makedirs(syncdir, exist_ok=True)
newck = max(matched_ts + [last])
with open(ckpt, "w") as f: f.write(newck)
PY
