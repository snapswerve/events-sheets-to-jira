/**
 * mapper.js — Maps each event to one or more Jira ticket instances.
 *
 * Core rule: template instances are the source of truth for permutations.
 *
 * Routing strategy:
 * 1) Infer source family from template label first (web/mobile/ss)
 * 2) Fall back to Generating Source only when template is ambiguous/missing
 */

import fs from 'fs';
import path from 'path';

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
 * Parses the "Templates" column into an array.
 * Supports newline / semicolon / comma separated values.
 */
function parseTemplatesList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\n|;|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Main export: takes all parsed events and returns a flat list of ticket instances.
 */
export function mapEventsToInstances(events) {
  const tickets = [];

  for (const event of events) {
    const instances = resolveInstances(event);
    for (const instance of instances) {
      tickets.push({
        ...event,
        templateType: instance.templateType,
        instanceLabel: instance.instanceLabel,
        platform: instance.platform,
        routingReason: instance.routingReason,
      });
    }
  }

  return tickets;
}
