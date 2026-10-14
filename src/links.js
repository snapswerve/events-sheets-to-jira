/**
 * links.js — Links from tickets back to the tracking plan.
 *
 * Set locally in .env (kept out of git, since plan links can expose company data):
 *   EVENTING_PLAN_URL       the plan's link (falls back to one built from GOOGLE_SPREADSHEET_ID)
 *   EVENTING_PLAN_TAB_GIDS  tab IDs for row links in xlsx mode, e.g. "Track:123,Identify:456,Page:0,Screen:789"
 *
 * Row-level links ("…#gid=123&range=A42") need the tab's sheet ID (gid):
 *   - API mode: taken from the spreadsheet that was read, if it's the one being linked to
 *   - xlsx mode: from EVENTING_PLAN_TAB_GIDS, assuming the xlsx is a download of the linked plan
 */

import { TAB_NAMES } from './reader.js';

export function getPlanUrl() {
  if (process.env.EVENTING_PLAN_URL) return process.env.EVENTING_PLAN_URL;
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '';
}

export function getTabName(tabType) {
  return TAB_NAMES[tabType] || tabType;
}

/**
 * Returns a link to the event's row, falling back to the plan URL when the row can't be
 * pinpointed — e.g. the data came from a different copy of the sheet, whose rows may not match.
 * Returns '' when no plan link is configured.
 * @param {Object} source - { spreadsheetId, tabGids } from reader.js (API mode only)
 */
export function getRowUrl(tabType, row, source = {}) {
  const planUrl = getPlanUrl();
  if (!planUrl) return '';

  let tabGids = {};
  if (source.spreadsheetId) {
    if (source.spreadsheetId === spreadsheetIdFromUrl(planUrl)) tabGids = source.tabGids || {};
  } else {
    tabGids = parseTabGids(process.env.EVENTING_PLAN_TAB_GIDS);
  }

  const gid = tabGids[getTabName(tabType)];
  if (gid === undefined || !row) return planUrl;
  return `${planUrl.split('#')[0]}#gid=${gid}&range=A${row}`;
}

/** "Track:123, Page:0" → { Track: 123, Page: 0 } */
function parseTabGids(raw = '') {
  const pairs = raw.split(',').map((pair) => pair.split(':').map((s) => s.trim()));
  return Object.fromEntries(pairs.filter(([name, gid]) => name && /^\d+$/.test(gid || '')).map(([name, gid]) => [name, Number(gid)]));
}

function spreadsheetIdFromUrl(url) {
  return String(url).match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] || '';
}
