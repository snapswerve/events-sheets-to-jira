/**
 * dev-notes.js — Developer-facing parts of the ticket description.
 *
 * Everything here is derived from the tracking plan, so it stays in sync with the spec:
 *   - a properties/traits table (property, type, description, example values, status)
 *   - a copy-paste implementation snippet for the platform's SDK
 *     (Analytics.js for web, Analytics React Native for mobile, Java for server-side)
 *   - team notes: standing instructions from data/team-notes.json (local, gitignored)
 *   - an implementation checklist and QA steps for the platform
 *   - context from the plan row (owner, comments, code example, link to the row)
 *   - open questions detected in the spec (unknown types, unset status, guessed routing)
 *
 * Nested properties use dotted paths from the plan ("address.city", "products.$.sku", where
 * "$" is an array item); snippets and payloads expand them into nested objects/arrays.
 */

import fs from 'fs';
import path from 'path';
import { getTabName } from './links.js';

const SAMPLE_TIMESTAMP = '2026-02-24T03:25:53.802Z';
const SAMPLE_DATE = '2026-02-24';
const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const DEFAULT_TEAM_NOTES_PATH = new URL('../data/team-notes.json', import.meta.url);

// ─── Ticket shape helpers ───

/** "web-track" → { family: 'web', call: 'track' }. family is web | mobile | ss. */
export function callInfo(ticket) {
  const [family, call] = String(ticket.templateType || '').split('-');
  return { family, call };
}

export function ticketFields(ticket) {
  return (ticket.tabType === 'identify' ? ticket.traits : ticket.properties) || [];
}

/** All Jira keys in a cell, e.g. "ECQ-21253, ECQ-21255" → ['ECQ-21253', 'ECQ-21255']. */
export function jiraKeys(value) {
  return String(value || '').match(JIRA_KEY_RE) || [];
}

export function looksLikeJiraKey(value) {
  return jiraKeys(value).length > 0;
}

// ─── Properties / traits table ───

export function formatFieldTable(fields, label = 'Property') {
  if (!fields || fields.length === 0) return ' * (none specified)';
  const header = `||${label}||Type||Description||Example values||Status||`;
  const rows = fields.map((f) =>
    [
      `{{${f.name}}}`,
      tableCell(f.type || 'string'),
      tableCell(f.description),
      tableCell(f.exampleValues),
      tableCell(f.status === 'unset' ? 'not set' : f.status),
    ].join('|'),
  );
  return [header, ...rows.map((r) => `|${r}|`)].join('\n');
}

// ─── Sample values ───

/** Maps free-text types from the dictionary ("Integer", "decimal", "array of strings", ...) to a JSON type. */
export function normalizeType(type) {
  const t = String(type || '').toLowerCase();
  if (/array|list|\[\]/.test(t)) return 'array';
  if (/object|map|dict/.test(t)) return 'object';
  if (/bool/.test(t)) return 'boolean';
  if (/\bint(eger|\d*)\b|whole number/.test(t)) return 'integer';
  if (/\bnum|float|double|decimal|currency|price/.test(t)) return 'number';
  if (/date|time/.test(t)) return 'datetime';
  return 'string';
}

/**
 * A realistic, correctly typed value for snippets and example payloads —
 * the first example value from the dictionary when there is one.
 */
export function sampleValue(field) {
  const raw = String(field.exampleValues || '').trim();
  const json = tryParseJson(raw);
  const first = firstExample(raw);

  switch (normalizeType(field.type)) {
    case 'boolean':
      return first.toLowerCase() !== 'false';
    case 'integer': {
      const n = parseInt(first.replace(/[^\d-]/g, ''), 10);
      return Number.isFinite(n) ? n : 0;
    }
    case 'number': {
      const n = parseFloat(first.replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    }
    case 'array':
      if (Array.isArray(json)) return json;
      return first ? [first] : [];
    case 'object':
      return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
    case 'datetime':
      // Format placeholders like "yyyy-mm-dd" aren't values — swap in a real date of that shape
      if (/\d/.test(first)) return first;
      return /^y{4}-m{2}-d{2}$/i.test(first) ? SAMPLE_DATE : SAMPLE_TIMESTAMP;
    default:
      return first || `<${field.name}>`;
  }
}

function tryParseJson(raw) {
  if (!/^[[{]/.test(raw)) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function firstExample(raw) {
  if (!raw || /^[[{]/.test(raw)) return '';
  const first = raw.split(/\r?\n|[,;|]/).map((s) => s.trim()).find(Boolean) || '';
  return first.replace(/^e\.g\.?:?\s*/i, '').replace(/^["'“‘]+|["'”’]+$/g, '').trim();
}

// ─── Nested fields ───

/**
 * Turns dotted field paths into a tree: "products.$.sku" → products (array) → item → sku.
 * Each node is { field?, children: Map }; a "$" child means the node is an array.
 */
export function buildFieldTree(fields) {
  const root = { children: new Map() };
  for (const field of fields) {
    let node = root;
    for (const segment of field.name.split('.').map((s) => s.trim()).filter(Boolean)) {
      if (!node.children.has(segment)) node.children.set(segment, { children: new Map() });
      node = node.children.get(segment);
    }
    node.field = node.field || field;
  }
  return root;
}

function isArrayNode(node) {
  return node.children.has('$');
}

/** The properties/traits object for example payloads, nested like the real call. */
export function samplePayload(fields = []) {
  return sampleTree(buildFieldTree(fields));
}

function sampleTree(node) {
  if (node.children.size === 0) return node.field ? sampleValue(node.field) : null;
  if (isArrayNode(node)) return [sampleTree(node.children.get('$'))];
  return Object.fromEntries([...node.children].map(([key, child]) => [key, sampleTree(child)]));
}

// ─── Implementation snippet ───

export function codeSnippet(ticket) {
  const { family, call } = callInfo(ticket);
  const tree = buildFieldTree(ticketFields(ticket));
  const trigger = oneLine(ticket.whenFired);

  if (family === 'ss') {
    return { lang: 'java', code: javaSnippet(ticket, call, tree, trigger) };
  }

  const comment = trigger ? `// ${triggerComment(call, trigger)}\n` : '';
  const target = call === 'identify' ? 'userId' : jsLiteral(ticket.eventName);
  const args = tree.children.size > 0 ? `, {\n${jsEntries(tree.children, '  ').join('\n')}\n}` : '';

  if (family === 'mobile') {
    return {
      lang: 'javascript',
      code: `// @segment/analytics-react-native\n${comment}const { ${call} } = useAnalytics();\n\n${call}(${target}${args});`,
    };
  }
  return { lang: 'javascript', code: `// Analytics.js\n${comment}analytics.${call}(${target}${args});` };
}

// On the Identify tab, "When fires" names the track call the identify accompanies
function triggerComment(call, trigger) {
  return call === 'identify' ? `Send with the "${trigger}" track call` : `Fires when: ${trigger}`;
}

function jsEntries(children, indent) {
  const lines = [];
  for (const [key, node] of children) {
    const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : jsLiteral(key);
    const comment = node.field ? ` ${fieldComment(node.field)}` : '';
    if (node.children.size === 0) {
      lines.push(`${indent}${name}: ${jsLiteral(sampleValue(node.field))},${comment}`);
    } else if (isArrayNode(node)) {
      lines.push(`${indent}${name}: [${comment}`, ...jsArrayItem(node.children.get('$'), `${indent}  `), `${indent}],`);
    } else {
      lines.push(`${indent}${name}: {${comment}`, ...jsEntries(node.children, `${indent}  `), `${indent}},`);
    }
  }
  return lines;
}

function jsArrayItem(item, indent) {
  const comment = item.field ? ` ${fieldComment(item.field)}` : '';
  if (item.children.size === 0) return [`${indent}${jsLiteral(sampleValue(item.field))},${comment}`];
  return [`${indent}{${comment}`, ...jsEntries(item.children, `${indent}  `), `${indent}},`];
}

function jsLiteral(value) {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return JSON.stringify(value);
}

function javaSnippet(ticket, call, tree, trigger) {
  const lines = [];
  if (trigger) lines.push(`// ${triggerComment(call, trigger)}`);
  lines.push(
    call === 'identify'
      ? 'analytics.enqueue(IdentifyMessage.builder()'
      : `analytics.enqueue(TrackMessage.builder(${JSON.stringify(ticket.eventName)})`,
  );
  lines.push('    .userId(userId)');
  if (tree.children.size > 0) {
    lines.push(`    .${call === 'identify' ? 'traits' : 'properties'}(ImmutableMap.<String, Object>builder()`);
    lines.push(...javaEntries(tree.children, '        '));
    lines.push('        .build()));');
  } else {
    lines[lines.length - 1] += ');';
  }
  return lines.join('\n');
}

function javaEntries(children, indent) {
  const lines = [];
  for (const [key, node] of children) {
    const comment = node.field ? ` ${fieldComment(node.field)}` : '';
    const put = `${indent}.put(${JSON.stringify(key)}, `;
    if (node.children.size === 0) {
      lines.push(`${put}${javaLiteral(sampleValue(node.field), node.field)})${comment}`);
    } else if (isArrayNode(node)) {
      const item = node.children.get('$');
      if (item.children.size === 0) {
        lines.push(`${put}List.of(${javaLiteral(sampleValue(item.field), item.field)}))${comment}`);
      } else {
        lines.push(`${put}List.of(ImmutableMap.<String, Object>builder()${comment}`);
        lines.push(...javaEntries(item.children, `${indent}    `), `${indent}    .build()))`);
      }
    } else {
      lines.push(`${put}ImmutableMap.<String, Object>builder()${comment}`);
      lines.push(...javaEntries(node.children, `${indent}    `), `${indent}    .build())`);
    }
  }
  return lines;
}

function javaLiteral(value, field) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    return normalizeType(field?.type) === 'number' && Number.isInteger(value) ? `${value}.0` : String(value);
  }
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) {
    return `List.of(${value.map((v) => javaLiteral(v, { type: typeof v })).join(', ')})`;
  }
  return Array.isArray(value) ? 'List.of(/* see spec */)' : 'Map.of(/* see spec */)';
}

function fieldComment(field) {
  const status = !field.status || field.status === 'unset' ? 'status not set' : field.status.toLowerCase();
  return `// ${field.type || 'string'}, ${status}`;
}

// ─── Team notes ───

/**
 * Notes from data/team-notes.json (or TEAM_NOTES_PATH) that apply to this ticket. The file is
 * gitignored because notes often link to internal tickets; data/team-notes.example.json shows
 * the format. A note can be limited with
 * "platforms" (web, mobile, server) and/or "templateTypes" (e.g. "web-page"); without either
 * it applies to every ticket.
 */
export function getTeamNotes(ticket) {
  const platform = String(ticket.platform || '').toLowerCase();
  return loadTeamNotes().filter((note) => {
    if (note.platforms?.length && !note.platforms.map((p) => p.toLowerCase()).includes(platform)) return false;
    if (note.templateTypes?.length && !note.templateTypes.includes(ticket.templateType)) return false;
    return true;
  });
}

let teamNotesCache;

function loadTeamNotes() {
  if (teamNotesCache) return teamNotesCache;
  teamNotesCache = [];
  const notesPath = process.env.TEAM_NOTES_PATH ? path.resolve(process.env.TEAM_NOTES_PATH) : DEFAULT_TEAM_NOTES_PATH;
  if (!fs.existsSync(notesPath)) return teamNotesCache;
  try {
    const raw = JSON.parse(fs.readFileSync(notesPath, 'utf-8'));
    teamNotesCache = (raw.notes || []).filter((note) => note.title && note.body);
  } catch (err) {
    console.warn(`⚠️  Could not parse ${notesPath} — skipping team notes (${err.message})`);
  }
  return teamNotesCache;
}

// ─── Checklist & QA ───

function implementationChecklist(ticket) {
  const { family, call } = callInfo(ticket);
  const noun = call === 'identify' ? 'trait' : 'property';
  const items = [];

  if (call === 'identify') {
    items.push('Set {{userId}} to the canonical internal user ID — never an email address or other PII');
    items.push('Call identify when these traits are set or change (signup, login, profile update) — not on every page load or app open');
  } else {
    const nameKind = call === 'track' ? 'event name' : `${call} name`;
    items.push(`Use the exact ${nameKind} {{${ticket.eventName}}} — case, spacing, and word order all matter; any variation shows up as a new, unplanned event in Protocols`);
  }
  items.push(`Use ${noun} keys exactly as listed — don't rename, nest, or add keys that aren't in the spec`);
  if (ticketFields(ticket).some((f) => f.name.includes('.'))) {
    items.push('Dotted names are nested objects ({{address.city}} is {{city}} inside {{address}}), and {{$}} marks an array item ({{products.$.sku}} is the {{sku}} of each object in {{products}}) — see the snippet above');
  }
  items.push('Send values with the listed data types: numbers as numbers ({{49.99}}, not {{"49.99"}}), booleans as {{true}}/{{false}}');
  items.push(`Omit ${noun === 'trait' ? 'traits' : 'properties'} that have no value — never send {{null}}, {{undefined}}, or {{""}}`);
  if (call !== 'identify') {
    const duplicates = { web: 're-renders, double-clicks, and retries', mobile: 're-renders, double-taps, and retries', ss: 'retries and duplicate job or webhook deliveries' };
    items.push(`Fire once per occurrence — guard against ${duplicates[family] || 'retries'}`);
  }

  if (family === 'web') {
    if (call === 'page') {
      items.push('In single-page apps, call {{analytics.page()}} on route change — not on component mount or re-render');
    }
    if (call === 'track') {
      items.push('If the action navigates away (link click, form submit), make sure the event is sent before unload — use {{analytics.trackLink()}} / {{analytics.trackForm()}} or await the call');
    }
    if (call !== 'identify') {
      items.push('For logged-in users, make sure {{analytics.identify()}} has already run so this call carries the {{userId}}');
    }
  } else if (family === 'mobile') {
    items.push('Events are batched — for local testing set {{flushAt: 1}} in {{createClient}} or call {{flush()}} so they show up right away');
    if (call === 'screen') {
      items.push('If screen views are tracked automatically from the navigation container, make sure this screen isn\'t sent twice');
    }
  } else if (family === 'ss') {
    items.push('Every server-side call needs {{userId}} (or {{anonymousId}}) — there is no browser or device context to fill them in');
    items.push('If the user may not be logged in yet, pass the client\'s {{anonymousId}} through to the backend so server and client events join the same profile');
    if (call === 'track') {
      items.push('If the event is sent later than the action (queue, job, retry), set {{timestamp}} to when the action actually happened');
    }
    items.push('Call {{analytics.flush()}} before the process shuts down so queued events aren\'t dropped');
  }

  return items.map((item) => ` * ${item}`);
}

function qaSteps(ticket) {
  const { family, call } = callInfo(ticket);
  const trigger = oneLine(ticket.whenFired);
  const callDesc = call === 'identify'
    ? '{{identify}} call with {{userId}} set'
    : `{{${call}}} call named {{${ticket.eventName}}}`;
  const fieldsDesc = call === 'identify' ? 'trait' : 'property';
  const triggerStep = !trigger
    ? 'Trigger the action described in the spec'
    : call === 'identify'
      ? `Go through the ${escapeWiki(trigger)} flow`
      : `Trigger it: ${escapeWiki(trigger)}`;
  const steps = [];

  if (family === 'web') {
    steps.push('Open the page with [Segment Inspector|https://chromewebstore.google.com/detail/segment-inspector-officia/jfcbmnpfbhhlhfclmiijpldieboendfo] or the source\'s Debugger open');
    steps.push(triggerStep);
    steps.push(`Confirm exactly one ${callDesc}, with every required ${fieldsDesc} present and types matching the table`);
  } else if (family === 'mobile') {
    steps.push('Run a debug build with {{debug: true}} and {{flushAt: 1}} in {{createClient}}');
    steps.push(`${triggerStep} — on both iOS and Android`);
    steps.push(`Confirm in the mobile source's Debugger: exactly one ${callDesc}, with every required ${fieldsDesc} present and types matching the table`);
  } else {
    steps.push(`${triggerStep} — in staging`);
    steps.push(`Confirm in the server source's Debugger: exactly one ${callDesc}, with every required ${fieldsDesc} present and types matching the table`);
    steps.push('Confirm the {{userId}} matches the one the client sends for the same user, so events land on one profile');
  }
  if (ticket.idState && call !== 'identify') steps.push(`Repeat for each user state in scope: ${escapeWiki(ticket.idState)}`);
  steps.push('Check Protocols shows no violations for this event');

  return steps.map((step) => ` # ${step}`);
}

// ─── Open questions ───

/** Gaps in the spec a developer would otherwise have to chase down. Empty when the spec is complete. */
export function getOpenQuestions(ticket) {
  const { call } = callInfo(ticket);
  const fields = ticketFields(ticket);
  const isIdentify = call === 'identify';
  const plural = isIdentify ? 'traits' : 'properties';
  const questions = [];

  if (!ticket.whenFired) {
    questions.push('No "When fired" trigger in the tracking plan — confirm exactly what action or condition fires this.');
  }
  if (fields.length === 0 && (call === 'track' || isIdentify)) {
    questions.push(`No ${plural} listed — confirm this call should be sent without any.`);
  }

  const notInDict = fields.filter((f) => f.inDictionary === false).map((f) => `{{${f.name}}}`);
  if (notInDict.length > 0) {
    const dict = isIdentify ? 'Identify Traits Dictionary' : 'Track Properties Dictionary';
    questions.push(`Not in the ${dict}, so the data type was assumed to be string: ${notInDict.join(', ')} — confirm type and allowed values.`);
  }

  const unset = fields.filter((f) => f.status === 'unset').map((f) => `{{${f.name}}}`);
  if (unset.length > 0) {
    questions.push(`Required/optional status isn't set for: ${unset.join(', ')}.`);
  }

  if (ticket.routingReason === 'source-fallback' || ticket.routingReason === 'default-fallback') {
    questions.push(`Platform (${ticket.platform}) was inferred from Generating Source "${escapeWiki(ticket.generatingSource || 'blank')}" because template "${escapeWiki(ticket.instanceLabel)}" doesn't name one — confirm which codebase this belongs in.`);
  }

  const keys = jiraKeys(ticket.existingTicket);
  if (keys.length > 0) {
    questions.push(`The tracking plan already lists ${keys.join(', ')} for this event — confirm this ticket isn't a duplicate.`);
  }

  return questions;
}

// ─── Tracking plan context ───

function planContext(ticket) {
  const { call } = callInfo(ticket);
  const where = `${getTabName(ticket.tabType)} tab, row ${ticket.sourceRow}`;
  const lines = [` * *Spec source:* ${ticket.sourceUrl ? `[${where}|${ticket.sourceUrl}]` : where}`];

  if (call === 'track' || call === 'identify') lines.push(` * *Template / surface:* ${escapeWiki(ticket.instanceLabel)}`);
  if (ticket.generatingSource) lines.push(` * *Generating source:* ${escapeWiki(oneLine(ticket.generatingSource))}`);
  if (ticket.productSection) lines.push(` * *Product section:* ${escapeWiki(ticket.productSection)}`);
  if (ticket.teamOwnership) lines.push(` * *Owning team:* ${escapeWiki(ticket.teamOwnership)}`);
  if (ticket.existingTicket) lines.push(` * *Jira tickets listed in plan:* ${escapeWiki(ticket.existingTicket)}`);

  let out = `h3. Tracking plan context\n${lines.join('\n')}`;

  const fieldComments = ticketFields(ticket).filter((f) => f.comment);
  if (ticket.comments || fieldComments.length > 0) {
    out += '\n\n*Comments from the tracking plan:*';
    if (ticket.comments) out += `\n{quote}${escapeWiki(ticket.comments)}{quote}`;
    if (fieldComments.length > 0) {
      out += `\n${fieldComments.map((f) => ` * {{${f.name}}}: ${escapeWiki(oneLine(f.comment))}`).join('\n')}`;
    }
  }

  const codeExamples = [
    ticket.codeExample,
    ...ticketFields(ticket).filter((f) => f.codeExample).map((f) => `// ${f.name}\n${f.codeExample}`),
  ].filter(Boolean);
  if (codeExamples.length > 0) {
    out += `\n\n*Code example from the tracking plan:*\n{noformat}\n${codeExamples.join('\n\n')}\n{noformat}`;
  }
  return out;
}

// ─── Section renderer ───

/**
 * The full "Developer Notes" section. Returns '' when disabled so templates can
 * interpolate it unconditionally.
 */
export function developerNotes(ticket, { devNotes = true } = {}) {
  if (!devNotes) return '';

  const questions = getOpenQuestions(ticket);
  const { lang, code } = codeSnippet(ticket);
  const sections = ['h2. Developer Notes'];

  if (questions.length > 0) {
    sections.push(`h3. (!) Open questions\n${questions.map((q) => ` * ${q}`).join('\n')}`);
  }
  for (const note of getTeamNotes(ticket)) {
    sections.push(`h3. ${note.title}\n${note.body}`);
  }
  sections.push(`h3. Implementation\n{code:${lang}}\n${code}\n{code}`);
  sections.push(`h3. Implementation checklist\n${implementationChecklist(ticket).join('\n')}`);
  sections.push(`h3. How to verify\n${qaSteps(ticket).join('\n')}`);
  sections.push(planContext(ticket));

  return sections.join('\n\n') + '\n\n';
}

// ─── Wiki markup helpers ───

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** Escapes characters that would otherwise start a macro or link in Jira wiki markup. */
function escapeWiki(text) {
  return String(text || '').replace(/([{[])/g, '\\$1');
}

/** Table cells can't contain raw pipes or newlines; empty cells need a space. */
function tableCell(text) {
  const s = escapeWiki(text).replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' \\\\ ').trim();
  return s || ' ';
}
