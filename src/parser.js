/**
 * parser.js — Parses multi-row event groups from each tab type.
 *
 * Each tab shares a pattern: a "header" row (with priority + event name) followed by
 * "property" rows (with values only in the property columns).
 *
 * Columns are found by header name (see columns.js), so the order in the sheet doesn't matter.
 * Layouts in the CR tracking plan as of Oct 2026:
 *
 *   Track:    Priority | Generating Source | Product Section | Event Name | When Fired | ID state |
 *             Templates | Reviewed by MC | Team Ownership | Property Priority | Properties |
 *             (Go to Definition) | Property Status | Jira Tickets | Code Example | Comments | ...
 *   Identify: Priority | Generating Source | When fires | Team Ownership | ID state | Templates |
 *             Trait Priority | Traits | Trait Status | Jira Tickets | ...
 *   Page:     (intro rows) Priority | Page Name | When Fired | ID state | Team Ownership |
 *             Properties | Property Description | Property Status | Jira Tickets | ...
 *   Screen:   (intro rows) Priority | Screen Name | When Fired | ID state | Team Ownership |
 *             Properties | Description | Property Status | ... | Jira Tickets
 *
 * Comments and Code Example on the event's first row belong to the event; on later rows they
 * belong to that row's property.
 */

import { findColumns, missingHeadersMessage, rowReader } from './columns.js';

const COMMON_COLUMNS = {
  priority: ['Priority', 'Order'],
  generatingSource: ['Generating Source'],
  whenFired: ['When Fired', 'When fires'],
  idState: ['ID state'],
  templates: ['Templates'],
  teamOwnership: ['Team Ownership', 'Team'],
  existingTicket: ['Jira Tickets', 'Ticket', 'Ticket PROD'],
  codeExample: ['Code Example'],
  comments: ['Comments'],
};

const TAB_SPECS = {
  track: {
    tabName: 'Track',
    fieldKey: 'properties',
    columns: {
      ...COMMON_COLUMNS,
      productSection: ['Product Section'],
      eventName: ['Event Name'],
      field: ['Properties', 'Property'],
      fieldStatus: ['Property Status'],
    },
    required: ['priority', 'eventName', 'field'],
  },
  identify: {
    tabName: 'Identify',
    fieldKey: 'traits',
    columns: {
      ...COMMON_COLUMNS,
      field: ['Traits', 'Trait'],
      fieldStatus: ['Trait Status'],
    },
    required: ['priority', 'whenFired', 'field'],
  },
  page: {
    tabName: 'Page',
    fieldKey: 'properties',
    defaultSource: 'Web',
    columns: {
      ...COMMON_COLUMNS,
      eventName: ['Page Name'],
      field: ['Properties', 'Property'],
      fieldDescription: ['Property Description', 'Description'],
      fieldStatus: ['Property Status'],
    },
    required: ['priority', 'eventName'],
  },
  screen: {
    tabName: 'Screen',
    fieldKey: 'properties',
    defaultSource: 'Mobile',
    columns: {
      ...COMMON_COLUMNS,
      eventName: ['Screen Name'],
      field: ['Properties', 'Property'],
      fieldDescription: ['Description', 'Property Description'],
      fieldStatus: ['Property Status'],
    },
    required: ['priority', 'eventName'],
  },
};

export function parseTrackTab(rows) {
  return parseEventTab(rows, 'track');
}

export function parseIdentifyTab(rows) {
  return parseEventTab(rows, 'identify');
}

export function parsePageTab(rows) {
  return parseEventTab(rows, 'page');
}

export function parseScreenTab(rows) {
  return parseEventTab(rows, 'screen');
}

function parseEventTab(rows, tabType) {
  const spec = TAB_SPECS[tabType];
  if (rows.length === 0) return [];

  const found = findColumns(rows, spec.columns, spec.required);
  if (!found) {
    console.warn(`⚠️  ${missingHeadersMessage(spec.tabName, spec.columns, spec.required)}`);
    return [];
  }

  const get = rowReader(found.cols);
  const events = [];
  let current = null;

  for (let i = found.headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const startsEvent = Boolean(get(row, 'priority'));

    if (startsEvent) {
      // New event group
      if (current) events.push(current);
      current = {
        tabType,
        priority: normalizePriority(get(row, 'priority')),
        generatingSource: get(row, 'generatingSource') || spec.defaultSource || '',
        productSection: get(row, 'productSection'),
        eventName: get(row, 'eventName'),
        whenFired: get(row, 'whenFired'),
        idState: normalizeIdState(get(row, 'idState')),
        templates: get(row, 'templates'),
        teamOwnership: get(row, 'teamOwnership'),
        existingTicket: get(row, 'existingTicket'),
        codeExample: get(row, 'codeExample'),
        comments: get(row, 'comments'),
        [spec.fieldKey]: [],
        sourceRow: i + 1,
      };
    }
    if (!current) continue;

    const name = get(row, 'field');
    if (name) {
      current[spec.fieldKey].push({
        name,
        description: get(row, 'fieldDescription'),
        status: normalizeStatus(get(row, 'fieldStatus')),
        // Notes on the event's first row are about the event, not its first property
        comment: startsEvent ? '' : get(row, 'comments'),
        codeExample: startsEvent ? '' : get(row, 'codeExample'),
      });
    } else if (!startsEvent && get(row, 'comments')) {
      current.comments = [current.comments, get(row, 'comments')].filter(Boolean).join('\n');
    }
  }
  if (current) events.push(current);

  return events;
}

// ─── Helpers ───

function normalizePriority(raw) {
  // Handle "P0C" → "P0C", "p1" → "P1", etc.
  return String(raw || '').trim().toUpperCase();
}

// The plan uses "Both" for events sent for anonymous and identified users
function normalizeIdState(raw) {
  return /^both$/i.test(raw) ? 'anonymous & identified' : raw;
}

function normalizeStatus(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'unset';
  const lower = s.toLowerCase();
  if (lower === 'required') return 'Required';
  if (lower === 'optional') return 'Optional';
  if (lower === 'no') return 'No';
  return s;
}
