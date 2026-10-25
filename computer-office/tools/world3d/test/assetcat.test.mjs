import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { AssetCatalog, agentState, agentVisual, visualOf, AGENT_STATES } from "../../../public/world3d/assetcat.mjs";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../public/world3d/assets"), reg = JSON.parse(fs.readFileSync(path.join(ROOT, "registry.json"), "utf8"));
const mk = (loadImage) => new AssetCatalog(reg.assets, { base: "/assets/", loadImage });

test("identifiants uniques et recherche par catégorie / tags / dimensions", () => {
  const c = mk(); assert.ok(c.has("ow_allison")); assert.throws(() => new AssetCatalog([{ id: "a" }, { id: "a" }]), /dupliqué/);
  assert.ok(c.find({ category: "character" }).length >= 10); assert.ok(c.find({ tags: ["overworld", "pnj"] }).every((e) => e.tags.includes("overworld")));
  assert.deepEqual(c.find({ sheet: true, minW: 128, maxW: 128 }).map((e) => e.sheet.px[0]).filter((w) => w !== 128), []);
  assert.equal(c.find({ text: "zzz-inexistant" }).length, 0);
});
test("découpe de spritesheet : rectangles de frames sans fichier par frame", () => {
  const c = mk(); assert.deepEqual(c.frameRect("ow_allison", { dir: "bas", frame: 0 }), { x: 0, y: 0, w: 32, h: 48 });
  assert.deepEqual(c.frameRect("ow_allison", { dir: "droite", frame: 3 }), { x: 96, y: 96, w: 32, h: 48 }); assert.deepEqual(c.frameRect("ow_allison", { dir: "haut", frame: 9 }), { x: 96, y: 144, w: 32, h: 48 }); // colonne bornée
  assert.deepEqual(c.frameRect("chr_ingenieur", { dir: "gauche", state: "marche1" }), { x: 32, y: 48, w: 32, h: 48 }); assert.equal(c.frameCount("ow_allison"), 16); assert.throws(() => c.frameRect("hq"), /pas de spritesheet/);
  for (const e of c.find({ sheet: true })) { const s = e.sheet; assert.equal(s.cols * s.cell[0], s.px[0], e.id); assert.equal(s.rows * s.cell[1], s.px[1], e.id); }
});
test("sheetInfo : séquences et pied", () => { const i = mk().sheetInfo("chr_medecin"); assert.deepEqual(i.frames.run, [1, 2, 3, 0]); assert.ok(i.foot > 0); assert.equal(mk().sheetInfo("hq"), null); });
test("chargement paresseux, cache et placeholders", async () => {
  let calls = 0; const c = mk(async (url) => { calls++; if (url.toLowerCase().includes("allison")) return { w: 128, h: 192 }; throw new Error("404"); });
  const [a, b] = await Promise.all([c.image("ow_allison"), c.image("ow_allison")]); assert.equal(calls, 1); assert.equal(a, b); assert.equal(a.placeholder, false);
  const bad = await c.image("ow_pliny"); assert.equal(bad.placeholder, true); assert.match(bad.reason, /404/); const unk = await c.image("n_existe_pas"); assert.equal(unk.placeholder, true);
  assert.equal(c.stats().failed.length, 1); assert.equal((await mk().image("ow_allison")).placeholder, true); // sans chargeur : placeholder, pas d'exception
});
test("registre : fichiers référencés présents", () => { for (const e of reg.assets) assert.ok(fs.existsSync(path.join(ROOT, e.file)), e.id + " → " + e.file); });
test("états d'agents → représentation visuelle", () => {
  assert.equal(agentState({ status: "working" }), "working"); assert.equal(agentState({ status: "working", phase: "thinking" }), "thinking"); assert.equal(agentState({ status: "failed" }), "error");
  assert.equal(agentState({ status: "blocked" }), "blocked"); assert.equal(agentState({ status: "done" }), "success"); assert.equal(agentState({ status: "idle" }), "idle"); assert.equal(agentState({ status: "queued" }), "idle");
  assert.equal(agentState({ status: "working" }, { hostOnline: false }), "offline"); assert.equal(agentState(null), "idle");
  for (const s of AGENT_STATES) { const v = visualOf(s); assert.ok(v.label && v.anim); } assert.equal(agentVisual({ status: "failed" }).badge, "error"); assert.equal(visualOf("offline").tint, "gray"); assert.equal(visualOf("inconnu").anim, "idle");
});
