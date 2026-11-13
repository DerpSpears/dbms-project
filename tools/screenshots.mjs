// Take full-page screenshots of the running app for the project report.
//   node tools/screenshots.mjs <outDir> <customerCookie> <adminCookie>
// Uses headless Chrome over the DevTools protocol (no extra packages).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outDir, custToken, adminToken] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const BASE = "http://localhost:3000";
const SHOTS = [
  ["01-home-opener", "/?intro=1", null, 1300, 860, false],
  ["02-home", "/", null, 1300, 0, true],
  ["03-shop-search", "/shop?q=ronin", null, 1300, 0, true],
  ["04-shop-tag", "/shop?tag=superhero", null, 1300, 0, true],
  ["05-product", "/product/8", "c", 1300, 0, true],
  ["06-cart", "/cart", "c", 1300, 0, true],
  ["07-checkout", "/checkout", "c", 1300, 0, true],
  ["08-order", "/orders/4", "c", 1300, 0, true],
  ["09-admin", "/admin", "a", 1300, 0, true],
  ["10-admin-mongo", "/admin/products/8", "a", 1300, 0, true],
  ["11-database", "/database", null, 1300, 0, true],
  ["12-console-denied", "/database?sql=" + encodeURIComponent("SELECT password_hash FROM customers") + "#result", null, 1300, 900, false],
  ["13-login", "/login", null, 1300, 0, true],
];

const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9333", "--no-first-run",
  "--user-data-dir=" + join(outDir, ".profile"), "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Page.enable");
await send("Network.enable");
for (const [name, path, who, width, height, skipOpener] of SHOTS) {
  await send("Network.clearBrowserCookies");
  const token = who === "c" ? custToken : who === "a" ? adminToken : null;
  if (token) await send("Network.setCookie", { name: "inkpow_session", value: token, url: BASE });
  await send("Emulation.setDeviceMetricsOverride", { width, height: height || 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE + "/login" });
  await sleep(600);
  await send("Runtime.evaluate", { expression: `sessionStorage.setItem("inkpow-opened", ${skipOpener ? '"1"' : '"0"'})` });
  await send("Page.navigate", { url: BASE + path });
  await sleep(2200);
  if (name === "01-home-opener") { await send("Runtime.evaluate", { expression: "scrollTo(0, innerHeight * 0.45)" }); await sleep(800); }
  const clip = height ? undefined : await (async () => {
    const r = await send("Runtime.evaluate", { expression: "document.documentElement.scrollHeight", returnByValue: true });
    return { x: 0, y: 0, width, height: Math.min(r.result.result.value, 6000), scale: 1 };
  })();
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !height, ...(clip ? { clip } : {}) });
  writeFileSync(join(outDir, name + ".png"), Buffer.from(shot.result.data, "base64"));
  console.log("saved", name);
}
ws.close();
chrome.kill();
