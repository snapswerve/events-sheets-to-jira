/**
 * index.js — CLI entry point for sheets-to-jira.
 *
 * Usage:
 *   node src/index.js                          # dry-run, all priorities
 *   node src/index.js --priority P1             # dry-run, P1 only
 *   node src/index.js --priority P1 --live      # creates Jira tickets via API
 *   node src/index.js --priority P1 --export    # exports to Jira import xlsx
 *
 * Concept: CLI args are parsed from process.argv. No framework needed for simple flags.
 */

import 'dotenv/config';
import { readEventingPlan } from './reader.js';
import { parseTrackTab, parseIdentifyTab, parsePageTab, parseScreenTab } from './parser.js';
import { buildTrackPropsDict, buildIdentifyTraitsDict, enrichTrackEvents, enrichIdentifyEvents, enrichPageScreenEvents } from './enricher.js';
import { mapEventsToInstances } from './mapper.js';
import { renderTicket } from './templates.js';
import { createJiraTicket } from './jira.js';
import { exportToXlsx, exportToCsv } from './exporter.js';
import fs from 'fs';
import path from 'path';

// ─── Parse CLI args ───
const args = process.argv.slice(2);
const priorityFilter = getArgValue(args, '--priority');
const isLive = args.includes('--live');
const isExport = args.includes('--export');
const exportFormatArg = getArgValue(args, '--format');
const exportFormat = exportFormatArg ? exportFormatArg.toLowerCase() : 'xlsx';
const debugRouting = args.includes('--debug-routing');
const isDryRun = !isLive && !isExport;

function getArgValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1].toUpperCase() : null;
}

function csvSafe(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  const mode = isLive ? '🔴 LIVE (creating tickets)' : isExport ? `📦 EXPORT (generating ${exportFormat})` : '👀 DRY RUN (preview only)';
  console.log(`\n🚀 sheets-to-jira — ${mode}`);
  if (priorityFilter) console.log(`🎯 Priority filter: ${priorityFilter}`);

  // ─── Read ───
  let data;
  try {
    data = await readEventingPlan();
  } catch (err) {
    console.error(`❌ Could not read eventing plan: ${err.message}`);
    process.exit(1);
  }

  console.log(`📋 Sheets found: ${data.sheetNames.join(', ')}`);

  // ─── Build dictionaries ───
  const trackDict = buildTrackPropsDict(data.trackDict);
  const identifyDict = buildIdentifyTraitsDict(data.identifyDict);
  console.log(`📖 Track Properties Dictionary: ${trackDict.size} entries`);
  console.log(`📖 Identify Traits Dictionary: ${identifyDict.size} entries`);

  // ─── Parse all tabs ───
  let trackEvents = parseTrackTab(data.track);
  let identifyEvents = parseIdentifyTab(data.identify);
  let pageEvents = parsePageTab(data.page);
  let screenEvents = parseScreenTab(data.screen);

  console.log(`\n📊 Parsed events:`);
  console.log(`   Track:    ${trackEvents.length}`);
  console.log(`   Identify: ${identifyEvents.length}`);
  console.log(`   Page:     ${pageEvents.length}`);
  console.log(`   Screen:   ${screenEvents.length}`);

  // ─── Filter by priority ───
  if (priorityFilter) {
    trackEvents = trackEvents.filter((e) => e.priority === priorityFilter);
    identifyEvents = identifyEvents.filter((e) => e.priority === priorityFilter);
    pageEvents = pageEvents.filter((e) => e.priority === priorityFilter);
    screenEvents = screenEvents.filter((e) => e.priority === priorityFilter);

    console.log(`\n🎯 After ${priorityFilter} filter:`);
    console.log(`   Track:    ${trackEvents.length}`);
    console.log(`   Identify: ${identifyEvents.length}`);
    console.log(`   Page:     ${pageEvents.length}`);
    console.log(`   Screen:   ${screenEvents.length}`);
  }

  // ─── Enrich with dictionary data ───
  trackEvents = enrichTrackEvents(trackEvents, trackDict);
  identifyEvents = enrichIdentifyEvents(identifyEvents, identifyDict);
  pageEvents = enrichPageScreenEvents(pageEvents, trackDict);
  screenEvents = enrichPageScreenEvents(screenEvents, trackDict);

  // ─── Map to ticket instances ───
  const allEvents = [...trackEvents, ...identifyEvents, ...pageEvents, ...screenEvents];
  const ticketInstances = mapEventsToInstances(allEvents);

  console.log(`\n🎟️  Total ticket instances to generate: ${ticketInstances.length}`);

  // ─── Render tickets ───
  const renderedTickets = ticketInstances.map((ticket) => {
    const rendered = renderTicket(ticket);
    return { ...ticket, ...rendered };
  });

  // ─── Optional routing debug report ───
  if (debugRouting) {
    const outDir = './output';
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const debugPath = path.join(outDir, `routing-debug-${ts}.csv`);

    const headers = [
      'event_name',
      'tab_type',
      'call_type',
      'priority',
      'source_raw',
      'template_instance',
      'resolved_template_type',
      'platform',
      'routing_reason',
      'source_row',
    ];

    const rows = renderedTickets.map((t) => [
      csvSafe(t.eventName || t.whenFired || ''),
      csvSafe(t.tabType || ''),
      csvSafe(t.tabType === 'identify' ? 'identify' : t.tabType === 'page' ? 'page' : t.tabType === 'screen' ? 'screen' : 'track'),
      csvSafe(t.priority || ''),
      csvSafe(t.generatingSource || ''),
      csvSafe(t.instanceLabel || ''),
      csvSafe(t.templateType || ''),
      csvSafe(t.platform || ''),
      csvSafe(t.routingReason || ''),
      csvSafe(String(t.sourceRow || '')),
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    fs.writeFileSync(debugPath, csv, 'utf-8');
    console.log(`🧭 Routing debug report written: ${debugPath}`);
  }

  // ─── Output ───
  if (isDryRun) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log('DRY RUN — Ticket Preview');
    console.log('─'.repeat(60));

    for (const [i, ticket] of renderedTickets.entries()) {
      console.log(`\n[${i + 1}/${renderedTickets.length}] ${ticket.summary}`);
      console.log(`    Priority: ${ticket.priority} | Template: ${ticket.templateType} | Platform: ${ticket.platform}`);
      console.log(`    Properties/Traits: ${(ticket.properties || ticket.traits || []).length}`);
      console.log(`    Description preview: ${ticket.description.substring(0, 120)}...`);
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`✅ ${renderedTickets.length} tickets previewed.`);
    console.log(`\nTo create them in Jira:  node src/index.js --priority ${priorityFilter || 'P1'} --live`);
    console.log(`To export to xlsx:       node src/index.js --priority ${priorityFilter || 'P1'} --export`);
  }

  if (isExport) {
    const exportOpts = {
      projectKey: process.env.JIRA_PROJECT_KEY || 'DP',
      epicKey: process.env.JIRA_EPIC_KEY || 'DP-117',
      outputDir: './output',
    };

    let outputPath;
    if (exportFormat === 'csv') {
      outputPath = exportToCsv(renderedTickets, exportOpts);
    } else {
      outputPath = exportToXlsx(renderedTickets, exportOpts);
    }

    console.log(`\n📦 Exported ${renderedTickets.length} tickets to: ${outputPath}`);
  }

  if (isLive) {
    console.log(`\n🔴 Creating ${renderedTickets.length} tickets in Jira...\n`);

    let created = 0;
    let failed = 0;

    for (const ticket of renderedTickets) {
      try {
        const issueKey = await createJiraTicket(ticket);
        console.log(`  🎟️  ${issueKey} — ${ticket.summary}`);
        created++;
      } catch (err) {
        console.error(`  ❌ Failed: "${ticket.summary}" — ${err.message}`);
        failed++;
      }
    }

    console.log(`\n✨ Done. ${created} created, ${failed} failed.`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
