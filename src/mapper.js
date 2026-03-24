/**
 * mapper.js — Maps each event to one or more Jira ticket instances.
 *
 * Concept: A single event in the tracking plan can fire from multiple "templates"
 * (e.g. "Checkout Started" fires from standard flow, gift, donation, native mobile app).
 * Each entry in the Templates column gets its own Jira ticket.
 *
 * Template overrides: data/template-overrides.json can replace the xlsx template list
 * for specific events (useful when the sheet is stale or has duplicates).
 *
 * "Generating Source" determines platform:
 *   - "Server" → SS Track / SS Identify
 *   - "Web" → Web Track / Web Page / Web Identify
 *   - "Mobile" → Mobile Track / Mobile Screen
 *   - "Web/Mobile" → platform per template (mobile keywords → Mobile, else → Web)
 */

import fs from 'fs';
import path from 'path';

const MOBILE_KEYWORDS = ['mobile', 'app', 'native'];

function isMobileTemplate(templateName) {
  const t = templateName.toLowerCase();
  if (t.includes('screen')) return true;
  return MOBILE_KEYWORDS.some((kw) => t.includes(kw));
}

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
      if (key.startsWith('_')) continue; // skip _comment etc.
      if (Array.isArray(val)) map.set(key, val);
    }
    return map;
  } catch {
    console.warn('⚠️  Could not parse template-overrides.json — using xlsx templates');
    return new Map();
  }
}

const templateOverrides = loadTemplateOverrides();

/**
 * Resolves which Jira template type(s) apply to a given event.
 * Returns an array of { templateType, instanceLabel, platform } objects.
 */
export function resolveInstances(event) {
  if (event.tabType === 'page') {
    return [{
      templateType: 'web-page',
      instanceLabel: `${event.eventName} page`,
      platform: 'Web',
    }];
  }

  if (event.tabType === 'screen') {
    return [{
      templateType: 'mobile-screen',
      instanceLabel: `${event.eventName} screen`,
      platform: 'Mobile',
    }];
  }

  if (event.tabType === 'identify') {
    return resolveIdentifyInstances(event);
  }

  return resolveTrackInstances(event);
}

function resolveTrackInstances(event) {
  const instances = [];
  const source = (event.generatingSource || '').toLowerCase();

  // Use override templates if present, otherwise parse from xlsx
  const overrideList = templateOverrides.get(event.eventName);
  const templatesList = overrideList || dedupeTemplates(parseTemplatesList(event.templates));

  // Pure server-side
  if (source.includes('server') || source === 'ss') {
    instances.push({
      templateType: 'ss-track',
      instanceLabel: 'server side',
      platform: 'Server',
    });
    return instances;
  }

  // Web, Mobile, or Web/Mobile with specific templates
  const isMixed = source.includes('web') && source.includes('mobile');

  if (templatesList.length > 0) {
    for (const tmpl of templatesList) {
      if (isMixed || source.includes('mobile')) {
        if (isMobileTemplate(tmpl)) {
          instances.push({ templateType: 'mobile-track', instanceLabel: tmpl, platform: 'Mobile' });
        } else if (source.includes('web') || isMixed) {
          instances.push({ templateType: 'web-track', instanceLabel: tmpl, platform: 'Web' });
        } else {
          instances.push({ templateType: 'mobile-track', instanceLabel: tmpl, platform: 'Mobile' });
        }
      } else {
        // Pure web
        instances.push({ templateType: 'web-track', instanceLabel: tmpl, platform: 'Web' });
      }
    }
  } else {
    // No templates listed — create one per applicable platform
    if (source.includes('web')) {
      instances.push({ templateType: 'web-track', instanceLabel: 'web', platform: 'Web' });
    }
    if (source.includes('mobile')) {
      instances.push({ templateType: 'mobile-track', instanceLabel: 'mobile app', platform: 'Mobile' });
    }
  }

  // Fallback
  if (instances.length === 0) {
    instances.push({ templateType: 'web-track', instanceLabel: 'default', platform: 'Web' });
  }

  return instances;
}

function resolveIdentifyInstances(event) {
  const instances = [];
  const source = (event.generatingSource || '').toLowerCase();

  if (source.includes('server') || source === 'ss') {
    instances.push({
      templateType: 'ss-identify',
      instanceLabel: `Identify with ${event.whenFired}`,
      platform: 'Server',
    });
  }

  if (source.includes('web') && source.includes('mobile')) {
    instances.push({
      templateType: 'web-identify',
      instanceLabel: `Identify with ${event.whenFired}`,
      platform: 'Web',
    });
    instances.push({
      templateType: 'mobile-identify',
      instanceLabel: `Identify with ${event.whenFired} (mobile)`,
      platform: 'Mobile',
    });
  } else if (source.includes('web')) {
    instances.push({
      templateType: 'web-identify',
      instanceLabel: `Identify with ${event.whenFired}`,
      platform: 'Web',
    });
  } else if (source.includes('mobile')) {
    instances.push({
      templateType: 'mobile-identify',
      instanceLabel: `Identify with ${event.whenFired}`,
      platform: 'Mobile',
    });
  }

  // Fallback — source might be empty (Computed Trait, rETL)
  if (instances.length === 0) {
    instances.push({
      templateType: 'web-identify',
      instanceLabel: `Identify with ${event.whenFired}`,
      platform: 'Web',
    });
  }

  return instances;
}

/**
 * Parses the "Templates" column (newline-separated list) into an array.
 */
function parseTemplatesList(raw) {
  if (!raw) return [];
  return raw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deduplicates template entries (e.g. "donation" appearing twice).
 * Each unique template = one ticket. Exact dupes are removed.
 */
function dedupeTemplates(templates) {
  const seen = new Set();
  return templates.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Main export: takes all parsed events and returns a flat list of ticket instances.
 * Each instance = one Jira ticket to create.
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
      });
    }
  }

  return tickets;
}
