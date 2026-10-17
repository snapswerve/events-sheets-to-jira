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
import { loadEvents, filterEvents, buildTickets, holdBackTickets, filterTickets } from '../src/pipeline.js';
import { getOpenQuestions, sampleValue, formatFieldTable } from '../src/dev-notes.js';
import { findMisfiledTracks, findHeldTickets, heldTicketMarker, findAppScreenLoadTracks, misfiledMarkers, platformRule, describeConfig, matchPageName, normalizeConfig, loadCompanyConfig } from '../src/rules.js';
import { parseTrackTab } from '../src/parser.js';
import { getRowUrl } from '../src/links.js';
import { SAMPLE_TABS } from '../examples/build-sample-plan.js';

let data;
let events;

const PLAN_URL = 'https://docs.google.com/spreadsheets/d/test-plan-id/edit?usp=sharing';

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-to-jira-'));
  process.env.GOOGLE_SHEETS_MODE = 'false';
  process.env.COMPANY_CONFIG = fileURLToPath(new URL('./fixtures/company.json', import.meta.url));
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
  assert.equal(sampleValue({ name: 'purchased_at', type: 'date', exampleValues: 'yyyy-mm-ddT00:00:00.000Z' }), '2026-02-24T03:25:53.802Z');
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

test('notes are inserted by conditions on the event shape', () => {
  const tickets = buildTickets(events);
  for (const t of tickets) {
    assert.equal(/h3\. Web page-load note/.test(t.description), t.pageLoad && t.platform === 'Web', t.summary);
    assert.equal(/h3\. Page-only note/.test(t.description), t.templateType === 'web-page', t.summary);
    assert.equal(/h3\. Payments note/.test(t.description), t.eventName === 'Order Completed', t.summary);
  }
});

const RULES_OFF = normalizeConfig({ rules: { pageLoad: { enabled: false } } });

test('page loads are page/screen events plus tracks carrying page_name', () => {
  const tickets = buildTickets(events);
  const pageLoads = new Set(tickets.filter((t) => t.pageLoad).map((t) => t.eventName));
  assert.deepEqual([...pageLoads].sort(), ['Article Viewed', 'Checkout', 'Checkout Started', 'Product Detail']);
  assert.ok(buildTickets(events, { config: RULES_OFF }).every((t) => !t.pageLoad));
});

test('page-load tracks get the matching page name, or an open question', () => {
  const tickets = buildTickets(events);

  const checkout = find(tickets, 'web-track', 'Checkout Started');
  assert.equal(checkout.expectedPageName, 'Checkout');
  assert.match(checkout.description, /page_name: 'Checkout', \/\/ string, required/);
  assert.match(checkout.description, /h3\. Page name\nSet \{\{page_name\}\} to \{\{Checkout\}\}.*Reporting reads them as the same page\./);

  const article = find(tickets, 'web-track', 'Article Viewed');
  assert.match(getOpenQuestions(article).join('\n'), /No Page or Screen event in the plan matches "Article Viewed"/);

  // The page event lists the tracks that must use its name
  assert.match(find(tickets, 'web-page', 'Checkout').description, /\{\{Checkout\}\}, must exactly match \{\{page_name\}\} on the page-load track events for this page: Checkout Started\./);
});

test('the misfiled hold-back only applies to web; app screen loads get a question, server ones are skipped', () => {
  const base = events.find((e) => e.eventName === 'Home Viewed');
  const variant = (eventName, sourceRow, generatingSource, whenFired = base.whenFired) => ({
    ...base,
    eventName,
    sourceRow,
    generatingSource,
    templates: '',
    whenFired,
    properties: base.properties.filter((p) => p.name.toLowerCase() !== 'page_name'),
  });
  const webOnly = variant('Fx Web Viewed', 901, 'Web');
  const appOnly = variant('Fx App Viewed', 902, 'Mobile', 'Fires when the article screen loads in the app');
  const mixed = variant('Fx Mixed Viewed', 903, 'Web; Mobile');
  const serverOnly = variant('Fx Server Loaded', 904, 'Server', 'Fires when the page loads on the server');
  const plan = [webOnly, appOnly, mixed, serverOnly];
  const cfg = loadCompanyConfig();

  assert.deepEqual(findMisfiledTracks(plan, cfg).map((e) => e.eventName), ['Fx Web Viewed', 'Fx Mixed Viewed']);
  assert.deepEqual(findAppScreenLoadTracks(plan, cfg).map((e) => e.eventName), ['Fx App Viewed']);

  const tickets = buildTickets(plan, { config: cfg, planEvents: plan });
  const appQuestions = getOpenQuestions(tickets.find((t) => t.eventName === 'Fx App Viewed')).join('\n');
  assert.match(appQuestions, /reads like a screen load, but there's no \{\{page_name\}\}/);
  assert.doesNotMatch(appQuestions, /belongs on the Page\/Screen tab/);
  const serverQuestions = getOpenQuestions(tickets.find((t) => t.eventName === 'Fx Server Loaded')).join('\n');
  assert.doesNotMatch(serverQuestions, /belongs on the Page\/Screen tab|reads like a screen load/);

  // Holding app tracks back too is one config change
  const strict = normalizeConfig({ rules: { pageLoad: { enabled: true, holdMisfiledPlatforms: ['web', 'mobile'] } } });
  assert.deepEqual(findMisfiledTracks(plan, strict).map((e) => e.eventName), ['Fx Web Viewed', 'Fx App Viewed', 'Fx Mixed Viewed']);
  assert.deepEqual(findAppScreenLoadTracks(plan, strict), []);

  // The app question text is configurable
  const custom = normalizeConfig({ rules: { pageLoad: { enabled: true, appScreenLoadQuestion: 'Ask Analytics about {{marker}} for app screens.' } } });
  const custQuestions = getOpenQuestions(buildTickets([appOnly], { config: custom, planEvents: [appOnly] })[0]).join('\n');
  assert.match(custQuestions, /Ask Analytics about \{\{page_name\}\} for app screens\./);
});

test('track events that read like page views are flagged', () => {
  assert.deepEqual(findMisfiledTracks(events, loadCompanyConfig()).map((e) => e.eventName), ['Home Viewed']);
  assert.deepEqual(findMisfiledTracks(events, RULES_OFF), []);

  const home = buildTickets(events).find((t) => t.eventName === 'Home Viewed');
  assert.match(getOpenQuestions(home).join('\n'), /belongs on the Page\/Screen tab/);
});

test('page names match by words, preferring the longest', () => {
  const names = ['Checkout', 'CIA', 'Sub CIA', 'Product Overview', 'Buying Guide'];
  assert.equal(matchPageName('Checkout Step Viewed', names), 'Checkout');
  assert.equal(matchPageName('Sub CIA Viewed', names), 'Sub CIA');
  assert.equal(matchPageName('Overview Viewed', names), 'Product Overview');
  assert.equal(matchPageName('Buying Guide Viewed', names), 'Buying Guide');
  assert.equal(matchPageName('Model Viewed', names), '');
  assert.equal(matchPageName('Checkouts Viewed', names), '');
});

test('pageNames in the config sets the page name when no page event matches', () => {
  const config = normalizeConfig({ rules: { pageLoad: { enabled: true, pageNames: { 'Article Viewed': 'Article' } } } });
  const article = buildTickets(events, { config }).find((t) => t.eventName === 'Article Viewed');
  assert.equal(article.expectedPageName, 'Article');
  assert.match(article.description, /page_name: 'Article',/);
  assert.doesNotMatch(getOpenQuestions(article).join('\n'), /No Page or Screen event/);
});

test('notPageLoads keeps a track with page_name out of the page-load rule', () => {
  const config = normalizeConfig({ rules: { pageLoad: { enabled: true, notPageLoads: ['Article Viewed'] } } });
  const article = buildTickets(events, { config }).find((t) => t.eventName === 'Article Viewed');
  assert.equal(article.pageLoad, false);
  assert.doesNotMatch(getOpenQuestions(article).join('\n'), /No Page or Screen event/);
});

test('a company wrapper replaces the web snippet and the properties it sets', () => {
  const config = normalizeConfig({
    wrappers: {
      web: {
        name: 'Acme.analytics',
        providesProperties: ['platform'],
        snippets: { track: 'const { analytics } = Acme;\n\nanalytics.track({\n  name: {{name}},\n  props: {{props}},\n});' },
      },
    },
  });
  const tickets = buildTickets(events, { config });
  const web = find(tickets, 'web-track', 'Checkout Started').description;

  assert.match(web, /analytics\.track\(\{\n  name: 'Checkout Started',\n  props: \{\n    checkout_id: 'chk_8f2k1', \/\/ string, required/);
  assert.match(web, /\n  \},\n\}\);\n\/\/ Set by Acme\.analytics — don't pass: platform\n\{code\}/);
  assert.doesNotMatch(web.split('{code:javascript}')[1], /platform: 'web'/, 'platform left out of the call');
  assert.match(web, /\|\{\{platform\}\}\|string\|platform action took place on\|web, app\|set by Acme\.analytics\|/);
  assert.match(web, /"platform": "web"/, 'still in the example payload');
  assert.doesNotMatch(getOpenQuestions(find(tickets, 'web-track', 'Checkout Started')).join('\n'), /\{\{platform\}\}/);

  // Other platforms and call types keep the default SDK snippet
  assert.match(find(tickets, 'mobile-track', 'Checkout Started').description, /const \{ track \} = useAnalytics\(\);/);
  assert.match(find(tickets, 'web-page', 'Checkout').description, /analytics\.page\('Checkout', \{/);
});

test('page_name is exempt from the lowercase rule where it is sent', () => {
  const tickets = buildTickets(events);
  assert.match(find(tickets, 'web-track', 'Checkout Started').description, /except for `page_name` property \(must match the page name exactly\)/);
  assert.doesNotMatch(find(tickets, 'web-track', 'Products Searched').description, /except for `page_name`/);
});

test('a non-page-load track that still carries page properties is asked to drop them', () => {
  const config = normalizeConfig({ rules: { pageLoad: { enabled: true, notPageLoads: ['Article Viewed'], pageProperties: ['page_name', 'content_id'] } } });
  const article = buildTickets(events, { config }).find((t) => t.eventName === 'Article Viewed');
  assert.match(getOpenQuestions(article).join('\n'), /page properties shouldn't be sent: \{\{page_name\}\}, \{\{content_id\}\}/);
});

test('a wrapper that identifies the user drops the user ID instructions', () => {
  const config = normalizeConfig({ wrappers: { web: { name: 'Acme.analytics', setsUserId: true, snippets: { identify: 'analytics.identify({{props}});' } } } });
  const tickets = buildTickets(events, { config });
  const identify = find(tickets, 'web-identify', 'Signed Up').description;
  assert.match(identify, /analytics\.identify\(\{\n  email: 'example@example\.com',/);
  assert.match(identify, /Don't pass a user ID — Acme\.analytics identifies the user itself/);
  assert.doesNotMatch(find(tickets, 'web-track', 'Checkout Started').description, /make sure \{\{analytics\.identify\(\)\}\} has already run/);
});

test('with rules off, descriptions have no rule sections', () => {
  for (const t of buildTickets(events, { config: RULES_OFF })) {
    assert.doesNotMatch(t.description, /h3\. Page name|Web page-load note/, t.summary);
  }
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

// ─── Per-platform page-load markers (pageLoad.platformMarkers) ───

const MOBILE_MARKER = {
  markerProperty: 'screen_name',
  markerReason: 'Reporting reads them as the same screen.',
  pageProperties: ['screen_name', 'old_screen_name'],
};
const withMarkers = (pageLoad = {}) =>
  normalizeConfig({ rules: { pageLoad: { enabled: true, markerReason: 'Reporting reads them as the same page.', platformMarkers: { mobile: MOBILE_MARKER }, ...pageLoad } } });

// Track events shaped like the sample plan's, with the properties named
function markerTrack(eventName, sourceRow, generatingSource, propNames, whenFired = 'Fires when the product detail screen loads') {
  const checkout = events.find((e) => e.eventName === 'Checkout Started');
  const like = checkout.properties.find((p) => p.name === 'page_name');
  return {
    ...checkout,
    eventName,
    sourceRow,
    generatingSource,
    templates: '',
    whenFired,
    properties: propNames.map((name) => ({ ...like, name })),
  };
}
const sampleView = (tabType, eventName) => events.find((e) => e.tabType === tabType && e.eventName === eventName);

test('app screen-load tracks carry the mobile marker and get the Screen name', () => {
  const track = markerTrack('Product Detail Viewed', 950, 'Mobile', ['screen_name', 'old_screen_name']);
  const plan = [sampleView('screen', 'Product Detail'), sampleView('page', 'Checkout'), track];
  const config = withMarkers();
  const tickets = buildTickets(plan, { config, planEvents: plan });

  const mobile = find(tickets, 'mobile-track', 'Product Detail Viewed');
  assert.equal(mobile.pageLoad, true);
  assert.equal(mobile.markerProperty, 'screen_name');
  assert.equal(mobile.expectedPageName, 'Product Detail');
  assert.match(mobile.description, /screen_name: 'Product Detail',/);
  assert.match(mobile.description, /h3\. Page name\nSet \{\{screen_name\}\} to \{\{Product Detail\}\}.*Reporting reads them as the same screen\./);
  assert.match(mobile.description, /except for `screen_name` property \(must match the screen name exactly\)/);
  assert.deepEqual(getOpenQuestions(mobile).filter((q) => /screen_name|page_name/.test(q)), []);

  // The Screen ticket names the mobile marker; the Page ticket has no tracks carrying page_name
  assert.match(find(tickets, 'mobile-screen', 'Product Detail').description, /\{\{Product Detail\}\}, must exactly match \{\{screen_name\}\} on the page-load track events for this screen: Product Detail Viewed\. Reporting reads them as the same screen\./);
  assert.doesNotMatch(find(tickets, 'web-page', 'Checkout').description, /must exactly match/);

  // A web track carrying only screen_name isn't a web page load
  const webOnly = markerTrack('Product Detail Viewed', 951, 'Web', ['screen_name'], 'user taps a product');
  assert.equal(buildTickets([webOnly], { config, planEvents: plan })[0].pageLoad, false);
});

test('with a mobile marker, app tracks that read like a screen load without it are held back', () => {
  const config = withMarkers();
  assert.deepEqual(config.rules.pageLoad.holdMisfiledPlatforms, ['web', 'mobile']);

  const appNoMarker = markerTrack('Fx App Viewed', 960, 'Mobile', ['product_id']);
  const appPageName = markerTrack('Fx App Page Name Viewed', 961, 'Mobile', ['page_name']);
  const appMarked = markerTrack('Fx App Marked Viewed', 962, 'Mobile', ['screen_name']);
  const plan = [appNoMarker, appPageName, appMarked];
  assert.deepEqual(findMisfiledTracks(plan, config).map((e) => e.eventName), ['Fx App Viewed', 'Fx App Page Name Viewed']);
  assert.deepEqual(findAppScreenLoadTracks(plan, config), []);

  const [ticket] = buildTickets([appPageName], { config, planEvents: plan });
  const questions = getOpenQuestions(ticket).join('\n');
  assert.match(questions, /reads like a page\/screen load, but there's no \{\{screen_name\}\}\. If this is a page view, it belongs on the Page\/Screen tab; if it's a track event that fires on page load, add \{\{screen_name\}\}\./);
  assert.doesNotMatch(questions, /Decide how app screen loads/);
});

test('mixed web + mobile events need each platform\'s marker', () => {
  const config = withMarkers();
  const pageOnly = markerTrack('Fx Page Only Viewed', 970, 'Web; Mobile', ['page_name'], 'On product page/screen load');
  pageOnly.templates = 'web\nmobile app';
  const screenOnly = { ...markerTrack('Fx Screen Only Viewed', 971, 'Web; Mobile', ['screen_name'], 'On product page/screen load'), templates: 'web\nmobile app' };
  const both = { ...markerTrack('Fx Both Viewed', 972, 'Web; Mobile', ['page_name', 'screen_name'], 'On product page/screen load'), templates: 'web\nmobile app' };
  const neither = { ...markerTrack('Fx Neither Viewed', 973, 'Web; Mobile', ['product_id'], 'On product page/screen load'), templates: 'web\nmobile app' };
  const plan = [sampleView('page', 'Checkout'), sampleView('screen', 'Product Detail'), pageOnly, screenOnly, both, neither];

  assert.deepEqual(findMisfiledTracks(plan, config).map((e) => e.eventName), ['Fx Page Only Viewed', 'Fx Screen Only Viewed', 'Fx Neither Viewed']);
  const tickets = buildTickets(plan, { config, planEvents: plan });
  const q = (type, name) => getOpenQuestions(find(tickets, type, name)).join('\n');

  // Only the mobile marker is missing: the web ticket (its marker is there) names it with its platform
  assert.match(q('web-track', 'Fx Page Only Viewed'), /there's no \{\{screen_name\}\} on mobile\. .*add \{\{screen_name\}\} on mobile\./);
  assert.match(q('mobile-track', 'Fx Page Only Viewed'), /there's no \{\{screen_name\}\}\. .*add \{\{screen_name\}\}\./);
  assert.match(q('web-track', 'Fx Screen Only Viewed'), /there's no \{\{page_name\}\}\. .*add \{\{page_name\}\}\./);
  assert.match(q('web-track', 'Fx Neither Viewed'), /there's no \{\{page_name\}\} on web or \{\{screen_name\}\} on mobile\. .*add \{\{page_name\}\} on web and \{\{screen_name\}\} on mobile\./);
  assert.doesNotMatch(q('web-track', 'Fx Both Viewed'), /there's no/);

  // Each ticket is a page load only with its own platform's marker
  const pageLoad = (type, name) => find(tickets, type, name).pageLoad;
  assert.deepEqual([pageLoad('web-track', 'Fx Page Only Viewed'), pageLoad('mobile-track', 'Fx Page Only Viewed')], [true, false]);
  assert.deepEqual([pageLoad('web-track', 'Fx Screen Only Viewed'), pageLoad('mobile-track', 'Fx Screen Only Viewed')], [false, true]);
  assert.deepEqual([pageLoad('web-track', 'Fx Both Viewed'), pageLoad('mobile-track', 'Fx Both Viewed')], [true, true]);
  // ...and is asked for its own marker's value when no Page/Screen event matches
  assert.match(q('web-track', 'Fx Both Viewed'), /confirm the exact \{\{page_name\}\} value/);
  assert.match(q('mobile-track', 'Fx Both Viewed'), /confirm the exact \{\{screen_name\}\} value .*Reporting reads them as the same screen\./);
});

test('notPageLoads asks to drop each platform\'s page properties', () => {
  const config = withMarkers({ notPageLoads: ['Fx Added'], pageProperties: ['page_name', 'old_page_name'] });
  const added = { ...markerTrack('Fx Added', 980, 'Web; Mobile', ['page_name', 'old_page_name', 'screen_name', 'old_screen_name'], 'user adds a product'), templates: 'web\nmobile app' };
  const tickets = buildTickets([added], { config, planEvents: [added] });
  const q = (type) => getOpenQuestions(find(tickets, type, 'Fx Added')).join('\n');
  assert.match(q('web-track'), /page properties shouldn't be sent: \{\{page_name\}\}, \{\{old_page_name\}\} —/);
  assert.match(q('mobile-track'), /page properties shouldn't be sent: \{\{screen_name\}\}, \{\{old_screen_name\}\} —/);
  assert.ok(tickets.every((t) => !t.pageLoad));
});

test('hold platforms default to web plus every platform with a marker; an explicit list wins', () => {
  const hold = (pageLoad) => normalizeConfig({ rules: { pageLoad: { enabled: true, ...pageLoad } } }).rules.pageLoad.holdMisfiledPlatforms;
  assert.deepEqual(hold({}), ['web']);
  assert.deepEqual(hold({ platformMarkers: {} }), ['web']);
  assert.deepEqual(hold({ platformMarkers: { Mobile: MOBILE_MARKER } }), ['web', 'mobile']);
  assert.deepEqual(hold({ platformMarkers: { web: { markerProperty: 'page_name' }, server: { markerProperty: 'page_name' } } }), ['web', 'server']);
  assert.deepEqual(hold({ platformMarkers: { mobile: MOBILE_MARKER }, holdMisfiledPlatforms: ['web'] }), ['web']);
  assert.deepEqual(hold({ platformMarkers: { mobile: MOBILE_MARKER }, holdMisfiledPlatforms: [] }), []);

  // Explicitly web only: app screen loads without screen_name are asked about, naming screen_name
  const config = withMarkers({ holdMisfiledPlatforms: ['web'] });
  const app = markerTrack('Fx App Viewed', 990, 'Mobile', ['page_name']);
  assert.deepEqual(findMisfiledTracks([app], config), []);
  assert.deepEqual(findAppScreenLoadTracks([app], config).map((e) => e.eventName), ['Fx App Viewed']);
  const questions = getOpenQuestions(buildTickets([app], { config, planEvents: [app] })[0]).join('\n');
  assert.match(questions, /reads like a screen load, but there's no \{\{screen_name\}\}/);
  // ...and an app track carrying screen_name isn't
  assert.deepEqual(findAppScreenLoadTracks([markerTrack('Fx Marked Viewed', 991, 'Mobile', ['screen_name'])], config), []);
});

test('without platformMarkers (or with entries matching the top level) tickets are unchanged', () => {
  const base = loadCompanyConfig();
  const raw = JSON.parse(fs.readFileSync(process.env.COMPANY_CONFIG, 'utf-8'));
  const same = (pageLoad) => normalizeConfig({ ...raw, rules: { pageLoad: { ...raw.rules.pageLoad, ...pageLoad } } });
  const render = (config) => buildTickets(events, { config }).map((t) => [t.summary, t.pageLoad, t.description, getOpenQuestions(t)]);
  const expected = render(base);
  assert.deepEqual(render(same({ platformMarkers: {} })), expected);
  assert.deepEqual(render(same({ platformMarkers: { web: { markerProperty: 'page_name' }, mobile: {} } })), expected);
  assert.deepEqual(findMisfiledTracks(events, same({ platformMarkers: { mobile: {} } })).map((e) => e.eventName), ['Home Viewed']);
  assert.deepEqual(platformRule(base.rules.pageLoad, 'Mobile'), { markerProperty: 'page_name', pageProperties: [], markerReason: 'Reporting reads them as the same page.' });
});

test('the CLI header names each platform\'s marker', () => {
  assert.equal(describeConfig(normalizeConfig({ rules: { pageLoad: { enabled: true } } })), 'page-load rule on (marker: page_name)');
  assert.equal(describeConfig(withMarkers()), 'page-load rule on (markers: web page_name, mobile screen_name)');
  const example = JSON.parse(fs.readFileSync(new URL('../data/company.example.json', import.meta.url), 'utf-8'));
  assert.match(describeConfig(normalizeConfig(example)), /^page-load rule on \(markers: web page_name, mobile screen_name\)/);
});

test('the sample plan under the example config holds Home Viewed back for both markers', () => {
  const example = normalizeConfig(JSON.parse(fs.readFileSync(new URL('../data/company.example.json', import.meta.url), 'utf-8')));
  assert.deepEqual(findMisfiledTracks(events, example).map((e) => e.eventName), ['Home Viewed']);
  assert.deepEqual(misfiledMarkers(events.find((e) => e.eventName === 'Home Viewed'), example), [
    { platform: 'web', marker: 'page_name' },
    { platform: 'mobile', marker: 'screen_name' },
  ]);
  // Checkout Started sends page_name on web; its app ticket isn't a page load (no screen_name)
  const tickets = buildTickets(events, { config: example });
  assert.equal(find(tickets, 'web-track', 'Checkout Started').pageLoad, true);
  assert.equal(find(tickets, 'mobile-track', 'Checkout Started').pageLoad, false);
});

// ─── Per-ticket hold-back and per-ticket page-load properties ───

const exampleConfig = () => normalizeConfig(JSON.parse(fs.readFileSync(new URL('../data/company.example.json', import.meta.url), 'utf-8')));

// Checkout Started as one row for web and app: Page "Checkout" and Screen "Checkout" both exist
function checkoutScenario(extraProps = []) {
  const base = events.find((e) => e.eventName === 'Checkout Started');
  const like = base.properties.find((p) => p.name === 'page_name');
  // (Named apart from the sample's Checkout Started so template overrides can't reroute it)
  const event = {
    ...base,
    eventName: 'Fx Checkout Started',
    sourceRow: 500,
    generatingSource: 'Web; Mobile',
    templates: 'web checkout\nmobile app checkout',
    whenFired: 'Fires when the checkout page/screen loads',
    properties: [...base.properties, ...extraProps.map((name) => ({ ...like, name }))],
  };
  const screen = { ...sampleView('screen', 'Product Detail'), eventName: 'Checkout', sourceRow: 60 };
  return { event, plan: [sampleView('page', 'Checkout'), screen, event] };
}
const section = (description, start, end = '{code}') => description.split(start)[1].split(end)[0];

test('only page_name on a web + app row: the web ticket is generated, the app ticket is held', () => {
  const config = exampleConfig();
  const { event, plan } = checkoutScenario();

  // The event-level API still lists the event; the ticket-level one names the held ticket
  assert.deepEqual(findMisfiledTracks(plan, config).map((e) => e.eventName), ['Fx Checkout Started']);
  assert.deepEqual(findHeldTickets(plan, config).map(({ event: e, platform, marker, templateType, instanceLabel }) => [e.eventName, platform, marker, templateType, instanceLabel]), [
    ['Fx Checkout Started', 'mobile', 'screen_name', 'mobile-track', 'mobile app checkout'],
  ]);

  const built = buildTickets([event], { config, planEvents: plan });
  const { tickets, held } = holdBackTickets(built, { config });
  assert.deepEqual(tickets.map((t) => t.templateType), ['web-track']);
  assert.deepEqual(held.map((t) => [t.templateType, t.heldBack]), [['mobile-track', { platform: 'mobile', marker: 'screen_name' }]]);
  assert.equal(heldTicketMarker(tickets[0], config), null);

  const web = tickets[0];
  assert.equal(web.pageLoad, true);
  assert.equal(web.expectedPageName, 'Checkout');
  assert.match(web.description, /page_name: 'Checkout',/);

  // --include-flagged (or holdMisfiledTracks off) keeps both; the held ticket's question is unchanged
  assert.equal(holdBackTickets(built, { config, includeFlagged: true }).tickets.length, 2);
  const lenient = normalizeConfig({ ...config, rules: { pageLoad: { ...config.rules.pageLoad, holdMisfiledTracks: false } } });
  assert.equal(holdBackTickets(built, { config: lenient }).held.length, 0);
  assert.match(getOpenQuestions(held[0]).join('\n'), /reads like a page\/screen load, but there's no \{\{screen_name\}\}\. If this is a page view, it belongs on the Page\/Screen tab; if it's a track event that fires on page load, add \{\{screen_name\}\}\./);
  // ...and it doesn't ask the app developer to send the web marker
  assert.deepEqual(held[0].properties.filter((p) => p.name === 'page_name'), []);
  assert.match(held[0].description, /\*Not sent on this platform:\* \{\{page_name\}\} \(web page-load property\)/);
});

test('page_name and screen_name on one row: each ticket sends only its own marker set', () => {
  const config = exampleConfig();
  const { event, plan } = checkoutScenario(['old_page_name', 'template_version', 'screen_name', 'old_screen_name', 'shopping_enabled']);
  assert.deepEqual(findMisfiledTracks(plan, config), []);
  assert.deepEqual(findHeldTickets(plan, config), []);

  const { tickets, held } = holdBackTickets(buildTickets([event], { config, planEvents: plan }), { config });
  assert.equal(held.length, 0);
  const web = find(tickets, 'web-track', 'Fx Checkout Started');
  const app = find(tickets, 'mobile-track', 'Fx Checkout Started');
  const names = (t) => t.properties.map((p) => p.name);

  // Web: page_name, old_page_name, template_version; no screen properties anywhere but the note
  for (const name of ['page_name', 'old_page_name', 'template_version', 'shopping_enabled', 'checkout_id']) assert.ok(names(web).includes(name), name);
  for (const name of ['screen_name', 'old_screen_name']) assert.ok(!names(web).includes(name), name);
  assert.deepEqual(web.omittedProperties, [{ name: 'screen_name', platforms: ['mobile'] }, { name: 'old_screen_name', platforms: ['mobile'] }]);
  assert.match(web.description, /\n\n\*Not sent on this platform:\* \{\{screen_name\}\}, \{\{old_screen_name\}\} \(mobile page-load properties\) — the plan row lists them for other platforms' tickets\.\n/);
  const webText = web.description.replace(/\*Not sent on this platform:\*.*\n/, '');
  assert.doesNotMatch(webText, /screen_name/);
  assert.doesNotMatch(section(web.description, '{code:json}'), /screen_name/);
  assert.match(section(web.description, '{code:json}'), /"page_name": "Checkout"/);
  assert.match(web.description, /except for `page_name` property \(must match the page name exactly\)\n \*\* except for `old_page_name` property/);
  assert.doesNotMatch(web.description, /except for `old_screen_name`/);

  // App: screen_name (the Screen's name), old_screen_name; no page properties anywhere but the note
  for (const name of ['screen_name', 'old_screen_name', 'shopping_enabled', 'checkout_id']) assert.ok(names(app).includes(name), name);
  for (const name of ['page_name', 'old_page_name', 'template_version']) assert.ok(!names(app).includes(name), name);
  assert.equal(app.pageLoad, true);
  assert.equal(app.expectedPageName, 'Checkout');
  assert.match(app.description, /\*Not sent on this platform:\* \{\{page_name\}\}, \{\{old_page_name\}\}, \{\{template_version\}\} \(web page-load properties\)/);
  const appText = app.description.replace(/\*Not sent on this platform:\*.*\n/, '');
  assert.doesNotMatch(appText, /page_name|template_version/);
  assert.match(section(app.description, '{code:javascript}'), /screen_name: 'Checkout',[\s\S]*old_screen_name:/);
  assert.match(section(app.description, '{code:json}'), /"screen_name": "Checkout"/);
  assert.match(app.description, /\|\{\{old_screen_name\}\}\|/);
  assert.match(app.description, /except for `screen_name` property \(must match the screen name exactly\)\n \*\* except for `old_screen_name` property`?$/m);
  assert.doesNotMatch(app.description, /except for `old_page_name`/);
  // Open questions only cover what the ticket sends
  assert.doesNotMatch(getOpenQuestions(app).join('\n'), /page_name|template_version/);
});

test('page/screen tickets also leave off other platforms\' page-load properties', () => {
  const config = exampleConfig();
  const page = { ...sampleView('page', 'Checkout') };
  page.properties = [...page.properties, { ...page.properties[0], name: 'screen_name' }];
  const [ticket] = buildTickets([page], { config, planEvents: [page] });
  assert.deepEqual(ticket.properties.map((p) => p.name), ['old_page_name', 'template_version', 'cart_value']);
  assert.match(ticket.description, /\*Not sent on this platform:\* \{\{screen_name\}\} \(mobile page-load property\)/);
});

test('without platformMarkers nothing is left off and no ticket is held for another platform', () => {
  const config = loadCompanyConfig();
  const { event, plan } = checkoutScenario(['old_page_name', 'screen_name', 'old_screen_name']);
  const tickets = buildTickets([event], { config, planEvents: plan });
  for (const t of tickets) {
    assert.equal(t.omittedProperties, undefined, t.summary);
    assert.ok(t.properties.some((p) => p.name === 'screen_name') && t.properties.some((p) => p.name === 'page_name'), t.summary);
    assert.doesNotMatch(t.description, /Not sent on this platform|except for `old_screen_name`/, t.summary);
    assert.match(t.description, /except for `old_page_name` property/, t.summary);
  }
  // Rules off: nothing is held or left off
  assert.deepEqual(findHeldTickets(plan, RULES_OFF), []);
  assert.ok(buildTickets([event], { config: RULES_OFF, planEvents: plan }).every((t) => !t.heldBack && !t.omittedProperties));
});

test('Home Viewed: only the tickets on hold platforms are held', () => {
  // Fixture config (web only): the web ticket is held, the app ticket is generated with the question
  const fixture = loadCompanyConfig();
  const home = events.filter((e) => e.eventName === 'Home Viewed');
  assert.deepEqual(findHeldTickets(events, fixture).map((h) => [h.event.eventName, h.platform, h.marker]), [['Home Viewed', 'web', 'page_name']]);
  const { tickets, held } = holdBackTickets(buildTickets(home, { config: fixture, planEvents: events }), { config: fixture });
  assert.deepEqual([tickets.map((t) => t.platform), held.map((t) => t.platform)], [['Mobile'], ['Web']]);
  assert.match(getOpenQuestions(tickets[0]).join('\n'), /belongs on the Page\/Screen tab/);

  // Example config (web + mobile markers): both are held
  const example = exampleConfig();
  assert.deepEqual(findHeldTickets(events, example).map((h) => [h.platform, h.marker]), [['web', 'page_name'], ['mobile', 'screen_name']]);
  assert.equal(holdBackTickets(buildTickets(home, { config: example, planEvents: events }), { config: example }).tickets.length, 0);
});
