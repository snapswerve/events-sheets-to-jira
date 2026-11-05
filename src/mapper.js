/**
 * mapper.js — Maps each event to one or more Jira ticket instances.
 *
 * Core rule: template instances are the source of truth for permutations.
 *
 * Routing strategy:
 * 1) Infer source family from template label first (web/mobile/ss)
 * 2) Fall back to Generating Source only when template is ambiguous/missing
 *
 * Track events, per template instance (see scopeTrackInstance):
 * - A property row's Templates cell scopes it to those templates (empty = every template).
 * - A live event (a property row whose Implement Status is past Not Started) gets, for a template
 *   that already has live rows, an update ticket listing only its Not Started rows, or no ticket
 *   when none apply. A template with no live rows is new and keeps the full ticket.
 */

import fs from 'fs';
import path from 'path';
import { fingerprintLabel } from './jira-fields.js';
import { parseTemplatesList } from './parser.js';

const TEMPLATE_HINTS = {
  ss: ['server side', 'server', 'backend'],
  mobile: ['mobile', 'app', 'native', 'ios', 'android', 'screen'],
  web: ['web', 'page', 'browser'],
};

/**
 * Loads template overrides from JSON file if it exists.
 * Returns a Map of eventName → string[]
 */
function loadTemplateOverrides() {
  const overridesPath = path.resolve('./data/template-overrides.json');
  if (!fs.existsSync(overridesPath)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'));
    const map = new Map();
    for (const [key, val] of Object.entries(raw)) {
      if (key.startsWith('_')) continue;
      if (Array.isArray(val)) map.set(key, val);
    }
    return map;
  } catch {
    console.warn('⚠️  Could not parse template-overrides.json — using xlsx templates');
    return new Map();
  }
}

const templateOverrides = loadTemplateOverrides();

export function resolveInstances(event) {
  if (event.tabType === 'page') {
    return [{
      templateType: 'web-page',
      instanceLabel: `${event.eventName} page`,
      platform: 'Web',
      routingReason: 'tab-fixed',
    }];
  }

  if (event.tabType === 'screen') {
    return [{
      templateType: 'mobile-screen',
      instanceLabel: `${event.eventName} screen`,
      platform: 'Mobile',
      routingReason: 'tab-fixed',
    }];
  }

  if (event.tabType === 'identify') {
    return resolveIdentifyInstances(event);
  }

  return resolveTrackInstances(event);
}

function resolveTrackInstances(event) {
  const source = (event.generatingSource || '').toLowerCase();
  const overrideList = templateOverrides.get(event.eventName);
  const templatesList = overrideList || parseTemplatesList(event.templates);

  // If templates exist, each row is one ticket instance (preserve duplicates intentionally)
  if (templatesList.length > 0) {
    return templatesList.map((tmpl) => {
      const familyFromTemplate = inferFamilyFromTemplate(tmpl);
      let family = familyFromTemplate;

      // For mixed Web/Mobile sources with ambiguous template names, default to Web (safer than Mobile over-routing)
      if (!family) {
        if (source.includes('web') && source.includes('mobile')) {
          family = 'web';
        } else {
          family = inferFamilyFromSource(source) || 'web';
        }
      }

      return {
        templateType: `${family}-track`,
        instanceLabel: tmpl,
        platform: familyToPlatform(family),
        routingReason: familyFromTemplate ? 'template-keyword' : 'source-fallback',
      };
    });
  }

  // No templates listed → infer from source
  return fallbackInstancesBySource('track', source);
}

function resolveIdentifyInstances(event) {
  const source = (event.generatingSource || '').toLowerCase();
  const templatesList = parseTemplatesList(event.templates);

  if (templatesList.length > 0) {
    return templatesList.map((tmpl) => {
      const familyFromTemplate = inferFamilyFromTemplate(tmpl);
      const family = familyFromTemplate || inferFamilyFromSource(source) || 'web';
      return {
        templateType: `${family}-identify`,
        instanceLabel: tmpl,
        platform: familyToPlatform(family),
        routingReason: familyFromTemplate ? 'template-keyword' : 'source-fallback',
      };
    });
  }

  return fallbackInstancesBySource('identify', source);
}

function fallbackInstancesBySource(callType, source) {
  const instances = [];
  const hasWeb = source.includes('web');
  const hasMobile = source.includes('mobile');
  const hasServer = source.includes('server') || source.includes('ss') || source.includes('backend');

  if (hasServer) {
    instances.push({
      templateType: `ss-${callType}`,
      instanceLabel: 'server side',
      platform: 'Server',
      routingReason: 'source-fallback',
    });
  }

  if (hasWeb) {
    instances.push({
      templateType: `web-${callType}`,
      instanceLabel: callType === 'identify' ? 'web identify' : 'web',
      platform: 'Web',
      routingReason: 'source-fallback',
    });
  }

  if (hasMobile) {
    instances.push({
      templateType: `mobile-${callType}`,
      instanceLabel: callType === 'identify' ? 'mobile identify' : 'mobile app',
      platform: 'Mobile',
      routingReason: 'source-fallback',
    });
  }

  if (instances.length === 0) {
    instances.push({
      templateType: `web-${callType}`,
      instanceLabel: 'default',
      platform: 'Web',
      routingReason: 'default-fallback',
    });
  }

  return instances;
}

function inferFamilyFromTemplate(templateName = '') {
  const t = String(templateName).toLowerCase().trim();
  if (!t) return null;

  // Strong disambiguators first
  if (t.includes('chat mobile')) return 'mobile';
  if (t.includes('chat web')) return 'web';
  if (t === 'checkout success' || t.includes('checkout success')) return 'web';

  // SS should only match clear server-side indicators (avoid matching the letters "ss" in words like "success")
  if (t.includes('server side') || t.includes('server') || t.includes('backend')) return 'ss';

  for (const hint of TEMPLATE_HINTS.mobile) {
    if (t.includes(hint)) return 'mobile';
  }
  for (const hint of TEMPLATE_HINTS.web) {
    if (t.includes(hint)) return 'web';
  }

  return null;
}

function inferFamilyFromSource(source = '') {
  const s = String(source).toLowerCase();
  if (!s) return null;
  if (s.includes('server') || s.includes('ss') || s.includes('backend')) return 'ss';
  if (s.includes('mobile')) return 'mobile';
  if (s.includes('web')) return 'web';
  return null;
}

function familyToPlatform(family) {
  if (family === 'ss') return 'Server';
  if (family === 'mobile') return 'Mobile';
  return 'Web';
}

/**
 * Main export: takes all parsed events and returns a flat list of ticket instances.
 */
export function mapEventsToInstances(events) {
  const tickets = [];

  for (const event of events) {
    const instances = resolveInstances(event);
    const seen = new Map();
    for (const instance of instances) {
      const base = {
        ...event,
        templateType: instance.templateType,
        instanceLabel: instance.instanceLabel,
        platform: instance.platform,
        routingReason: instance.routingReason,
      };
      const dupKey = `${instance.templateType}|${instance.instanceLabel}`.toLowerCase();
      seen.set(dupKey, (seen.get(dupKey) || 0) + 1);
      const ticket = event.tabType === 'track' ? scopeTrackInstance(base) : base;
      if (!ticket) continue; // live template with nothing new
      ticket.fingerprint = fingerprintLabel(ticket, seen.get(dupKey));
      tickets.push(ticket);
    }
  }

  return tickets;
}

// ─── Live events and template scope (Track tab) ───

const NOT_STARTED = 'not started';

/** True when a row's Implement Status is past Not Started (Prioritized, Dev In Progress, QA on Stage, On Prod, ...). */
export function isLiveStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return s !== '' && s !== NOT_STARTED;
}

export function isNotStarted(status) {
  return String(status || '').trim().toLowerCase() === NOT_STARTED;
}

/** True when a property row applies to a template: no scope on the row, or the template is listed. */
export function appliesToTemplate(prop, instanceLabel) {
  const scope = prop.templateScope || [];
  if (scope.length === 0) return true;
  const label = String(instanceLabel || '').trim().toLowerCase();
  return scope.some((t) => t.toLowerCase() === label);
}

/** True when any property row of the event is past Not Started. */
export function isLiveEvent(event) {
  return (event.properties || []).some((p) => isLiveStatus(p.implementStatus));
}

/**
 * Narrows one track ticket instance to the property rows that apply to its template, and turns it
 * into an update ticket when the template is already live. Returns null when a live template has no
 * new rows (nothing to ticket).
 *
 * An update ticket keeps every applicable row in `properties` (the page-load rule needs the full
 * picture, e.g. page_name on a live page-load track) and lists the new ones in `update.properties`;
 * pipeline.js narrows the rendered ticket to those after the rules run.
 */
function scopeTrackInstance(ticket) {
  const all = ticket.properties || [];
  const applicable = all.filter((p) => appliesToTemplate(p, ticket.instanceLabel));
  const scoped = { ...ticket, properties: applicable };
  if (!isLiveEvent(ticket) || !applicable.some((p) => isLiveStatus(p.implementStatus))) {
    return scoped; // not live, or a template new to a live event: the full ticket
  }
  const added = applicable.filter((p) => isNotStarted(p.implementStatus));
  if (added.length === 0) return null;
  const unknown = applicable.filter((p) => !String(p.implementStatus || '').trim()).map((p) => p.name);
  return {
    ...scoped,
    update: { properties: added.map((p) => p.name), blankStatus: unknown },
    updateKey: added.map((p) => p.name.toLowerCase()).sort().join(','),
  };
}
