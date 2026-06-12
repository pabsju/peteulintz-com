// Headless smoke test: drive the real game in chromium over CDP and report
// engine state + a screenshot. Real wall-clock time on purpose — chrome's
// --virtual-time-budget starves requestAnimationFrame, freezing the game on
// its first frame.
//
//   node tools/cdp_smoke.mjs [url] [playMs] [out.png]
//
// Requires a playwright-cached chromium (see BIN) and the site served at url.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const BIN = process.env.CHROME_BIN
  || process.env.HOME + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const URL_TO_TEST = process.argv[2] || 'http://localhost:8000/';
const WAIT_MS = Number(process.argv[3] || 6000);
const OUT = process.argv[4] || '/tmp/smoke.png';

const chrome = spawn(BIN, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1440,900', '--remote-debugging-port=9333',
  '--user-data-dir=/tmp/cdp-smoke-prof', '--no-first-run', URL_TO_TEST,
], { stdio: 'ignore' });

try {
  await sleep(2500);
  const targets = await (await fetch('http://localhost:9333/json/list')).json();
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

  // Autoplay: every 400ms move the paddle under the ball and click
  // (launches when ready, restarts after game over).
  await send('Runtime.evaluate', {
    expression: `setInterval(() => {
      const s = window.__breakout && window.__breakout.state;
      if (!s) return;
      const c = document.getElementById('game');
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + s.ball.x, clientY: 0 }));
      c.dispatchEvent(new PointerEvent('pointerdown'));
    }, 400)`,
  });

  await sleep(WAIT_MS); // let the game actually play

  const stateRes = await send('Runtime.evaluate', {
    expression: `(() => { const s = window.__breakout && window.__breakout.state;
      return s ? JSON.stringify({mode: s.mode, score: s.score, lives: s.lives,
        destroyed: s.destroyed, total: s.total, padW: Math.round(s.paddle.w),
        comboTier: s.comboTier, ball: [Math.round(s.ball.x), Math.round(s.ball.y)]}) : 'no state'; })()`,
    returnByValue: true,
  });
  console.log('STATE:', stateRes.result?.result?.value);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', OUT);
} finally {
  chrome.kill();
}
process.exit(0);
