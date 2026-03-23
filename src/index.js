import 'dotenv/config';
import { google } from 'googleapis';
import { createJiraTicket } from './jira.js';
import { parseSheetsData } from './parser.js';
import { getSheetTabs, getTabRows } from './sheets.js';

const DRY_RUN = process.env.DRY_RUN === 'true';

async function main() {
  console.log(`\n🚀 sheets-to-jira starting${DRY_RUN ? ' (DRY RUN — no tickets will be created)' : ''}\n`);

  // --- Auth ---
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheetsClient = google.sheets({ version: 'v4', auth });

  // --- Discover tabs ---
  const tabs = await getSheetTabs(sheetsClient, process.env.SPREADSHEET_ID);
  console.log(`📋 Found ${tabs.length} tab(s): ${tabs.join(', ')}\n`);

  // --- Process each tab ---
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const tab of tabs) {
    console.log(`\n── Tab: "${tab}" ──`);

    const rows = await getTabRows(sheetsClient, process.env.SPREADSHEET_ID, tab);

    if (rows.length < 2) {
      console.log(`  ⚠️  Skipping — no data rows found.`);
      continue;
    }

    const events = parseSheetsData(rows, tab);
    console.log(`  ✅ Parsed ${events.length} event(s)\n`);

    for (const event of events) {
      if (!event.eventName) {
        console.log(`  ⚠️  Skipping row — no event name found.`);
        totalSkipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would create: "${event.eventName}"`);
        console.log(`    Priority: ${event.priority || 'unset'} | Platform: ${event.platform || 'unset'} | Owner: ${event.owner || 'unset'}`);
        totalCreated++;
        continue;
      }

      try {
        const issueKey = await createJiraTicket(event);
        console.log(`  🎟️  Created ${issueKey} — ${event.eventName}`);
        totalCreated++;
      } catch (err) {
        console.error(`  ❌ Failed to create ticket for "${event.eventName}": ${err.message}`);
        totalSkipped++;
      }
    }
  }

  console.log(`\n✨ Done. ${totalCreated} ticket(s) created, ${totalSkipped} skipped.\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
