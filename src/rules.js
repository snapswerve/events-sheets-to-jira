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
 *     `notPageLoads` lists tracks that carry the marker but don't fire on a page load
 *   - Track events whose trigger reads like a page/screen load but have no marker are flagged as
 *     likely misfiled (they belong on the Page/Screen tab) and held back from ticketing
 *
 * Wrappers (wrappers.web / .mobile / .server): a company's own tracking helper (e.g. a global analytics abstraction).
 *   providesProperties are set by the wrapper, so snippets leave them out and the table says so;
 *   snippets.track / .page / .screen / .identify replace the default SDK call, with {{name}}
 *   (the event/page name) and {{props}} (the properties object) filled in.
 *
 * Notes: { title, body, when } — `when` keys must all match:
 *   pageLoad (true/false), platforms (web/mobile/server), tabTypes (track/identify/page/screen),
 *   templateTypes (web-track, ...), hasProperty (name or list), productSections, teams
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_CONFIG_PATH = new URL('../data/company.json', import.meta.url);

const PAGE_LOAD_DEFAULTS = {
  enabled: false,
  markerProperty: 'page_name',
  markerReason: 'This lets reporting treat this event and the page view as the same page.',
  holdMisfiledTracks: true,
  pageNames: {},
  notPageLoads: [],
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
  return {
    rules: {
      pageLoad: { ...PAGE_LOAD_DEFAULTS, ...(raw.rules?.pageLoad || {}) },
    },
    wrappers: raw.wrappers || {},
    notes: (raw.notes || []).filter((note) => note.title && note.body),
  };
}

/** One-line description of what's switched on, for the CLI header. */
export function describeConfig(config) {
  const parts = [];
  const pageLoad = config.rules.pageLoad;
  if (pageLoad.enabled) parts.push(`page-load rule on (marker: ${pageLoad.markerProperty})`);
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
  return events.filter((e) => e.tabType === 'track' && !hasProperty(e, rule.markerProperty) && looksLikeLoad(e));
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

  const tracksByPage = new Map();
  if (rule.enabled) {
    for (const e of planEvents) {
      if (e.tabType !== 'track' || !isPageLoadTrack(e, rule)) continue;
      const match = rule.pageNames[e.eventName] || matchPageName(e.eventName, [...pageNames, ...screenNames]);
      if (!match) continue;
      const key = match.toLowerCase();
      if (!tracksByPage.has(key)) tracksByPage.set(key, []);
      if (!tracksByPage.get(key).includes(e.eventName)) tracksByPage.get(key).push(e.eventName);
    }
  }

  const misfiledRows = new Set(findMisfiledTracks(planEvents, config).map(rowKey));
  return { config, pageNames, screenNames, tracksByPage, misfiledRows };
}

/**
 * Returns the ticket with rule results attached:
 *   pageLoad, expectedPageName, ruleQuestions (open questions), ruleNotes (sections to insert)
 */
export function applyRules(ticket, ctx) {
  const rule = ctx.config.rules.pageLoad;
  const out = { ...ticket, pageLoad: false, ruleQuestions: [], ruleNotes: [] };

  if (rule.enabled) {
    const marker = rule.markerProperty;
    out.pageLoad = ticket.tabType === 'page' || ticket.tabType === 'screen' || (ticket.tabType === 'track' && isPageLoadTrack(ticket, rule));

    if (ticket.tabType === 'track' && out.pageLoad) {
      // Prefer the platform's own list: Page names for web, Screen names for mobile
      const names = ticket.platform === 'Mobile' ? [...ctx.screenNames, ...ctx.pageNames] : [...ctx.pageNames, ...ctx.screenNames];
      const expected = rule.pageNames[ticket.eventName] || matchPageName(ticket.eventName, names);
      if (expected) {
        out.expectedPageName = expected;
        out.properties = ticket.properties.map((p) => (p.name.toLowerCase() === marker.toLowerCase() ? { ...p, expectedValue: expected } : p));
        out.ruleNotes.push({
          title: 'Page name',
          body: `Set {{${marker}}} to {{${expected}}}, exactly the name the *${expected}* page/screen event uses. ${rule.markerReason}`,
        });
      } else {
        out.ruleQuestions.push(`No Page or Screen event in the plan matches "${ticket.eventName}" — confirm the exact {{${marker}}} value (or set it under pageLoad.pageNames in the company config). ${rule.markerReason}`);
      }
    }

    if ((ticket.tabType === 'page' || ticket.tabType === 'screen') && ticket.eventName) {
      const tracks = ctx.tracksByPage.get(ticket.eventName.toLowerCase()) || [];
      if (tracks.length > 0) {
        out.ruleNotes.push({
          title: 'Page name',
          body: `This ${ticket.tabType} name, {{${ticket.eventName}}}, must exactly match {{${marker}}} on the page-load track events for this ${ticket.tabType}: ${tracks.join(', ')}. ${rule.markerReason}`,
        });
      }
    }

    if (ctx.misfiledRows.has(rowKey(ticket))) {
      out.ruleQuestions.push(`The trigger reads like a page/screen load, but there's no {{${marker}}}. If this is a page view, it belongs on the Page/Screen tab; if it's a track event that fires on page load, add {{${marker}}}.`);
    }
  }

  const wrapper = ctx.config.wrappers[String(ticket.platform || '').toLowerCase()];
  if (wrapper) {
    out.wrapper = {
      name: wrapper.name || 'the tracking wrapper',
      provides: (wrapper.providesProperties || []).map((p) => p.toLowerCase()),
      snippet: wrapper.snippets?.[ticket.templateType.split('-')[1]],
      lang: wrapper.lang || 'javascript',
    };
  }

  out.ruleNotes.push(...ctx.config.notes.filter((note) => noteApplies(note, out)).map(({ title, body }) => ({ title, body })));
  return out;
}

function isPageLoadTrack(event, rule) {
  const excluded = rule.notPageLoads.map((name) => name.toLowerCase());
  return hasProperty(event, rule.markerProperty) && !excluded.includes(String(event.eventName || '').toLowerCase());
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
