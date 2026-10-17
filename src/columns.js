/**
 * columns.js — Finds columns by header name instead of fixed position.
 *
 * The tracking plan is a living sheet: columns get added and reordered. Matching on header
 * text keeps parsing correct when that happens, and fails loudly (instead of silently
 * reading the wrong column) when a required header is renamed or removed.
 */

/**
 * Scans the first rows for a header row containing every required column.
 * @param {Array[]} rows - raw 2D array from reader.js
 * @param {Object} spec - { key: ['Header name', 'Alternate name', ...] } — first match wins
 * @param {string[]} required - keys that must be present for a row to count as the header
 * @returns {{ headerIdx: number, cols: Object } | null} cols maps key → column index
 */
export function findColumns(rows, spec, required) {
  const searchDepth = Math.min(rows.length, 25);
  for (let i = 0; i < searchDepth; i++) {
    const headers = (rows[i] || []).map(normalizeHeader);
    const cols = {};
    for (const [key, names] of Object.entries(spec)) {
      const idx = names.map((name) => headers.indexOf(normalizeHeader(name))).find((idx) => idx !== -1);
      if (idx !== undefined) cols[key] = idx;
    }
    if (required.every((key) => cols[key] !== undefined)) return { headerIdx: i, cols };
  }
  return null;
}

/**
 * Message for a tab whose header row couldn't be found.
 */
export function missingHeadersMessage(tabName, spec, required) {
  const names = required.map((key) => `"${spec[key][0]}"`).join(', ');
  return `${tabName} tab: couldn't find a header row with ${names} — skipping this tab. Check whether those columns were renamed.`;
}

/** Returns a reader for one row: get('eventName') → trimmed cell text, '' if the column is absent. */
export function rowReader(cols) {
  return (row, key) => (cols[key] === undefined ? '' : cell(row, cols[key]));
}

// Cells can come back as numbers or booleans (xlsx, checkbox columns), not just strings.
export function cell(row, idx) {
  const v = (row || [])[idx];
  return v === undefined || v === null ? '' : String(v).trim();
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
