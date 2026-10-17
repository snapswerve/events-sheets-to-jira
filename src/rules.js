/**
 * rules.js — Company-specific rules and conditional notes, from a local config file.
 *
 * The config (data/company.json, gitignored — or COMPANY_CONFIG=path/to/file.json) turns rules
 * on/off and holds notes inserted into tickets whose event matches conditions. With no config
 * file nothing runs, so the tool stays generic when forked for another product.
 *
 * Page-load rule (rules.pageLoad):
 *   - A ticket is a page load if it's a page/screen event, or a track event carrying the marker
 *     property (page_name by default)
 *   - Page-load tracks get the marker's expected value: the name of the Page/Screen event they
 *     belong to, so downstream reporting reads the track and the page view as the same page.
 *     `pageNames` ({ "Model Viewed": "Model" }) sets it for pages with no Page/Screen event;
 *     `notPageLoads` lists tracks that carry the marker but don't fire on a page load; if they still
 *     carry any `pageProperties` (page_name by default), the ticket asks for them to be removed
 *   - Track events whose trigger reads like a page/screen load but have no marker are flagged as
 *     likely misfiled (they belong on the Page/Screen tab) and held back from ticketing — but only
 *     when the event routes to a platform in `holdMisfiledPlatforms` and lacks that platform's marker.
 *     Not set, it's web plus every platform with a `platformMarkers` entry. App ones that aren't held
 *     are ticketed with an open question instead (`appScreenLoadQuestion`), since how app screen loads
 *     should show in reporting can differ from web page loads; server-only ones are skipped
 *   - `platformMarkers` ({ "mobile": { "markerProperty": "screen_name", "pageProperties": [...],
 *     "markerReason": "..." } }) gives a platform (web / mobile / server) its own marker, page
 *     properties and reason; platforms without an entry use the top-level ones. Each ticket uses its
 *     own platform's, e.g. app screen-load tracks carry screen_name while web page loads carry page_name
 *
 * Wrappers (wrappers.web / .mobile / .server): a company's own tracking helper (e.g. a global analytics abstraction).
 *   providesProperties are set by the wrapper, so snippets leave them out and the table says so;
 *   snippets.track / .page / .screen / .identify replace the default SDK call, with {{name}}
 *   (the event/page name) and {{props}} (the properties object) filled in. setsUserId: true means
 *   the wrapper identifies the user itself, so tickets don't ask developers to pass a user ID.
 *
 * Notes: { title, body, when } — `when` keys must all match:
 *   pageLoad (true/false), platforms (web/mobile/server), tabTypes (track/identify/page/screen),
 *   templateTypes (web-track, ...), hasProperty (name or list), productSections, teams
 */

import fs from 'fs';
import path from 'path';
import { resolveInstances } from './mapper.js';

const DEFAULT_CONFIG_PATH = new URL('../data/company.json', import.meta.url);

const PAGE_LOAD_DEFAULTS = {
  enabled: false,
  markerProperty: 'page_name',
  markerReason: 'This lets reporting treat this event and the page view as the same page.',
  holdMisfiledTracks: true,
  // Platforms (web / mobile / server) whose misfiled tracks are held back; others get appScreenLoadQuestion.
  // Not set in the config: web plus every platform with a platformMarkers entry (see normalizeConfig)
  holdMisfiledPlatforms: ['web'],
  // Open question for app tracks that read like a screen load but have no marker. {{marker}} is replaced
  appScreenLoadQuestion:
    "The trigger reads like a screen load, but there's no {{marker}}. Decide how app screen loads should show in reporting (Adobe Analytics, for one, keeps app screens and web pages in the same Page Name): send {{marker}} with the screen's exact name, or whatever property your reporting setup uses for screens.",
  pageNames: {},
  notPageLoads: [],
  pageProperties: [],
  // Per-platform overrides of markerProperty / pageProperties / markerReason, keyed web / mobile / server
  platformMarkers: {},
};

let configCache;

/**
 * Reads the company config once. Missing file = no rules, no notes.
 */
export function loadCompanyConfig() {
  if (configCache) return configCache;

  const configPath = process.env.COMPANY_CONFIG ? path.resolve(process.env.COMPANY_CONFIG) : DEFAULT_CONFIG_PATH;
  let raw = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      console.warn(`⚠️  Could not parse ${configPath} — running without company rules (${err.message})`);
    }
  }
  configCache = normalizeConfig(raw);
  return configCache;
}

export function normalizeConfig(raw = {}) {
  const rawPageLoad = raw.rules?.pageLoad || {};
  const pageLoad = { ...PAGE_LOAD_DEFAULTS, ...rawPageLoad };
  // An explicit holdMisfiledPlatforms wins; otherwise web plus every platform given its own marker
  if (!Object.prototype.hasOwnProperty.call(rawPageLoad, 'holdMisfiledPlatforms')) {
    pageLoad.holdMisfiledPlatforms = [...new Set(['web', ...platformMarkerKeys(pageLoad)])];
  }
  return {
    rules: {
      pageLoad,
    },
    wrappers: raw.wrappers || {},
    notes: (raw.notes || []).filter((note) => note.title && note.body),
  };
}

/** One-line description of what's switched on, for the CLI header. */
export function describeConfig(config) {
  const parts = [];
  const pageLoad = config.rules.pageLoad;
  if (pageLoad.enabled) {
    const keys = platformMarkerKeys(pageLoad);
    if (keys.length === 0) {
      parts.push(`page-load rule on (marker: ${pageLoad.markerProperty})`);
    } else {
      const markers = [...new Set(['web', 'mobile', ...keys])].map((p) => `${p} ${platformRule(pageLoad, p).markerProperty}`);
      parts.push(`page-load rule on (markers: ${markers.join(', ')})`);
    }
  }
  for (const [platform, wrapper] of Object.entries(config.wrappers)) {
    parts.push(`${platform} wrapper${wrapper.name ? ` (${wrapper.name})` : ''}`);
  }
  if (config.notes.length > 0) parts.push(`${config.notes.length} conditional note${config.notes.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

// ─── Page-load rule ───

/**
 * Track events that read like a page/screen load but don't carry the marker property —
 * usually page views filed on the Track tab. Empty when the rule is off.
 */
export function findMisfiledTracks(events, config) {
  const rule = config.rules.pageLoad;
  if (!rule.enabled) return [];
  return events.filter((e) => missingMarkers(e, rule).length > 0);
}

/**
 * Why a track event is misfiled: [{ platform, marker }] for each routed platform in
 * holdMisfiledPlatforms whose marker the event doesn't carry, when its trigger reads like a load.
 * Empty when it isn't misfiled (or the rule is off).
 */
export function misfiledMarkers(event, config) {
  const rule = config.rules.pageLoad;
  return rule.enabled ? missingMarkers(event, rule) : [];
}

function missingMarkers(event, rule) {
  if (event.tabType !== 'track' || !looksLikeLoad(event)) return [];
  const holdOn = lowerList(rule.holdMisfiledPlatforms);
  return eventPlatforms(event)
    .filter((p) => holdOn.includes(p))
    .map((platform) => ({ platform, marker: platformRule(rule, platform).markerProperty }))
    .filter(({ marker }) => !hasProperty(event, marker));
}

/**
 * Track events that read like a load, route to app (mobile) tickets and lack the mobile marker, but
 * aren't held back because mobile isn't in holdMisfiledPlatforms — they're ticketed with the
 * appScreenLoadQuestion instead. Server-only events are left alone: a server call isn't a screen load.
 */
export function findAppScreenLoadTracks(events, config) {
  const rule = config.rules.pageLoad;
  if (!rule.enabled || lowerList(rule.holdMisfiledPlatforms).includes('mobile')) return [];
  const held = new Set(findMisfiledTracks(events, config).map(rowKey));
  const marker = platformRule(rule, 'mobile').markerProperty;
  return events.filter(
    (e) => e.tabType === 'track' && !hasProperty(e, marker) && looksLikeLoad(e) && !held.has(rowKey(e)) && eventPlatforms(e).includes('mobile'),
  );
}

/**
 * The marker, page properties and reason a platform's tickets use: its platformMarkers entry
 * (keys compared case-insensitively), falling back to the top-level values.
 */
export function platformRule(rule, platform) {
  const entry = platformEntry(rule, platform) || {};
  const text = (value) => typeof value === 'string' && value !== '';
  return {
    markerProperty: text(entry.markerProperty) ? entry.markerProperty : rule.markerProperty,
    pageProperties: Array.isArray(entry.pageProperties) ? entry.pageProperties : rule.pageProperties,
    markerReason: text(entry.markerReason) ? entry.markerReason : rule.markerReason,
  };
}

function platformEntry(rule, platform) {
  const key = String(platform || '').toLowerCase();
  let found = null;
  for (const [name, entry] of Object.entries(isObject(rule.platformMarkers) ? rule.platformMarkers : {})) {
    if (name.toLowerCase() === key && isObject(entry)) found = entry;
  }
  return found;
}

/** The platforms (lowercased, once each) with a platformMarkers entry. */
function platformMarkerKeys(rule) {
  const markers = isObject(rule.platformMarkers) ? rule.platformMarkers : {};
  return [...new Set(Object.keys(markers).filter((name) => isObject(markers[name])).map((name) => name.toLowerCase()))];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The platforms an event's tickets route to (web / mobile / server), using the same routing as the tickets. */
function eventPlatforms(event) {
  return [...new Set(resolveInstances(event).map((i) => String(i.platform || '').toLowerCase()))];
}

function lowerList(value) {
  return [].concat(value || []).map((v) => String(v).toLowerCase());
}

function looksLikeLoad(event) {
  const trigger = String(event.whenFired || '');
  if (!/\bload(s|ed|ing)?\b/i.test(trigger)) return false;
  return /\b(page|screen)s?\b/i.test(trigger) || /\b(viewed|loaded)$/i.test(String(event.eventName || '').trim());
}

/**
 * Plan-wide lookups the rule needs: Page/Screen names, and which page-load tracks map to each.
 * Built from every event in the plan, not just the filtered selection.
 */
export function buildRuleContext(planEvents, config) {
  const rule = config.rules.pageLoad;
  const pageNames = planEvents.filter((e) => e.tabType === 'page' && e.eventName).map((e) => e.eventName);
  const screenNames = planEvents.filter((e) => e.tabType === 'screen' && e.eventName).map((e) => e.eventName);

  // Page tickets (web) list the tracks carrying the web marker; screen tickets (mobile) the mobile one
  const tracksFor = (platform) => {
    const byName = new Map();
    if (!rule.enabled) return byName;
    const platformLoad = { ...rule, ...platformRule(rule, platform) };
    for (const e of planEvents) {
      if (e.tabType !== 'track' || !isPageLoadTrack(e, platformLoad)) continue;
      const match = rule.pageNames[e.eventName] || matchPageName(e.eventName, [...pageNames, ...screenNames]);
      if (!match) continue;
      const key = match.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      if (!byName.get(key).includes(e.eventName)) byName.get(key).push(e.eventName);
    }
    return byName;
  };
  const tracksByPage = tracksFor('web');
  const tracksByScreen = tracksFor('mobile');

  const missingByRow = new Map();
  for (const e of findMisfiledTracks(planEvents, config)) missingByRow.set(rowKey(e), missingMarkers(e, rule));
  const misfiledRows = new Set(missingByRow.keys());
  const appScreenLoadRows = new Set(findAppScreenLoadTracks(planEvents, config).map(rowKey));
  return { config, pageNames, screenNames, tracksByPage, tracksByScreen, misfiledRows, missingByRow, appScreenLoadRows };
}

/**
 * Returns the ticket with rule results attached:
 *   pageLoad, expectedPageName, ruleQuestions (open questions), ruleNotes (sections to insert)
 */
export function applyRules(ticket, ctx) {
  const rule = ctx.config.rules.pageLoad;
  const out = { ...ticket, pageLoad: false, ruleQuestions: [], ruleNotes: [] };

  if (rule.enabled) {
    // This ticket's platform marker, page properties and reason (platformMarkers, else the top-level ones)
    const platformLoad = { ...rule, ...platformRule(rule, ticket.platform) };
    const marker = platformLoad.markerProperty;
    out.markerProperty = marker;
    out.pageLoad = ticket.tabType === 'page' || ticket.tabType === 'screen' || (ticket.tabType === 'track' && isPageLoadTrack(ticket, platformLoad));

    if (ticket.tabType === 'track' && out.pageLoad) {
      // Prefer the platform's own list: Page names for web, Screen names for mobile
      const names = ticket.platform === 'Mobile' ? [...ctx.screenNames, ...ctx.pageNames] : [...ctx.pageNames, ...ctx.screenNames];
      const expected = rule.pageNames[ticket.eventName] || matchPageName(ticket.eventName, names);
      if (expected) {
        out.expectedPageName = expected;
        out.properties = ticket.properties.map((p) => (p.name.toLowerCase() === marker.toLowerCase() ? { ...p, expectedValue: expected } : p));
        out.ruleNotes.push({
          title: 'Page name',
          body: `Set {{${marker}}} to {{${expected}}}, exactly the name the *${expected}* page/screen event uses. ${platformLoad.markerReason}`,
        });
      } else {
        out.ruleQuestions.push(`No Page or Screen event in the plan matches "${ticket.eventName}" — confirm the exact {{${marker}}} value (or set it under pageLoad.pageNames in the company config). ${platformLoad.markerReason}`);
      }
    }

    if ((ticket.tabType === 'page' || ticket.tabType === 'screen') && ticket.eventName) {
      const byName = (ticket.tabType === 'screen' ? ctx.tracksByScreen : ctx.tracksByPage) || ctx.tracksByPage;
      const tracks = byName.get(ticket.eventName.toLowerCase()) || [];
      if (tracks.length > 0) {
        out.ruleNotes.push({
          title: 'Page name',
          body: `This ${ticket.tabType} name, {{${ticket.eventName}}}, must exactly match {{${marker}}} on the page-load track events for this ${ticket.tabType}: ${tracks.join(', ')}. ${platformLoad.markerReason}`,
        });
      }
    }

    if (ticket.tabType === 'track' && isExcluded(ticket, rule)) {
      const pageProps = [...new Set([marker, ...platformLoad.pageProperties].map((p) => p.toLowerCase()))].filter((p) => hasProperty(ticket, p));
      if (pageProps.length > 0) {
        out.ruleQuestions.push(`This event doesn't fire on a page load, so page properties shouldn't be sent: ${pageProps.map((p) => `{{${p}}}`).join(', ')} — remove them from the plan.`);
      }
    }

    if (ctx.misfiledRows.has(rowKey(ticket))) {
      out.ruleQuestions.push(misfiledQuestion(ctx.missingByRow?.get(rowKey(ticket)) || [], marker));
    } else if (ctx.appScreenLoadRows?.has(rowKey(ticket)) && ticket.platform === 'Mobile') {
      out.ruleQuestions.push(String(rule.appScreenLoadQuestion).split('{{marker}}').join(`{{${marker}}}`));
    }
  }

  const wrapper = ctx.config.wrappers[String(ticket.platform || '').toLowerCase()];
  if (wrapper) {
    out.wrapper = {
      name: wrapper.name || 'the tracking wrapper',
      provides: (wrapper.providesProperties || []).map((p) => p.toLowerCase()),
      snippet: wrapper.snippets?.[ticket.templateType.split('-')[1]],
      lang: wrapper.lang || 'javascript',
      setsUserId: Boolean(wrapper.setsUserId),
    };
  }

  out.ruleNotes.push(...ctx.config.notes.filter((note) => noteApplies(note, out)).map(({ title, body }) => ({ title, body })));
  return out;
}

/**
 * The misfiled question. When the only missing marker is the ticket's own, it names just that marker;
 * otherwise each missing marker with its platforms ("{{page_name}} on web or {{screen_name}} on mobile").
 */
function misfiledQuestion(missing, marker) {
  const groups = [];
  for (const { platform, marker: name } of missing) {
    let group = groups.find((g) => g.marker === String(name));
    if (!group) groups.push((group = { marker: String(name), platforms: [] }));
    group.platforms.push(platform);
  }
  if (groups.length === 0 || (groups.length === 1 && groups[0].marker === String(marker))) {
    return `The trigger reads like a page/screen load, but there's no {{${marker}}}. If this is a page view, it belongs on the Page/Screen tab; if it's a track event that fires on page load, add {{${marker}}}.`;
  }
  const parts = groups.map((g) => `{{${g.marker}}} on ${joinWords(g.platforms)}`);
  return `The trigger reads like a page/screen load, but there's no ${parts.join(' or ')}. If this is a page view, it belongs on the Page/Screen tab; if it's a track event that fires on page load, add ${parts.join(' and ')}.`;
}

/** "a", "a and b", "a, b and c" */
function joinWords(words) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function isPageLoadTrack(event, rule) {
  return hasProperty(event, rule.markerProperty) && !isExcluded(event, rule);
}

function isExcluded(event, rule) {
  return rule.notPageLoads.map((name) => name.toLowerCase()).includes(String(event.eventName || '').toLowerCase());
}

/**
 * The longest Page/Screen name that appears in the event name ("Checkout Step Viewed" →
 * "Checkout"), or that contains the event name minus its verb ("Overview Viewed" →
 * "Product Overview"). '' when nothing matches.
 */
export function matchPageName(eventName, names) {
  const event = normalize(eventName);
  if (!event) return '';
  const stem = event.includes(' ') ? event.replace(/ \S+$/, '') : event;

  let best = '';
  for (const name of names) {
    const n = normalize(name);
    if (!n) continue;
    const matches = containsWords(event, n) || containsWords(n, stem);
    if (matches && n.length > normalize(best).length) best = name;
  }
  return best;
}

// ─── Note conditions ───

export function noteApplies(note, ticket) {
  const when = note.when || {};
  const lower = (list) => [].concat(list).map((v) => String(v).toLowerCase());

  if (when.pageLoad !== undefined && Boolean(when.pageLoad) !== Boolean(ticket.pageLoad)) return false;
  if (when.platforms && !lower(when.platforms).includes(String(ticket.platform || '').toLowerCase())) return false;
  if (when.tabTypes && !lower(when.tabTypes).includes(ticket.tabType)) return false;
  if (when.templateTypes && !lower(when.templateTypes).includes(ticket.templateType)) return false;
  if (when.hasProperty && !lower(when.hasProperty).some((name) => hasProperty(ticket, name))) return false;
  if (when.productSections && !lower(when.productSections).includes(String(ticket.productSection || '').toLowerCase())) return false;
  if (when.teams && !lower(when.teams).includes(String(ticket.teamOwnership || '').toLowerCase())) return false;
  return true;
}

// ─── Helpers ───

/** Identifies an event across ticket copies: its tab and row in the plan. */
export function rowKey(event) {
  return `${event.tabType}:${event.sourceRow}`;
}

function hasProperty(event, name) {
  const fields = (event.tabType === 'identify' ? event.traits : event.properties) || [];
  return fields.some((f) => f.name.toLowerCase() === String(name).toLowerCase());
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsWords(haystack, needle) {
  return ` ${haystack} `.includes(` ${needle} `);
}
