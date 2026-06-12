// Seed the stats distributions by playing REAL games through the REAL
// pipeline — headless chromium, varied skill, no synthetic rows. Run against
// wrangler dev to test, against production once after deploy so the first
// human player isn't compared to an empty table.
//
//   node tools/seed_games.mjs [url] [nGames] [mode]
//
// mode: 'desktop' (default) or 'laptop' — seed BOTH in prod, the
// distributions are separate.
//
// Skill is paddle-tracking quality: 1.0 follows the ball exactly, lower
// values wander off target sinusoidally and miss more. Cycles a fixed
// spread so the distribution gets a believable shape (a few good runs, a
// fat middle, a sad tail).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BIN = process.env.CHROME_BIN
  || process.env.HOME + '/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const URL_TO_TEST = process.argv[2] || 'http://localhost:8787/';
const N_GAMES = Number(process.argv[3] || 30);
const MODE = process.argv[4] === 'laptop' ? 'laptop' : 'desktop';
const SKILLS = [0.15, 0.3, 0.45, 0.55, 0.65, 0.75, 0.85];
const PER_GAME_TIMEOUT_MS = 180_000;

const chrome = spawn(BIN, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--window-size=1440,900', '--remote-debugging-port=9336', '--mute-audio',
  '--user-data-dir=/tmp/cdp-seed-prof', '--no-first-run', URL_TO_TEST,
], { stdio: 'ignore' });

try {
  await sleep(2500);
  const targets = await (await fetch('http://localhost:9336/json/list')).json();
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
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result?.result?.value;
  };

  // Difficulty: persist the mode, then reload so the game boots into it.
  await evalJs(`localStorage.setItem('gameMode', '${MODE}'); location.reload(); 'ok'`);
  await sleep(2500);

  // Driver: follows the ball with skill-scaled wander; clicks to launch.
  // window.__seed.skill is set per game from out here.
  await send('Runtime.evaluate', {
    expression: `
      window.__seed = { skill: 0.5 };
      setInterval(() => {
        const s = window.__breakout && window.__breakout.state;
        if (!s) return;
        const c = document.getElementById('game');
        const r = c.getBoundingClientRect();
        const wander = (1 - window.__seed.skill) * s.width * 0.55;
        const target = s.ball.x + Math.sin(performance.now() / 600) * wander;
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + target, clientY: 0 }));
        if (s.mode !== 'playing') c.dispatchEvent(new PointerEvent('pointerdown'));
      }, 120)`,
  });

  for (let g = 0; g < N_GAMES; g++) {
    const skill = SKILLS[g % SKILLS.length];
    await evalJs(`window.__seed.skill = ${skill}`);
    const before = await evalJs(`window.__breakout.stats.game ? window.__breakout.stats.game.sampleSize : 0`);
    const deadline = Date.now() + PER_GAME_TIMEOUT_MS;
    let result = null;
    while (Date.now() < deadline && !result) {
      await sleep(1000);
      result = await evalJs(`(() => {
        const b = window.__breakout;
        const done = b.stats.game && b.stats.game.sampleSize > ${before};
        return done ? JSON.stringify({ score: b.stats.game.finalScore, n: b.stats.game.sampleSize }) : null;
      })()`);
    }
    if (!result) {
      console.error(`game ${g + 1}: timed out (skill ${skill})`);
      continue;
    }
    const r = JSON.parse(result);
    console.log(`game ${g + 1}/${N_GAMES} skill=${skill} score=${r.score} (total games: ${r.n})`);
  }
  console.log('seeding done');
} finally {
  chrome.kill();
}
