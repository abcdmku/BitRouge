/**
 * Dev screenshot rig for the v2 redesign report (no dependencies; CDP over
 * Node's built-in WebSocket + headless Chrome). Usage:
 *   node scripts/shoot-v2.mjs [baseUrl]
 * Writes docs/screenshots/{v2-hub-desktop,v2-run-desktop,v2-run-mobile}.png
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:6174";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = join(process.cwd(), "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const profile = join(tmpdir(), `bitrouge-shoot-${Date.now()}`);
const port = 9333;
const chrome = spawn(CHROME, [
  `--headless=new`,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=1280,800`,
  `--hide-scrollbars`,
  `--no-first-run`,
  `--disable-gpu-sandbox`,
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await res.json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome devtools endpoint never came up");
}

let msgId = 0;
const pending = new Map();
let ws;

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function main() {
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");

  const evaluate = async (expression) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result?.value;
  };

  const setSize = (width, height, mobile = false) =>
    s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });

  const shot = async (name) => {
    const { data } = await s("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, name), Buffer.from(data, "base64"));
    console.log("wrote", name);
  };

  const navigate = async (url) => {
    await s("Page.navigate", { url });
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate("document.readyState === 'complete' && !!document.querySelector('.app, .loading')");
      if (ready) break;
      await sleep(250);
    }
  };

  // ---- 1. hub, desktop ----
  await setSize(1280, 800);
  await navigate(`${BASE}/`);
  await sleep(2500); // fonts + hydrate
  await shot("v2-hub-desktop.png");

  // ---- 2. run, desktop: deploy and let the auto-run mine/haul for a while ----
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Deploy');
    if (b) b.click();
    return !!b;
  })()`);
  // let the machine visibly work: sites channel, task queue ticks, arcs draw
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const state = await evaluate(`(() => {
      const t = document.body.innerText;
      const m = t.match(/FLUSH (\\d)\\/(\\d)/);
      return { quota: m ? m[0] : null, dead: t.includes('PROCESS TERMINATED') };
    })()`);
    if (state.dead) break;
    // stop once some quota progress or 25s elapsed, so the shot shows mid-work
    if (i >= 24 || (state.quota && state.quota !== "FLUSH 0/3" && i >= 10)) break;
  }
  await shot("v2-run-desktop.png");

  // ---- 3. run, mobile 390x844 ----
  await setSize(390, 844, true);
  await sleep(1200);
  await shot("v2-run-mobile.png");

  await send("Target.closeTarget", { targetId });
  ws.close();
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    chrome.kill();
    process.exit(1);
  },
);
