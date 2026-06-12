// Worker entry. Static assets (public/) are served by Cloudflare before this
// runs; only /api/* (run_worker_first) and asset misses reach fetch().

import { handleTurn, handleGame, handleHealth } from './lib/handlers.js';
import { handleCommentary } from './lib/commentary.js';
import { makeLimiter } from './lib/ratelimit.js';

const ROUTES = {
  '/api/turn': { POST: handleTurn },
  '/api/game': { POST: handleGame },
  '/api/health': { GET: handleHealth },
  '/api/commentary': { POST: handleCommentary },
};

// Per-IP, per-minute. Commentary is the expensive one (a Sonnet call each);
// turn/game writes are cheap but D1 isn't a landfill. ~3 legit games/min max.
const LIMITS = {
  '/api/commentary': makeLimiter({ limit: 10 }),
  '/api/turn': makeLimiter({ limit: 30 }),
  '/api/game': makeLimiter({ limit: 10 }),
};

/** Pure-ish router, exported so tests can drive it without a Worker runtime. */
export async function route(request, env) {
  const { pathname } = new URL(request.url);
  const methods = ROUTES[pathname];
  if (!methods) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  const handler = methods[request.method];
  if (!handler) {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json', allow: Object.keys(methods).join(', ') },
    });
  }
  const limiter = LIMITS[pathname];
  if (limiter && !limiter(request.headers.get('cf-connecting-ip') || 'unknown')) {
    return new Response(JSON.stringify({ error: 'rate limited' }), {
      status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' },
    });
  }
  try {
    return await handler(request, env);
  } catch (e) {
    // Never leak internals; D1 errors land here.
    console.error('api error', pathname, e);
    return new Response(JSON.stringify({ error: 'internal error' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
}

export default {
  fetch: (request, env) => route(request, env),
};
