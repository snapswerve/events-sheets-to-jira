/**
 * parser.js — Parses multi-row event groups from each tab type.
 *
 * Each tab has a different structure but shares a pattern:
 * a "header" row (with priority + event name in specific columns) followed by
 * "property" rows (with values only in the property columns).
 *
 * This parser handles all four tab types: Track, Identify, Page, Screen.
 */

// ─── Track Tab ───
// Columns: Order(0) | Generating Source(1) | Product Section(2) | Event Name(3) | When Fired(4) |
//          ID state(5) | Templates(6) | Proposed POC Properties(7) | Reviewed by MC(8) |
//          Team Ownership(9) | Properties(10) | Go to Definition(11) | Property Status(12) |
//          Ticket(13) | Code Example(14) | Comments(15) | In stage(16) | Validated?(17) | In prod(18)

export function parseTrackTab(rows) {
  if (rows.length < 2) return [];

  const events = [];
  let current = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const priority = row[0];

    if (priority) {
      // New event group
      if (current) events.push(current);
      current = {
        tabType: 'track',
        priority: normalizePriority(priority),
        generatingSource: (row[1] || '').trim(),
        productSection: (row[2] || '').trim(),
        eventName: (row[3] || '').trim(),
        whenFired: (row[4] || '').trim(),
        idState: (row[5] || '').trim(),
        templates: (row[6] || '').trim(),
        teamOwnership: (row[9] || '').trim(),
        properties: [],
        sourceRow: i + 1,
      };
      // First row might also have a property in col 10
      if (row[10]) {
        current.properties.push({
          name: (row[10] || '').trim(),
          status: normalizeStatus(row[12]),
        });
      }
    } else if (current && row[10]) {
      // Property continuation row
      current.properties.push({
        name: (row[10] || '').trim(),
        status: normalizeStatus(row[12]),
      });
    }
  }
  if (current) events.push(current);

  return events;
}

// ─── Identify Tab ───
// Columns: Priority(0) | Generating Source(1) | When fires(2) | ID state(3) |
//          Templates(4) | Team(5) | Traits(6) | Ticket PROD(7) | In prod(8) | Trait Status(9)

export function parseIdentifyTab(rows) {
  if (rows.length < 2) return [];

  const events = [];
  let current = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const priority = row[0];

    if (priority) {
      if (current) events.push(current);
      current = {
        tabType: 'identify',
        priority: normalizePriority(priority),
        generatingSource: (row[1] || '').trim(),
        whenFired: (row[2] || '').trim(),
        idState: (row[3] || '').trim(),
        templates: (row[4] || '').trim(),
        teamOwnership: (row[5] || '').trim(),
        traits: [],
        sourceRow: i + 1,
      };
      if (row[6]) {
        current.traits.push({
          name: (row[6] || '').trim(),
          status: normalizeStatus(row[9]),
        });
      }
    } else if (current && row[6]) {
      current.traits.push({
        name: (row[6] || '').trim(),
        status: normalizeStatus(row[9]),
      });
    }
  }
  if (current) events.push(current);

  return events;
}

// ─── Page Tab ───
// Named pages start at row 11 (0-indexed)
// Columns: Priority(0) | Page Name(1) | When Fired(2) | ID state(3) |
//          Properties(4) | Property Description(5) | Property Status(6)

export function parsePageTab(rows) {
  // Find the header row for named pages
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'Priority' && rows[i][1] === 'Page Name') {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const events = [];
  let current = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const priority = row[0];

    if (priority) {
      if (current) events.push(current);
      current = {
        tabType: 'page',
        priority: normalizePriority(priority),
        eventName: (row[1] || '').trim(),
        whenFired: (row[2] || '').trim(),
        idState: (row[3] || '').trim(),
        generatingSource: 'Web',
        properties: [],
        sourceRow: i + 1,
      };
      if (row[4]) {
        current.properties.push({
          name: (row[4] || '').trim(),
          description: (row[5] || '').trim(),
          status: normalizeStatus(row[6]),
        });
      }
    } else if (current && row[4]) {
      current.properties.push({
        name: (row[4] || '').trim(),
        description: (row[5] || '').trim(),
        status: normalizeStatus(row[6]),
      });
    }
  }
  if (current) events.push(current);

  return events;
}

// ─── Screen Tab ───
// Named screens start after the header row with "Priority" | "Screen Name"
// Columns: Priority(0) | Screen Name(1) | When Fired(2) | ID state(3) |
//          Properties(4) | Description(5) | Property Status(6)

export function parseScreenTab(rows) {
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'Priority' && rows[i][1] === 'Screen Name') {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const events = [];
  let current = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const priority = row[0];

    if (priority) {
      if (current) events.push(current);
      current = {
        tabType: 'screen',
        priority: normalizePriority(priority),
        eventName: (row[1] || '').trim(),
        whenFired: (row[2] || '').trim(),
        idState: (row[3] || '').trim(),
        generatingSource: 'Mobile',
        properties: [],
        sourceRow: i + 1,
      };
      if (row[4]) {
        current.properties.push({
          name: (row[4] || '').trim(),
          description: (row[5] || '').trim(),
          status: normalizeStatus(row[6]),
        });
      }
    } else if (current && row[4]) {
      current.properties.push({
        name: (row[4] || '').trim(),
        description: (row[5] || '').trim(),
        status: normalizeStatus(row[6]),
      });
    }
  }
  if (current) events.push(current);

  return events;
}

// ─── Helpers ───

function normalizePriority(raw) {
  if (!raw) return '';
  const s = String(raw).trim().toUpperCase();
  // Handle "P0C" → "P0C", "P1" → "P1", etc.
  if (s.match(/^P\d/)) return s;
  return s;
}

function normalizeStatus(raw) {
  if (!raw) return 'unset';
  const s = String(raw).trim().toLowerCase();
  if (s === 'required') return 'Required';
  if (s === 'optional') return 'Optional';
  if (s === 'no') return 'No';
  return String(raw).trim();
}
