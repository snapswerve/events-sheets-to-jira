/**
 * jira-fields.js — Jira field values shared by the REST client (jira.js) and the
 * import exporter (exporter.js), so API-created and CSV-imported tickets match.
 */

import crypto from 'crypto';

export const PRIORITY_MAP = {
  P0: 'Highest',
  P0C: 'Highest',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
};

export const FINGERPRINT_PREFIX = 'tp-';

export function jiraPriority(priority) {
  return PRIORITY_MAP[String(priority || '').toUpperCase()] || 'Medium';
}

/**
 * Stable ID for one ticket instance (tab + event + template), stored on the ticket as a
 * label like "tp-3f9a1c2b". Re-runs use it to recognize tickets that already exist,
 * even if someone edited the summary in Jira.
 *
 * `occurrence` keeps intentionally duplicated templates (same label twice) distinct.
 */
export function fingerprintLabel(ticket, occurrence = 1) {
  const key = [
    ticket.tabType,
    ticket.eventName || ticket.whenFired,
    ticket.templateType,
    ticket.instanceLabel,
    occurrence > 1 ? occurrence : '',
  ]
    .join('|')
    .toLowerCase();
  return FINGERPRINT_PREFIX + crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
}

export function buildLabels(ticket) {
  const labels = ['instrumentation', 'analytics'];
  if (ticket.platform) labels.push(ticket.platform.toLowerCase());
  if (ticket.templateType) labels.push(ticket.templateType);
  if (ticket.fingerprint) labels.push(ticket.fingerprint);
  // Jira labels can't contain spaces
  for (const extra of (process.env.JIRA_EXTRA_LABELS || '').split(',')) {
    const label = extra.trim().replace(/\s+/g, '-');
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}
