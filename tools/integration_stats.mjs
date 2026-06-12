// End-to-end check for the stats pipeline: drive the real game in headless
// chromium against a real Worker (`wrangler dev`), lose on purpose, and wait
// until the API's responses show up in window.__breakout.stats. Pair with a
// D1 query afterwards to assert rows landed (see README).
//
//   node tools/integration_stats.mjs [url] [timeoutMs]
//
// Exits 0 with a JSON summary when a full game (turn + game responses) has
// round-tripped; exits 1 on timeout.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BIN = process.env.CHROME_BIN
  || process.env.HOME + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const URL_TO_TEST = process.argv[2] || 'http://localhost:8787/';
const TIMEOUT_MS = Number(process.argv[3] || 90000);

const chrome = spawn(BIN, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1440,900', '--remote-debugging-port=9334',
  '--user-data-dir=/tmp/cdp-integration-prof', '--no-first-run', URL_TO_TEST,
], { stdio: 'ignore' });

try {
  await sleep(2500);
  const targets = await (await fetch('http://localhost:9334/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = nextId++;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await new Promise((res) => { ws.onopen = res; });

  const evalJson = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result?.result?.value;
  };

  // The worst player in the world: paddle parked in the corner, clicks to
  // launch (and re-launch) forever. Loses all 3 balls fast → turn records →
  // game record.
  await send('Runtime.evaluate', {
    expression: `setInterval(() => {
      const s = window.__breakout && window.__breakout.state;
      if (!s) return;
      const c = document.getElementById('game');
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 1, clientY: 0 }));
      if (s.mode === 'ready') c.dispatchEvent(new PointerEvent('pointerdown'));
    }, 500)`,
  });

  const deadline = Date.now() + TIMEOUT_MS;
  let summary = null;
  while (Date.now() < deadline) {
    await sleep(1000);
    const snap = await evalJson(`(() => {
      const b = window.__breakout;
      if (!b || !b.state) return null;
      return JSON.stringify({
        mode: b.state.mode, score: b.state.score, lives: b.state.lives,
        turnResponse: b.stats.turn, gameResponse: b.stats.game,
      });
    })()`);
    if (!snap) continue;
    const s = JSON.parse(snap);
    if (s.gameResponse) { summary = s; break; }
  }

  if (!summary) {
    console.error('TIMEOUT: no game response after', TIMEOUT_MS, 'ms');
    process.exitCode = 1;
  } else {
    console.log('ROUNDTRIP OK');
    console.log(JSON.stringify(summary, null, 2));
  }
} finally {
  chrome.kill();
}
