/**
 * index.js — CLI entry point for sheets-to-jira.
 *
 * Usage:
 *   node src/index.js                                  # dry-run, all priorities
 *   node src/index.js --priority P0,P1 --type track    # dry-run, filtered
 *   node src/index.js --priority P1 --live             # creates Jira tickets via API (skips ones that exist)
 *   node src/index.js --priority P1 --export           # exports to Jira import xlsx
 *   node src/index.js --help                           # all options
 *
 * Concept: CLI args are parsed from process.argv. No framework needed for simple flags.
 */

import 'dotenv/config';
import fs from 'fs';
import readline from 'readline/promises';
import { readEventingPlan } from './reader.js';
import { loadEvents, filterEvents, buildTickets, filterTickets, isTicketed, JIRA_DESCRIPTION_LIMIT } from './pipeline.js';
import { getOpenQuestions } from './dev-notes.js';
import { getPlanUrl } from './links.js';
import { loadCompanyConfig, describeConfig, findMisfiledTracks, findAppScreenLoadTracks, rowKey } from './rules.js';
import { getJiraConfig, detectJiraSetup, createJiraTicket, findExistingTickets, issueUrl } from './jira.js';
import { exportToXlsx, exportToCsv, outputPath, toCsv } from './exporter.js';

const HELP = `
sheets-to-jira — turn an event tracking plan into Jira tickets

Modes (default is a dry-run preview):
  --live                 Create tickets in Jira. Skips tickets that already exist, then asks to confirm.
  --export               Write a Jira import file to ./output
  --format xlsx|csv      Export format (default: xlsx)

Filters (lists are comma-separated):
  --priority P0,P1       Only these priorities
  --type track,identify  Only these tabs: track, identify, page, screen
  --platform web,mobile  Only these platforms: web, mobile, server
  --event "checkout"     Only events whose name (or identify trigger) contains this text
  --skip-ticketed        Leave out events whose Jira Tickets column in the plan already lists a ticket
  --include-flagged      Ticket track events the page-load rule flags as likely page views (held back by default)
  --limit N              Only the first N tickets — handy for a first --live test

Output:
  --verbose              Dry run: print each ticket's full description
  --no-dev-notes         Leave the Developer Notes section out of descriptions
  --debug-routing        Write a CSV explaining how each ticket was routed to a template

Live mode:
  --yes                  Don't ask for confirmation (for scripts/CI)
  --force                Create tickets even if a matching one already exists in Jira
`;

const VALUE_FLAGS = ['--priority', '--type', '--platform', '--event', '--limit', '--format'];
const BOOLEAN_FLAGS = ['--live', '--export', '--verbose', '--no-dev-notes', '--debug-routing', '--skip-ticketed', '--include-flagged', '--yes', '--force', '--help'];
const TAB_TYPES = ['track', 'identify', 'page', 'screen'];
const PLATFORMS = ['web', 'mobile', 'server'];

// ─── Parse CLI args ───

function parseArgs(argv) {
  const flags = new Set();
  const values = {};

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let value;
    if (arg.startsWith('--') && arg.includes('=')) {
      value = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }

    if (VALUE_FLAGS.includes(arg)) {
      value ??= argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      values[arg] = value;
    } else if (BOOLEAN_FLAGS.includes(arg) && value === undefined) {
      flags.add(arg);
    } else {
      // Fail loudly: a mistyped filter would otherwise silently select every event
      throw new Error(`Unknown option: ${argv[i]}`);
    }
  }

  return { flags, values };
}

function parseList(raw, { flag, upper = false, allowed, aliases = {} } = {}) {
  if (!raw) return [];
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (upper ? s.toUpperCase() : s.toLowerCase()))
    .map((s) => aliases[s] || s);
  const invalid = allowed ? items.filter((s) => !allowed.includes(s)) : [];
  if (invalid.length > 0) {
    throw new Error(`${flag} doesn't accept ${invalid.join(', ')} (use: ${allowed.join(', ')})`);
  }
  return items;
}

function parseOptions(argv) {
  const { flags, values } = parseArgs(argv);

  const format = (values['--format'] || 'xlsx').toLowerCase();
  if (!['xlsx', 'csv'].includes(format)) throw new Error(`--format must be xlsx or csv`);

  const limit = values['--limit'] ? Number(values['--limit']) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error('--limit must be a positive whole number');

  return {
    help: flags.has('--help'),
    isLive: flags.has('--live'),
    isExport: flags.has('--export'),
    format,
    verbose: flags.has('--verbose'),
    devNotes: !flags.has('--no-dev-notes'),
    debugRouting: flags.has('--debug-routing'),
    yes: flags.has('--yes'),
    force: flags.has('--force'),
    includeFlagged: flags.has('--include-flagged'),
    eventFilters: {
      priorities: parseList(values['--priority'], { flag: '--priority', upper: true }),
      types: parseList(values['--type'], { flag: '--type', allowed: TAB_TYPES }),
      eventQuery: values['--event'],
      skipTicketed: flags.has('--skip-ticketed'),
    },
    ticketFilters: {
      platforms: parseList(values['--platform'], { flag: '--platform', allowed: PLATFORMS, aliases: { ss: 'server', app: 'mobile' } }),
      limit,
    },
  };
}

// ─── Main ───

async function main() {
  let opts;
  try {
    opts = parseOptions(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ ${err.message}\n   Run with --help to see all options.`);
    process.exit(1);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const isDryRun = !opts.isLive && !opts.isExport;
  const mode = opts.isLive ? '🔴 LIVE (creating tickets)' : opts.isExport ? `📦 EXPORT (generating ${opts.format})` : '👀 DRY RUN (preview only)';
  console.log(`\n🚀 sheets-to-jira — ${mode}`);
  const filterSummary = describeFilters(opts);
  if (filterSummary) console.log(`🎯 Filters: ${filterSummary}`);

  // ─── Read ───
  let data;
  try {
    data = await readEventingPlan();
  } catch (err) {
    console.error(`❌ Could not read eventing plan: ${err.message}`);
    process.exit(1);
  }

  console.log(`📋 Sheets found: ${data.sheetNames.join(', ')}`);

  // ─── Parse + enrich ───
  const { events, trackDict, identifyDict } = loadEvents(data);
  if (getPlanUrl()) {
    console.log(`🔗 Tickets link to: ${getPlanUrl()}`);
  } else {
    console.warn('⚠️  No tracking plan link set — add EVENTING_PLAN_URL to .env so tickets link back to the plan');
  }
  console.log(`📖 Track Properties Dictionary: ${trackDict.size} entries`);
  console.log(`📖 Identify Traits Dictionary: ${identifyDict.size} entries`);
  logTabCounts('📊 Parsed events:', events);

  const config = loadCompanyConfig();
  console.log(`🧩 Company rules: ${describeConfig(config) || 'none (add data/company.json to turn rules on — see README)'}`);

  // ─── Filter ───
  let selected = filterEvents(events, opts.eventFilters);
  if (filterSummary) logTabCounts('🎯 After filters:', selected);

  if (opts.eventFilters.skipTicketed) {
    const ticketed = filterEvents(events, { ...opts.eventFilters, skipTicketed: false }).length - selected.length;
    if (ticketed > 0) console.log(`   ⏭️  Left out ${plural(ticketed, 'event')} that already list a Jira ticket in the plan`);
  } else {
    const ticketed = selected.filter(isTicketed).length;
    if (ticketed > 0) console.log(`   ℹ️  ${plural(ticketed, 'selected event')} already ${ticketed === 1 ? 'lists' : 'list'} a Jira ticket in the plan — add --skip-ticketed to leave ${ticketed === 1 ? 'it' : 'them'} out`);
  }

  // ─── Plan check: track events that look like page views ───
  const misfiled = findMisfiledTracks(events, config);
  if (misfiled.length > 0) {
    const marker = config.rules.pageLoad.markerProperty;
    const [verb, have] = misfiled.length === 1 ? ['reads', 'has'] : ['read', 'have'];
    console.log(`\n🧹 Plan check: ${plural(misfiled.length, 'track event')} ${verb} like a page/screen load but ${have} no ${marker} — likely page views that belong on the Page/Screen tab:`);
    for (const e of misfiled) console.log(`   - ${e.eventName} (Track row ${e.sourceRow}): "${e.whenFired.replace(/\s+/g, ' ')}"`);

    const heldRows = new Set(misfiled.map(rowKey));
    const held = selected.filter((e) => heldRows.has(rowKey(e)));
    if (held.length > 0 && config.rules.pageLoad.holdMisfiledTracks && !opts.includeFlagged) {
      selected = selected.filter((e) => !heldRows.has(rowKey(e)));
      console.log(`   ⏸️  Held back ${plural(held.length, 'event')} from ticketing — fix the plan, or add --include-flagged`);
    }
  }

  // App-only tracks that read like a screen load aren't held back; their tickets get an open question
  const selectedRows = new Set(selected.map(rowKey));
  const appScreenLoads = findAppScreenLoadTracks(events, config).filter((e) => selectedRows.has(rowKey(e)));
  if (appScreenLoads.length > 0) {
    const marker = config.rules.pageLoad.markerProperty;
    const verb = appScreenLoads.length === 1 ? 'reads' : 'read';
    console.log(`\n📱 ${plural(appScreenLoads.length, 'app track event')} ${verb} like a screen load without ${marker} — ticketed with an open question about how screen loads should show in reporting:`);
    for (const e of appScreenLoads) console.log(`   - ${e.eventName} (Track row ${e.sourceRow})`);
  }

  // ─── Map + render ───
  const tickets = filterTickets(
    buildTickets(selected, { source: { spreadsheetId: data.spreadsheetId, tabGids: data.tabGids }, devNotes: opts.devNotes, config, planEvents: events }),
    opts.ticketFilters,
  );

  console.log(`\n🎟️  Total ticket instances to generate: ${tickets.length}`);

  const tooLong = tickets.filter((t) => t.description.length > JIRA_DESCRIPTION_LIMIT);
  for (const t of tooLong) {
    console.warn(`   ⚠️  Description is ${t.description.length} chars (Jira max ${JIRA_DESCRIPTION_LIMIT}): ${t.summary}`);
  }
  if (tooLong.length > 0) console.warn('      Jira will reject these — try --no-dev-notes, or split the properties across events.');

  if (opts.debugRouting) writeRoutingReport(tickets);

  if (tickets.length === 0) {
    console.log('\nNothing to do — no tickets match the filters.');
    return;
  }

  // ─── Output ───
  if (isDryRun) printPreview(tickets, opts);

  if (opts.isExport) {
    const exportOpts = { outputDir: './output' };
    const filePath = opts.format === 'csv' ? exportToCsv(tickets, exportOpts) : exportToXlsx(tickets, exportOpts);
    console.log(`\n📦 Exported ${plural(tickets.length, 'ticket')} to: ${filePath}`);
  }

  if (opts.isLive) await createInJira(tickets, opts);
}

// ─── Dry run ───

function printPreview(tickets, opts) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('DRY RUN — Ticket Preview');
  console.log('─'.repeat(60));

  let withQuestions = 0;
  for (const [i, ticket] of tickets.entries()) {
    const fields = (ticket.properties || ticket.traits || []).length;
    const questions = getOpenQuestions(ticket);
    if (questions.length > 0) withQuestions++;

    console.log(`\n[${i + 1}/${tickets.length}] ${ticket.summary}`);
    console.log(`    ${ticket.priority} · ${ticket.templateType} · ${ticket.platform} · ${tabLabel(ticket)} row ${ticket.sourceRow} · ${ticket.fingerprint}`);
    console.log(`    ${ticket.tabType === 'identify' ? 'Traits' : 'Properties'}: ${fields}` + (questions.length > 0 ? ` · ⚠️  ${plural(questions.length, 'open question')}` : ''));
    if (opts.verbose) {
      for (const q of questions) console.log(`      - ${q.replace(/\{\{|\}\}/g, '')}`);
      console.log(`\n${ticket.description}\n${'·'.repeat(60)}`);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ ${plural(tickets.length, 'ticket')} previewed.`);
  if (withQuestions > 0) {
    console.log(`⚠️  ${plural(withQuestions, 'ticket')} with open questions about the spec — they're listed at the top of each ticket's Developer Notes.`);
  }
  if (!opts.verbose) console.log('   Add --verbose to see full descriptions.');

  const base = process.argv
    .slice(2)
    .filter((a) => !['--verbose', '--debug-routing'].includes(a))
    .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
    .join(' ');
  const command = (mode) => ['node src/index.js', base, mode].filter(Boolean).join(' ');
  console.log(`\nTo export for Jira import:  ${command('--export')}`);
  console.log(`To create them in Jira:     ${command('--live')}`);
}

// ─── Live ───

async function createInJira(tickets, opts) {
  let config;
  try {
    config = await detectJiraSetup(getJiraConfig());
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  }
  console.log(`\n🔌 Connected to Jira ${config.deploymentType} at ${config.baseUrl}${config.epicKey ? ` (epic field: ${config.epicField})` : ''}`);

  // Skip tickets an earlier run (or CSV import) already created
  let existing = { byFingerprint: new Map(), bySummary: new Map() };
  if (!opts.force) {
    console.log(`🔎 Checking ${config.projectKey} for tickets from earlier runs...`);
    try {
      existing = await findExistingTickets(config);
    } catch (err) {
      console.error(`❌ Couldn't search Jira for existing tickets: ${err.message}`);
      console.error('   Fix the error above, or re-run with --force to create tickets without checking.');
      process.exit(1);
    }
  }

  const planned = tickets.map((ticket) => ({
    ticket,
    existingKey: existing.byFingerprint.get(ticket.fingerprint) || existing.bySummary.get(ticket.summary),
  }));
  const toCreate = planned.filter((p) => !p.existingKey);
  const alreadyExist = planned.length - toCreate.length;

  if (alreadyExist > 0) console.log(`   ⏭️  ${plural(alreadyExist, 'ticket')} already in Jira — skipping (use --force to create anyway)`);
  if (toCreate.length === 0) {
    console.log('\n✨ Nothing new to create.');
    return;
  }

  const target = `${config.projectKey}${config.epicKey ? ` under ${config.epicKey}` : ''}`;
  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.error(`\n❌ About to create ${plural(toCreate.length, 'ticket')} in ${target}, but this isn't an interactive terminal. Re-run with --yes to confirm.`);
      process.exit(1);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nCreate ${plural(toCreate.length, `${config.issueType} ticket`)} in ${target}? (y/N) `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Cancelled — nothing was created.');
      return;
    }
  }

  // Results are appended as we go, so the file is complete even if the run is interrupted
  const resultsPath = outputPath('./output', 'jira-results', 'csv');
  fs.writeFileSync(resultsPath, toCsv([RESULT_HEADERS]) + '\n', 'utf-8');
  const record = (status, ticket, { key = '', url = '', error = '' } = {}) => {
    fs.appendFileSync(resultsPath, toCsv([resultRow(status, ticket, key, url, error)]) + '\n', 'utf-8');
  };

  for (const p of planned.filter((p) => p.existingKey)) {
    record('skipped-existing', p.ticket, { key: p.existingKey, url: issueUrl(config, p.existingKey) });
  }

  console.log(`\n🔴 Creating ${plural(toCreate.length, 'ticket')} in ${target}...\n`);

  let created = 0;
  let failed = 0;
  for (const { ticket } of toCreate) {
    try {
      const { key, url } = await createJiraTicket(ticket, config);
      console.log(`  🎟️  ${key} — ${ticket.summary}`);
      record('created', ticket, { key, url });
      created++;
    } catch (err) {
      console.error(`  ❌ Failed: "${ticket.summary}" — ${err.message}`);
      record('failed', ticket, { error: err.message });
      failed++;
    }
  }

  console.log(`\n✨ Done. ${created} created, ${failed} failed, ${alreadyExist} skipped (already in Jira).`);
  console.log(`📝 Results (issue keys + links, ready to paste back into the plan): ${resultsPath}`);
  if (failed > 0) process.exitCode = 1;
}

const RESULT_HEADERS = ['status', 'issue_key', 'issue_url', 'summary', 'event_name', 'tab', 'template_instance', 'platform', 'priority', 'source_row', 'fingerprint', 'error'];

function resultRow(status, t, key, url, error) {
  return [status, key, url, t.summary, t.eventName || t.whenFired || '', tabLabel(t), t.instanceLabel, t.platform, t.priority, t.sourceRow, t.fingerprint, error];
}

// ─── Routing debug report ───

function writeRoutingReport(tickets) {
  const headers = [
    'event_name',
    'tab_type',
    'priority',
    'source_raw',
    'template_instance',
    'resolved_template_type',
    'platform',
    'routing_reason',
    'source_row',
    'fingerprint',
    'ticket_in_plan',
    'page_load',
    'open_questions',
  ];

  const rows = tickets.map((t) => [
    t.eventName || t.whenFired || '',
    t.tabType || '',
    t.priority || '',
    t.generatingSource || '',
    t.instanceLabel || '',
    t.templateType || '',
    t.platform || '',
    t.routingReason || '',
    t.sourceRow || '',
    t.fingerprint || '',
    t.existingTicket || '',
    t.pageLoad ? 'yes' : '',
    getOpenQuestions(t).length,
  ]);

  const debugPath = outputPath('./output', 'routing-debug', 'csv');
  fs.writeFileSync(debugPath, toCsv([headers, ...rows]), 'utf-8');
  console.log(`🧭 Routing debug report written: ${debugPath}`);
}

// ─── Helpers ───

function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function tabLabel(ticket) {
  return ticket.tabType.charAt(0).toUpperCase() + ticket.tabType.slice(1);
}

function describeFilters({ eventFilters: e, ticketFilters: t }) {
  const parts = [];
  if (e.priorities.length) parts.push(`priority ${e.priorities.join(', ')}`);
  if (e.types.length) parts.push(`type ${e.types.join(', ')}`);
  if (t.platforms.length) parts.push(`platform ${t.platforms.join(', ')}`);
  if (e.eventQuery) parts.push(`event contains "${e.eventQuery}"`);
  if (e.skipTicketed) parts.push('skip ticketed');
  if (t.limit) parts.push(`first ${t.limit}`);
  return parts.join(' · ');
}

function logTabCounts(heading, events) {
  const count = (type) => events.filter((e) => e.tabType === type).length;
  console.log(`\n${heading}`);
  console.log(`   Track:    ${count('track')}`);
  console.log(`   Identify: ${count('identify')}`);
  console.log(`   Page:     ${count('page')}`);
  console.log(`   Screen:   ${count('screen')}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
