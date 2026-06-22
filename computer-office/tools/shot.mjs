#!/usr/bin/env node
// Screenshot a URL via an already-running headless Chrome (CDP over :9222).
// Usage: node tools/shot.mjs <url> <outPath> [waitMs] [width] [height]
// No npm deps — uses Node 22 global fetch + WebSocket.
import { writeFileSync } from 'node:fs';

const [, , url = 'http://localhost:4199', out = '/tmp/shot.png', waitMsArg, wArg, hArg] =
  process.argv;
const waitMs = Number(waitMsArg || 5000);
const width = Number(wArg || 1680);
const height = Number(hArg || 945);
const CDP = 'http://localhost:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  // Create a fresh tab. Newer Chrome wants PUT on /json/new.
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`/json/new ${res.status} ${await res.text()}`);
  return res.json();
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  const events = [];
  const waiters = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      for (const w of waiters.splice(0)) w(msg);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const waitFor = (method, timeout = 15000) =>
    new Promise((resolve, reject) => {
      const hit = events.find((e) => e.method === method);
      if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error(`timeout ${method}`)), timeout);
      waiters.push((m) => {
        if (m.method === method) {
          clearTimeout(t);
          resolve(m);
        }
      });
    });
  return { send, waitFor };
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});
const { send, waitFor } = cdp(ws);

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable').catch(() => {});
await send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.navigate', { url });
await waitFor('Page.loadEventFired', 20000).catch(() => {});
await sleep(waitMs); // let WebGL + GLB loading settle and animate a few frames
// optional camera move (or any JS) before capture, e.g. SHOT_EVAL="__view(8,4,12, 1,1,2)"
if (process.env.SHOT_EVAL) {
  await send('Runtime.evaluate', { expression: process.env.SHOT_EVAL }).catch(() => {});
  await sleep(1400);
}

// Surface any page console errors to help debugging blank renders.
const errs = await send('Runtime.evaluate', {
  expression: 'window.__errs ? window.__errs.join("\\n") : ""',
  returnByValue: true,
}).catch(() => ({ result: { value: '' } }));
if (errs?.result?.value) console.error('PAGE ERRORS:\n' + errs.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
ws.close();
console.log('wrote ' + out);
process.exit(0);
