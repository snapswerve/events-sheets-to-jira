/**
 * Runs the full pipeline against the sample plan (examples/build-sample-plan.js).
 *   npm test
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeSamplePlan } from '../examples/build-sample-plan.js';
import { readEventingPlan } from '../src/reader.js';
import { loadEvents, filterEvents, buildTickets, filterTickets } from '../src/pipeline.js';
import { getOpenQuestions, sampleValue, formatFieldTable, getTeamNotes } from '../src/dev-notes.js';
import { parseTrackTab } from '../src/parser.js';
import { getRowUrl } from '../src/links.js';
import { SAMPLE_TABS } from '../examples/build-sample-plan.js';

let data;
let events;

const PLAN_URL = 'https://docs.google.com/spreadsheets/d/test-plan-id/edit?usp=sharing';

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-to-jira-'));
  process.env.GOOGLE_SHEETS_MODE = 'false';
  process.env.TEAM_NOTES_PATH = fileURLToPath(new URL('./fixtures/team-notes.json', import.meta.url));
  process.env.EVENTING_PLAN_URL = PLAN_URL;
  process.env.EVENTING_PLAN_TAB_GIDS = 'Track:111, Identify:222, Page:0, Screen:444';
  process.env.EVENTING_PLAN_PATH = writeSamplePlan(path.join(dir, 'plan.xlsx'));
  data = await readEventingPlan();
  ({ events } = loadEvents(data));
});

const find = (tickets, templateType, eventName) =>
  tickets.find((t) => t.templateType === templateType && (t.eventName || t.whenFired) === eventName);

test('renders every template type without broken output', () => {
  const tickets = buildTickets(events);
  const types = new Set(tickets.map((t) => t.templateType));
  for (const type of ['web-track', 'web-page', 'web-identify', 'ss-track', 'ss-identify', 'mobile-track', 'mobile-screen', 'mobile-identify']) {
    assert.ok(types.has(type), `no ${type} ticket rendered`);
  }

  for (const t of tickets) {
    // "undefined" is expected only in the "never send null/undefined" guidance
    const text = t.description.replaceAll('null, undefined, or empty', '').replaceAll('{{undefined}}', '');
    assert.doesNotMatch(text, /undefined|\[object Object\]/, t.summary);
    for (const [, json] of t.description.matchAll(/\{code:json\}\n([\s\S]*?)\n\{code\}/g)) {
      assert.doesNotThrow(() => JSON.parse(json), `payload example isn't valid JSON in ${t.summary}`);
    }
  }
});

test('fingerprints are unique per ticket', () => {
  const tickets = buildTickets(events);
  assert.equal(new Set(tickets.map((t) => t.fingerprint)).size, tickets.length);
});

test('developer notes are included by default and can be turned off', () => {
  const [withNotes] = buildTickets(events);
  const [withoutNotes] = buildTickets(events, { devNotes: false });
  assert.match(withNotes.description, /h2\. Developer Notes/);
  assert.doesNotMatch(withoutNotes.description, /h2\. Developer Notes/);
});

test('snippets use the right SDK call for each platform', () => {
  const tickets = buildTickets(events);
  assert.match(find(tickets, 'web-page', 'Checkout').description, /analytics\.page\('Checkout', \{/);
  assert.match(find(tickets, 'mobile-screen', 'Product Detail').description, /screen\('Product Detail', \{/);
  assert.match(find(tickets, 'ss-track', 'Order Completed').description, /TrackMessage\.builder\("Order Completed"\)/);
  assert.match(find(tickets, 'ss-identify', 'Subscription Changed').description, /IdentifyMessage\.builder\(\)/);
  assert.match(find(tickets, 'web-identify', 'Signed Up').description, /analytics\.identify\(userId, \{/);
});

test('open questions flag gaps in the spec', () => {
  const tickets = buildTickets(events);
  const checkout = getOpenQuestions(tickets.find((t) => t.eventName === 'Checkout Started' && t.platform === 'Mobile')).join('\n');
  assert.match(checkout, /coupon_code/);
  assert.match(checkout, /status isn't set/);

  const order = getOpenQuestions(find(tickets, 'ss-track', 'Order Completed')).join('\n');
  assert.match(order, /DP-42, DP-43/);

  assert.deepEqual(getOpenQuestions(find(tickets, 'web-page', 'Checkout')), []);
});

test('sample values follow the dictionary type', () => {
  assert.equal(sampleValue({ name: 'result_count', type: 'integer', exampleValues: '24' }), 24);
  assert.equal(sampleValue({ name: 'revenue', type: 'Number', exampleValues: '$49.99' }), 49.99);
  assert.equal(sampleValue({ name: 'currency', type: 'string', exampleValues: 'usd, eur' }), 'usd');
  assert.equal(sampleValue({ name: 'is_member', type: 'Boolean', exampleValues: 'false' }), false);
  assert.deepEqual(sampleValue({ name: 'ids', type: 'array', exampleValues: '["a", "b"]' }), ['a', 'b']);
  assert.equal(sampleValue({ name: 'internal_ref', type: 'string (internal)', exampleValues: '' }), '<internal_ref>');
  assert.equal(sampleValue({ name: 'payment_method', type: 'enum', exampleValues: '"credit card", "paypal"' }), 'credit card');
  assert.equal(sampleValue({ name: 'start_date', type: 'date', exampleValues: 'yyyy-mm-dd' }), '2026-02-24');
});

test('table cells escape characters that would break the Jira table', () => {
  const table = formatFieldTable([{ name: 'plan', type: 'string', status: 'Required', description: 'free | paid\nsee [docs]', exampleValues: '' }]);
  const row = table.split('\n')[1];
  assert.equal(row, '|{{plan}}|string|free \\| paid \\\\ see \\[docs]| |Required|');
});

test('filters narrow events and tickets', () => {
  assert.ok(filterEvents(events, { priorities: ['P0'] }).every((e) => e.priority === 'P0'));
  assert.ok(filterEvents(events, { types: ['identify'] }).every((e) => e.tabType === 'identify'));
  assert.deepEqual(filterEvents(events, { eventQuery: 'SEARCH' }).map((e) => e.eventName), ['Products Searched']);

  const ticketedLeftOut = filterEvents(events, { skipTicketed: true });
  assert.ok(!ticketedLeftOut.some((e) => e.eventName === 'Order Completed'));

  const tickets = buildTickets(events);
  assert.ok(filterTickets(tickets, { platforms: ['server'] }).every((t) => t.platform === 'Server'));
  assert.equal(filterTickets(tickets, { limit: 2 }).length, 2);
});

test('reads the CR plan layout by header name', () => {
  const checkout = events.find((e) => e.eventName === 'Checkout Started');
  assert.equal(checkout.teamOwnership, 'ECQ');
  assert.equal(checkout.idState, 'anonymous & identified');
  assert.equal(checkout.properties.find((p) => p.name === 'products.$.quantity').comment, 'always 1 for memberships');
  assert.match(checkout.comments, /cart total has loaded/);

  const signedUp = events.find((e) => e.tabType === 'identify' && e.whenFired === 'Signed Up');
  assert.deepEqual(signedUp.traits.map((t) => t.name), ['email', 'member_tier', 'created_at']);

  // Generic page properties above the first named page are skipped
  const pages = events.filter((e) => e.tabType === 'page');
  assert.deepEqual(pages.map((e) => e.eventName), ['Checkout']);
  assert.equal(pages[0].properties[0].name, 'old_page_name');
  assert.equal(pages[0].teamOwnership, 'ECQ');
});

test('column order in the sheet does not matter', () => {
  // Swap "Event Name" and "When Fired" in every row
  const swapped = SAMPLE_TABS.Track.map((row) => {
    const copy = [...row];
    [copy[3], copy[4]] = [copy[4], copy[3]];
    return copy;
  });
  const parsed = parseTrackTab(swapped);
  assert.equal(parsed[0].eventName, 'Checkout Started');
  assert.equal(parsed[0].whenFired, 'user views the checkout page with at least one item in the cart');
});

test('nested properties become nested objects and arrays', () => {
  const tickets = buildTickets(events);
  const web = find(tickets, 'web-track', 'Checkout Started').description;
  assert.match(web, /products: \[ \/\/ array, required\n    \{\n      product_id: 1234567,/);

  const payload = JSON.parse(web.match(/\{code:json\}\n([\s\S]*?)\n\{code\}/)[1]);
  assert.deepEqual(payload.properties.products, [{ product_id: 1234567, sku: 'MEMBERSHIP-ANNUAL', price: 29.99, quantity: 1 }]);

  const server = find(tickets, 'ss-track', 'Order Completed').description;
  assert.match(server, /\.put\("address", ImmutableMap\.<String, Object>builder\(\)\n\s+\.put\("city", "san francisco"\)/);
});

test('team notes only go on the platforms and templates they target', () => {
  const tickets = buildTickets(events);
  for (const t of tickets) {
    assert.equal(/h3\. Web-only note/.test(t.description), t.platform === 'Web', t.summary);
    assert.equal(/h3\. Page-only note/.test(t.description), t.templateType === 'web-page', t.summary);
  }
  assert.equal(getTeamNotes({ platform: 'Mobile', templateType: 'mobile-track' }).length, 0);
});

test('links point at the configured plan, down to the row when the row is known', () => {
  // xlsx mode: tab IDs from EVENTING_PLAN_TAB_GIDS
  assert.equal(getRowUrl('track', 42), `${PLAN_URL}#gid=111&range=A42`);
  assert.equal(getRowUrl('page', 5), `${PLAN_URL}#gid=0&range=A5`);

  // API mode, same spreadsheet: tab IDs from the API
  assert.equal(getRowUrl('track', 42, { spreadsheetId: 'test-plan-id', tabGids: { Track: 7 } }), `${PLAN_URL}#gid=7&range=A42`);

  // API mode, a different copy of the sheet: rows may not line up, so no row link
  assert.equal(getRowUrl('track', 42, { spreadsheetId: 'some-other-copy', tabGids: { Track: 1 } }), PLAN_URL);

  const saved = process.env.EVENTING_PLAN_URL;
  delete process.env.EVENTING_PLAN_URL;
  try {
    assert.equal(getRowUrl('track', 42), '');
    process.env.GOOGLE_SPREADSHEET_ID = 'from-env-id';
    assert.equal(getRowUrl('track', 42, { spreadsheetId: 'from-env-id', tabGids: { Track: 9 } }), 'https://docs.google.com/spreadsheets/d/from-env-id/edit#gid=9&range=A42');
  } finally {
    process.env.EVENTING_PLAN_URL = saved;
    delete process.env.GOOGLE_SPREADSHEET_ID;
  }
});

test('descriptions without a configured plan link still render', () => {
  const saved = process.env.EVENTING_PLAN_URL;
  delete process.env.EVENTING_PLAN_URL;
  try {
    const [ticket] = buildTickets(events);
    assert.match(ticket.description, /referenced in the eventing plan\./);
    assert.match(ticket.description, /\* \*Spec source:\* Track tab, row 2/);
  } finally {
    process.env.EVENTING_PLAN_URL = saved;
  }
});
