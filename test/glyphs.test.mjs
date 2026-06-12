import test from 'node:test';
import assert from 'node:assert/strict';
import { FONT, GLYPH_W, GLYPH_H, rasterizeLines, lineCols } from '../public/js/glyphs.js';
import { SITE_CONFIG } from '../public/js/config.js';

test('every glyph is a well-formed 5x7 bitmap', () => {
  for (const [ch, rows] of Object.entries(FONT)) {
    assert.equal(rows.length, GLYPH_H, `glyph "${ch}" has ${rows.length} rows`);
    for (const row of rows) {
      assert.equal(row.length, GLYPH_W, `glyph "${ch}" row width`);
      assert.match(row, /^[#.]+$/, `glyph "${ch}" has stray characters`);
    }
  }
});

test('configured marquee lines only use supported characters', () => {
  for (const line of SITE_CONFIG.marqueeLines) {
    for (const ch of line.toUpperCase()) {
      assert.ok(FONT[ch], `no glyph for "${ch}" in line "${line}"`);
    }
  }
});

test('rasterize throws on unsupported characters', () => {
  assert.throws(() => rasterizeLines(['HÉLLO']), /No glyph/);
});

test('cells carry their source character and line index', () => {
  const { cells } = rasterizeLines(['AB', 'C']);
  const chars = new Set(cells.map((c) => c.char));
  assert.deepEqual([...chars].sort(), ['A', 'B', 'C']);
  assert.ok(cells.some((c) => c.line === 0));
  assert.ok(cells.some((c) => c.line === 1));
});

test('cell count matches the filled bits of the bitmaps', () => {
  const filled = (ch) => FONT[ch].join('').split('#').length - 1;
  const { cells } = rasterizeLines(['HI']);
  assert.equal(cells.length, filled('H') + filled('I'));
});

test('grid dimensions: lines are centered and gapped', () => {
  const { cells, cols, rows } = rasterizeLines(['W', 'W'], 3);
  assert.equal(cols, lineCols('W'));
  assert.equal(rows, GLYPH_H * 2 + 3);
  for (const c of cells) {
    assert.ok(c.col >= 0 && c.col < cols);
    assert.ok(c.row >= 0 && c.row < rows);
  }
});

test('scale 2 doubles stroke thickness: 4x the cells, 2x the columns', () => {
  const base = rasterizeLines(['H']);
  const scaled = rasterizeLines(['H'], 3, 2);
  assert.equal(scaled.cells.length, base.cells.length * 4);
  assert.equal(scaled.cols, base.cols * 2);
  assert.equal(scaled.rows, base.rows * 2);
});

test('spaces produce no cells', () => {
  const a = rasterizeLines(['AB']).cells.length;
  const b = rasterizeLines(['A B']).cells.length;
  assert.equal(a, b);
});
