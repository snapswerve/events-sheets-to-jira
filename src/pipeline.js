/**
 * pipeline.js — parse → enrich → filter → map → render, independent of the CLI.
 *
 * index.js drives this for real runs; tests call it directly against the sample plan.
 */

import { parseTrackTab, parseIdentifyTab, parsePageTab, parseScreenTab } from './parser.js';
import { buildTrackPropsDict, buildIdentifyTraitsDict, enrichTrackEvents, enrichIdentifyEvents, enrichPageScreenEvents } from './enricher.js';
import { mapEventsToInstances } from './mapper.js';
import { renderTicket } from './templates.js';
import { getRowUrl } from './links.js';
import { looksLikeJiraKey } from './dev-notes.js';
import { loadCompanyConfig, normalizeConfig, buildRuleContext, applyRules } from './rules.js';

// Jira Cloud rejects descriptions over 32,767 characters
export const JIRA_DESCRIPTION_LIMIT = 32767;

/**
 * Parses and enriches every tab of the plan read by reader.js.
 */
export function loadEvents(data) {
  const trackDict = buildTrackPropsDict(data.trackDict);
  const identifyDict = buildIdentifyTraitsDict(data.identifyDict);

  const events = [
    ...enrichTrackEvents(parseTrackTab(data.track), trackDict),
    ...enrichIdentifyEvents(parseIdentifyTab(data.identify), identifyDict),
    ...enrichPageScreenEvents(parsePageTab(data.page), trackDict),
    ...enrichPageScreenEvents(parseScreenTab(data.screen), trackDict),
  ];

  return { events, trackDict, identifyDict };
}

/**
 * Event-level filters. All are optional; list filters match any value in the list.
 * @param {Object} filters - { priorities: string[], types: string[], eventQuery: string, skipTicketed: boolean }
 */
export function filterEvents(events, { priorities, types, eventQuery, skipTicketed } = {}) {
  const query = eventQuery?.toLowerCase();
  return events.filter((e) => {
    if (priorities?.length && !priorities.includes(e.priority)) return false;
    if (types?.length && !types.includes(e.tabType)) return false;
    if (query && !`${e.eventName || ''} ${e.whenFired || ''}`.toLowerCase().includes(query)) return false;
    if (skipTicketed && isTicketed(e)) return false;
    return true;
  });
}

/**
 * True when the plan's Jira Tickets column already lists a ticket for the event.
 */
export function isTicketed(event) {
  return looksLikeJiraKey(event.existingTicket);
}

/**
 * Maps events to ticket instances, applies company rules, and renders each one.
 * @param {Object} opts
 *   source     - { spreadsheetId, tabGids } from reader.js, for row links
 *   devNotes   - false for the lean, spec-only description
 *   config     - company config (defaults to data/company.json; see rules.js)
 *   planEvents - every event in the plan, for rules that look across tabs (defaults to `events`)
 */
export function buildTickets(events, { source = {}, devNotes = true, config = loadCompanyConfig(), planEvents = events } = {}) {
  const ruleContext = buildRuleContext(planEvents, normalizeConfig(config));
  return mapEventsToInstances(events).map((instance) => {
    const ticket = applyRules({ ...instance, sourceUrl: getRowUrl(instance.tabType, instance.sourceRow, source) }, ruleContext);
    return { ...ticket, ...renderTicket(ticket, { devNotes }) };
  });
}

/**
 * Ticket-level filters (platform is only known after routing).
 * @param {Object} filters - { platforms: string[], limit: number }
 */
export function filterTickets(tickets, { platforms, limit } = {}) {
  let result = tickets;
  if (platforms?.length) result = result.filter((t) => platforms.includes(t.platform.toLowerCase()));
  if (limit) result = result.slice(0, limit);
  return result;
}
