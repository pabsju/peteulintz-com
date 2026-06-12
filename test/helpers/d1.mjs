// Test double for the D1 binding, backed by REAL SQLite (node:sqlite,
// --experimental-sqlite on node 23). Tests apply the actual migration file
// and run the handlers' actual SQL — far stronger than a mock that just
// echoes scripted rows. The adapter only translates call shape:
//   D1:          env.DB.prepare(sql).bind(...args).first()/run()   (async)
//   node:sqlite: db.prepare(sql).get(params)/run(params)           (sync)
// D1 binds positionally; node:sqlite wants {1: v1, 2: v2} for ?N params.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export function makeDB() {
  const db = new DatabaseSync(':memory:');
  // Apply every migration in order — tests always see the prod schema.
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'));
  }
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      // node:sqlite quirk: anonymous `?` placeholders want positional args,
      // numbered `?N` placeholders want an object keyed by index.
      const numbered = /\?\d/.test(sql);
      const withArgs = (args) => {
        const bound = numbered
          ? [Object.fromEntries(args.map((v, i) => [i + 1, v]))]
          : args;
        return {
          run: async () => stmt.run(...bound),
          first: async () => stmt.get(...bound) ?? null,
          // D1's .all() wraps rows in {results, meta}; mirror that.
          all: async () => ({ results: stmt.all(...bound) }),
        };
      };
      return { ...withArgs([]), bind: (...args) => withArgs(args) };
    },
    // escape hatch for assertions
    raw: db,
  };
}

/** A DB whose every query throws — for 500-path tests. */
export function brokenDB() {
  return {
    prepare() {
      throw new Error('D1_ERROR: database is on fire');
    },
  };
}
