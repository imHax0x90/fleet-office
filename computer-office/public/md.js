/* Fleet Office — rendu Markdown (GFM allégé), sans dépendance.
   Blocs : titres h1-h6, paragraphes, listes imbriquées (+ cases à cocher), tableaux (alignements),
   citations, code ``` / ~~~ (coloration légère + bouton Copier + diff), séparateurs.
   Inline : `code`, **gras**, *italique*, ~~barré~~, [liens](url), URL nues. Tout est échappé d'abord. */
(function () {
  "use strict";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // ---- inline --------------------------------------------------------------------
  function inline(t) {
    const codes = [], keep = [];
    t = t.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, c) => { codes.push(c.replace(/^\s(.*\S.*)\s$/, "$1")); return "\u0001" + (codes.length - 1) + "\u0001"; });
    t = esc(t);
    const stash = (h) => { keep.push(h); return "\u0002" + (keep.length - 1) + "\u0002"; };
    t = t.replace(/!?\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|\/|#)[^\s)]*)\)/g, (_, txt, url) => stash('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>"));
    t = t.replace(/(^|[\s(>])(https?:\/\/[^\s<)\u0001\u0002]+[^\s<).,;:!?\u0001\u0002])/g, (_, p, url) => p + stash('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + "</a>"));
    t = t.replace(/\*\*\*([^\n]+?)\*\*\*/g, "<b><i>$1</i></b>")
      .replace(/\*\*(?=\S)([^\n]+?)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^\w])__(?=\S)([^\n]+?)__(?=[^\w]|$)/g, "$1<b>$2</b>")
      .replace(/~~(?=\S)([^\n]+?)~~/g, "<s>$1</s>")
      .replace(/(^|[^\w*])\*(?![\s*])([^*\n]+?)\*(?![\w*])/g, "$1<i>$2</i>")
      .replace(/(^|[^\w_])_(?![\s_])([^_\n]+?)_(?![\w_])/g, "$1<i>$2</i>");
    t = t.replace(/\u0002(\d+)\u0002/g, (_, i) => keep[+i]);
    return t.replace(/\u0001(\d+)\u0001/g, (_, i) => "<code>" + esc(codes[+i]) + "</code>");
  }

  // ---- coloration du code ---------------------------------------------------------
  const KW = {
    js: "const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of null undefined true false this super yield static void delete interface type enum",
    py: "def class return if elif else for while in not and or is import from as with try except finally raise lambda None True False pass break continue yield global nonlocal async await self",
    sh: "if then else elif fi for while do done case esac function in export local return echo cd sudo unset set source",
    sql: "select from where insert into values update set delete create table drop alter join left right inner outer on group by order limit having and or not null as distinct union count primary key index",
    go: "func package import return if else for range switch case break continue go defer chan map struct interface type var const nil true false select default",
    rs: "fn let mut pub use mod struct enum impl trait match if else for while loop return self Self true false as in ref move async await crate where",
  };
  const ALIAS = { javascript: "js", jsx: "js", ts: "js", tsx: "js", typescript: "js", node: "js", mjs: "js", json: "json", jsonc: "json", python: "py", python3: "py", bash: "sh", shell: "sh", zsh: "sh", console: "sh", sh: "sh", yml: "yaml", yaml: "yaml", golang: "go", rust: "rs", postgres: "sql", mysql: "sql", sql: "sql", diff: "diff", patch: "diff", js: "js", py: "py", go: "go", rs: "rs", dockerfile: "sh", toml: "yaml", ini: "yaml" };
  const reCache = {};
  function langRe(l) {
    if (reCache[l]) return reCache[l];
    const com = l === "py" || l === "sh" || l === "yaml" ? "#[^\\n]*" : l === "sql" ? "--[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
    const str = l === "js" ? "\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'|`(?:\\\\.|[^`\\\\])*`" : "\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'";
    const kw = KW[l] ? "\\b(?:" + KW[l].split(" ").join("|") + ")\\b" : "(?!)";
    const key = l === "json" || l === "yaml" ? "(?:\"(?:\\\\.|[^\"\\\\\\n])*\"|[A-Za-z_][\\w.-]*)(?=\\s*:)" : "(?!)";
    return (reCache[l] = new RegExp("(" + com + ")|(" + key + ")|(" + str + ")|(\\b\\d+(?:\\.\\d+)?\\b)|(" + kw + ")", l === "sql" ? "gi" : "g"));
  }
  function highlight(code, lang) {
    const l = ALIAS[String(lang || "").toLowerCase()];
    if (!l) return esc(code);
    if (l === "diff") return code.split("\n").map((ln) => { const c = /^\+(?!\+\+)/.test(ln) ? "d-add" : /^-(?!--)/.test(ln) ? "d-del" : /^@@/.test(ln) ? "d-hunk" : ""; return c ? '<span class="' + c + '">' + esc(ln) + "</span>" : esc(ln); }).join("\n");
    if (code.length > 60000) return esc(code);
    const re = langRe(l); let out = "", last = 0, m; re.lastIndex = 0;
    while ((m = re.exec(code))) {
      if (m[0] === "") { re.lastIndex++; continue; }
      out += esc(code.slice(last, m.index));
      const cls = m[1] ? "tk-c" : m[2] ? "tk-key" : m[3] ? "tk-s" : m[4] ? "tk-n" : "tk-k";
      out += '<span class="' + cls + '">' + esc(m[0]) + "</span>"; last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }
  function codeBlock(code, lang) {
    const label = lang ? '<span class="md-lang">' + esc(lang) + "</span>" : '<span class="md-lang"></span>';
    return '<div class="md-code"><div class="md-code-h">' + label + '<button class="md-copy" type="button">Copier</button></div><pre><code>' + highlight(code, lang) + "</code></pre></div>";
  }

  // ---- blocs ----------------------------------------------------------------------
  const RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
  const RE_HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const RE_LI = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const RE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  const isSep = (l) => l != null && l.includes("|") && RE_SEP.test(l);

  function splitRow(line) {
    let s = line.trim(); if (s.startsWith("|")) s = s.slice(1); if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells = []; let cur = "", code = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (c === "`") code = !code;
      if (c === "|" && !code) { cells.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    cells.push(cur.trim()); return cells;
  }
  function table(L, i) {
    const head = splitRow(L[i]), sep = splitRow(L[i + 1]), n = head.length;
    const al = sep.map((c) => (/^:-+:$/.test(c) ? "c" : /-:$/.test(c) ? "r" : /^:-/.test(c) ? "l" : ""));
    const cell = (tag, c, k) => "<" + tag + (al[k] ? ' class="al-' + al[k] + '"' : "") + ">" + inline(c) + "</" + tag + ">";
    let h = "<thead><tr>" + head.map((c, k) => cell("th", c, k)).join("") + "</tr></thead><tbody>";
    i += 2;
    while (i < L.length && L[i].trim() && L[i].includes("|") && !RE_FENCE.test(L[i])) {
      const r = splitRow(L[i]); while (r.length < n) r.push("");
      h += "<tr>" + r.slice(0, n).map((c, k) => cell("td", c, k)).join("") + "</tr>"; i++;
    }
    return { html: '<div class="md-table"><table>' + h + "</tbody></table></div>", next: i };
  }
  function startsBlock(L, i) {
    const l = L[i];
    if (RE_FENCE.test(l) || RE_HEAD.test(l) || RE_HR.test(l) || /^\s{0,3}>/.test(l)) return true;
    const m = l.match(RE_LI); if (m && (/[-*+]/.test(m[2]) || parseInt(m[2], 10) === 1)) return true;
    return l.includes("|") && isSep(L[i + 1]);
  }
  function list(L, i) {
    const first = L[i].match(RE_LI), base = first[1].length, ordered = /\d/.test(first[2]);
    const start = ordered ? parseInt(first[2], 10) : 1; let html = "";
    while (i < L.length) {
      const m = L[i].match(RE_LI);
      if (!m || m[1].length > base + 1 || m[1].length < base - 1 || /\d/.test(m[2]) !== ordered) break;
      const cInd = m[1].length + m[2].length + 1, lines = [m[3]]; i++;
      while (i < L.length) {
        const l = L[i];
        if (!l.trim()) { let j = i; while (j < L.length && !L[j].trim()) j++; if (j < L.length && L[j].match(/^\s*/)[0].length >= cInd) { lines.push(""); i++; continue; } break; }
        const ind = l.match(/^\s*/)[0].length, lm = l.match(RE_LI);
        if (lm && ind <= base + 1) break;
        if (ind < cInd && !lm && (startsBlock(L, i))) break;
        lines.push(l.slice(Math.min(ind, cInd))); i++;
      }
      let task = ""; const tm = lines[0].match(/^\[([ xX])\]\s+/);
      if (tm) { task = '<span class="md-task' + (tm[1] === " " ? "" : " done") + '">' + (tm[1] === " " ? "☐" : "☑") + "</span> "; lines[0] = lines[0].slice(tm[0].length); }
      let body = blocks(lines);
      if (task) body = /^<p>/.test(body) ? body.replace(/^<p>/, "<p>" + task) : task + body;
      html += "<li" + (tm ? ' class="task"' : "") + ">" + body + "</li>";
    }
    return { html: ordered ? "<ol" + (start !== 1 ? ' start="' + start + '"' : "") + ">" + html + "</ol>" : "<ul>" + html + "</ul>", next: i };
  }
  function blocks(L) {
    let i = 0, out = "";
    while (i < L.length) {
      const line = L[i];
      if (!line.trim()) { i++; continue; }
      let m = line.match(RE_FENCE);
      if (m) {
        const ind = m[1].length, ch = m[2][0], len = m[2].length, close = new RegExp("^\\s*\\" + ch + "{" + len + ",}\\s*$"), buf = []; i++;
        while (i < L.length && !close.test(L[i])) { buf.push(L[i].slice(Math.min(ind, L[i].match(/^\s*/)[0].length))); i++; }
        i++; out += codeBlock(buf.join("\n"), m[3]); continue;
      }
      if ((m = line.match(RE_HEAD))) { out += "<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">"; i++; continue; }
      if (RE_HR.test(line)) { out += "<hr>"; i++; continue; }
      if (/^\s{0,3}>/.test(line)) {
        const buf = []; while (i < L.length && /^\s{0,3}>/.test(L[i])) { buf.push(L[i].replace(/^\s{0,3}>\s?/, "")); i++; }
        out += "<blockquote>" + blocks(buf) + "</blockquote>"; continue;
      }
      if (line.includes("|") && isSep(L[i + 1])) { const t = table(L, i); out += t.html; i = t.next; continue; }
      if (RE_LI.test(line)) { const r = list(L, i); out += r.html; i = r.next; continue; }
      const buf = [line]; i++;
      while (i < L.length && L[i].trim() && !startsBlock(L, i)) { buf.push(L[i]); i++; }
      out += "<p>" + inline(buf.join("\n")).replace(/\n/g, "<br>") + "</p>";
    }
    return out;
  }

  function render(src) { return blocks(String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n")); }
  window.FleetMD = { render, inline };

  // bouton « Copier » (délégation : fonctionne pour tout rendu, y compris le streaming)
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".md-copy"); if (!b) return;
    const code = b.closest(".md-code").querySelector("code"), txt = code ? code.textContent : "";
    const done = () => { b.textContent = "Copié ✓"; b.classList.add("ok"); setTimeout(() => { b.textContent = "Copier"; b.classList.remove("ok"); }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => fallback(txt, done));
    else fallback(txt, done);
  });
  function fallback(txt, done) { try { const ta = document.createElement("textarea"); ta.value = txt; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(); } catch {} }
})();
