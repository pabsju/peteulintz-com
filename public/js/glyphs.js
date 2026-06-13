// 5x7 bitmap font + rasterizer. Pure data/functions — no DOM. Tested in node.

export const GLYPH_W = 5;
export const GLYPH_H = 7;

// Each glyph: 7 rows of 5 chars, '#' = filled cell.
export const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
};

const LETTER_GAP = 1; // columns between glyphs

/** Width of one line in grid columns. */
export function lineCols(text) {
  const n = text.length;
  return n === 0 ? 0 : n * GLYPH_W + (n - 1) * LETTER_GAP;
}

/**
 * Rasterize lines of text into cells on an abstract grid.
 * Returns { cells, cols, rows }. Each cell: { row, col, char, line }
 * where char is the source character (a cell of "R" renders as "R")
 * and line is the line index. Grid rows include a gap between lines.
 * scale: each bitmap pixel becomes a scale x scale block of cells, so
 * scale 2 makes every stroke two characters thick.
 * Throws on characters missing from FONT.
 */
export function rasterizeLines(lines, lineGap = 3, scale = 1) {
  const cells = [];
  const cols = Math.max(...lines.map(lineCols), 0) * scale;
  let row = 0;
  lines.forEach((text, lineIdx) => {
    const upper = text.toUpperCase();
    // center this line horizontally on the grid
    let col = Math.floor((cols - lineCols(upper) * scale) / 2);
    for (const ch of upper) {
      const glyph = FONT[ch];
      if (!glyph) throw new Error(`No glyph for character: "${ch}"`);
      for (let r = 0; r < GLYPH_H; r++) {
        for (let c = 0; c < GLYPH_W; c++) {
          if (glyph[r][c] !== '#') continue;
          for (let dr = 0; dr < scale; dr++) {
            for (let dc = 0; dc < scale; dc++) {
              cells.push({
                row: row + r * scale + dr,
                col: col + c * scale + dc,
                char: ch === ' ' ? '' : ch,
                line: lineIdx,
              });
            }
          }
        }
      }
      col += (GLYPH_W + LETTER_GAP) * scale;
    }
    row += (GLYPH_H + lineGap) * scale;
  });
  return { cells, cols, rows: row - (lines.length ? lineGap * scale : 0) };
}

/**
 * Rasterize a raw ASCII image: each line is a row of pixels, every non-space
 * character becomes a cell rendered as that character. Unlike rasterizeLines
 * there's no FONT lookup, no uppercasing, and no centering — the grid IS the
 * art, so any character (including block glyphs ░▒▓█) is allowed.
 * scale: each source char becomes a scale x scale block of cells.
 * Returns { cells, cols, rows } — same shape as rasterizeLines.
 */
export function rasterizeImage(lines, scale = 1) {
  const cells = [];
  const cols = Math.max(...lines.map((l) => l.length), 0) * scale;
  const rows = lines.length * scale;
  lines.forEach((line, r0) => {
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === ' ' || ch === '') continue;
      for (let dr = 0; dr < scale; dr++) {
        for (let dc = 0; dc < scale; dc++) {
          cells.push({ row: r0 * scale + dr, col: c * scale + dc, char: ch, line: 0 });
        }
      }
    }
  });
  return { cells, cols, rows };
}
