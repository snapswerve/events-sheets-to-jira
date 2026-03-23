/**
 * parser.js — Transforms raw Google Sheets rows into structured event objects.
 *
 * Expected column headers (case-insensitive, order flexible):
 *   Event Name | Trigger / User Action | Platform | Properties | Owner | Priority | Status | Notes
 *
 * Property rows: The "Properties" column can contain newline-separated values like:
 *   "cta_text (string, required)\npath (string, required)\nvariant (string, optional)"
 *
 * The parser is lenient — it skips rows with no event name and logs a warning.
 */

const COLUMN_ALIASES = {
  eventName: ['event name', 'event', 'name'],
  trigger: ['trigger', 'user action', 'trigger / user action', 'description'],
  platform: ['platform', 'platforms'],
  properties: ['properties', 'props', 'event properties'],
  owner: ['owner', 'assigned to', 'assignee', 'engineer'],
  priority: ['priority', 'p0/p1/p2'],
  status: ['status'],
  notes: ['notes', 'note', 'comments'],
};

/**
 * Finds which column index matches a given field, by checking aliases.
 */
function findColumnIndex(headers, aliases) {
  for (const alias of aliases) {
    const index = headers.findIndex((h) => h.toLowerCase().trim() === alias);
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Parses a raw properties cell string into an array of property objects.
 * Handles newline-separated or comma-separated entries.
 *
 * Input: "cta_text (string, required)\npath (string, optional)"
 * Output: [{ name: 'cta_text', type: 'string', required: true }, ...]
 */
function parseProperties(rawValue) {
  if (!rawValue) return [];

  // Split on newlines or semicolons
  const lines = rawValue.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);

  return lines.map((line) => {
    // Try to extract: property_name (type, required/optional) — description
    const match = line.match(/^([a-z_]+)\s*\(([^)]*)\)?\s*(.*)$/i);

    if (match) {
      const [, name, meta, description] = match;
      const metaParts = meta.split(',').map((m) => m.trim().toLowerCase());
      const type = metaParts[0] || 'string';
      const required = metaParts.includes('required');
      return { name: name.trim(), type, required, description: description.trim() };
    }

    // Fallback: treat the whole line as just the property name
    return { name: line, type: 'string', required: false, description: '' };
  });
}

/**
 * Main export — takes raw sheet rows (2D array) and returns an array of event objects.
 */
export function parseSheetsData(rows, tabName) {
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) return [];

  // Build column index map
  const columnMap = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    columnMap[field] = findColumnIndex(headerRow, aliases);
  }

  const events = [];

  for (const [rowIndex, row] of dataRows.entries()) {
    const get = (field) => {
      const idx = columnMap[field];
      return idx !== -1 ? (row[idx] || '').trim() : '';
    };

    const eventName = get('eventName');

    // Skip empty rows silently
    if (!eventName) continue;

    events.push({
      eventName,
      trigger: get('trigger'),
      platform: get('platform'),
      properties: parseProperties(get('properties')),
      owner: get('owner'),
      priority: get('priority'),
      status: get('status'),
      notes: get('notes'),
      sourceTab: tabName,
      sourceRow: rowIndex + 2, // 1-indexed, accounting for header
    });
  }

  return events;
}
