# events-sheets-to-jira

Reads an event tracking plan from a Google Sheet (via API) or local Excel workbook and generates Jira tickets — one per event instance — under a specified Epic. Built for PM-led instrumentation workflows where the tracking plan is the source of truth.

---

## How it works

```
Google Sheet (API) or .xlsx → reader → parser → enricher → mapper → templates → Jira tickets
```

1. **Reads** a Google Sheet via the Sheets API (recommended) or a local `.xlsx` workbook — either way, expects tabs: Track, Identify, Page, Screen, plus two dictionary tabs (Track Properties Dictionary, Identify Traits Dictionary)
2. **Parses** each tab's event groups — priority, event name, trigger, properties/traits
3. **Enriches** properties/traits with type, description, and example values from the dictionary tabs
4. **Maps** each event to one or more ticket instances based on templates (e.g. "Checkout Started" fires on 6 different web/mobile templates → 6 tickets)
5. **Renders** each instance into Jira wiki markup using the correct template (Web Track, Web Page, Web Identify, SS Track, SS Identify, Mobile Track, Mobile Screen, Mobile Identify), plus generated [Developer Notes](#developer-notes)
6. **Creates** Jira Stories via REST API, skipping ones that already exist, or exports to `.xlsx`/`.csv` for Jira import

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/snapswerve/events-sheets-to-jira.git
cd events-sheets-to-jira
npm install
```

Want to see the output before connecting anything? `npm run sample` builds a small fictional plan ([examples/build-sample-plan.js](examples/build-sample-plan.js)) and runs a dry run against it.

### 2. Connect your eventing plan

Tickets link back to the plan, down to the event's row. The link is set in your local `.env` (see [Local company settings](#local-company-settings)) so it never ends up in this public repo.

**Option A: Google Sheets API (recommended — always reads the latest version)**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select an existing one)
3. Enable the **Google Sheets API**: APIs & Services → Library → search "Google Sheets API" → Enable
4. Create a **Service Account**: APIs & Services → Credentials → Create Credentials → Service Account
5. Create a **JSON key** for the service account: click the service account → Keys → Add Key → JSON
6. Save the downloaded file as `service-account-key.json` in the project root (it's gitignored)
7. **Share your Google Sheet** with the service account's email address (it looks like `name@project-id.iam.gserviceaccount.com`) — give it Viewer access

Then set these in your `.env`:
```
GOOGLE_SHEETS_MODE=true
GOOGLE_SPREADSHEET_ID=your-spreadsheet-id-from-the-url
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json
```

**Option B: Local `.xlsx` file (fallback — for when API access isn't available)**

Download the plan (File → Download → Microsoft Excel) and place it at `./data/cr-eventing-plan.xlsx` (this file is gitignored — it contains company-specific data).

Then set this in your `.env`:
```
EVENTING_PLAN_PATH=./data/cr-eventing-plan.xlsx
```

Either way, the workbook should have these tabs:
| Tab | Purpose |
|---|---|
| `Track` | Track events with properties |
| `Identify` | Identify calls with traits |
| `Page` | Web page view events |
| `Screen` | Mobile screen view events |
| `Track Properties Dictionary` | Property name → type, description, examples |
| `Identify Traits Dictionary` | Trait name → type, description, examples |

Columns are found by **header name**, not position, so adding or reordering columns in the plan is safe. If a required header (e.g. `Event Name`, `Properties`, `Traits`) is renamed, that tab is skipped with a warning — add the new name to `TAB_SPECS` in `parser.js`.

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in your values:

| Variable | What it is |
|---|---|
| `GOOGLE_SHEETS_MODE` | Set to `true` to read live from Google Sheets (default: `false`) |
| `GOOGLE_SPREADSHEET_ID` | The spreadsheet ID from the Google Sheets URL |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Path to your service account JSON key file |
| `EVENTING_PLAN_PATH` | Path to your `.xlsx` file (fallback, default: `./data/cr-eventing-plan.xlsx`) |
| `EVENTING_PLAN_URL` | The plan link shown in tickets (falls back to one built from `GOOGLE_SPREADSHEET_ID`) |
| `EVENTING_PLAN_TAB_GIDS` | xlsx mode only — tab IDs for row-level links, e.g. `Track:123,Identify:456,Page:0,Screen:789` (the number after `#gid=` when the tab is open) |
| `JIRA_BASE_URL` | Your Jira, e.g. `https://jira.your-company.com` (Data Center) or `https://your-org.atlassian.net` (Cloud) |
| `JIRA_PAT` | Jira Data Center/Server: a personal access token (your Jira profile → Personal Access Tokens) |
| `JIRA_EMAIL` + `JIRA_API_TOKEN` | Jira Cloud instead of `JIRA_PAT`: your Atlassian email and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEY` | Your Jira project key (e.g. `TRACK`) |
| `JIRA_EPIC_KEY` | The Epic to link all tickets to (e.g. `TRACK-123`) |
| `JIRA_ISSUE_TYPE` | Optional — issue type to create (default: `Story`) |
| `JIRA_EPIC_FIELD` | Optional — normally detected: `parent` on Jira Cloud, the Epic Link custom field on Data Center/Server. Set it (e.g. `customfield_10008`) to override |
| `JIRA_EXTRA_LABELS` | Optional — comma-separated labels added to every ticket (e.g. `q4-launch,web-team`) |

### Local company settings

This repo is public, so anything that points into company systems stays on your machine:

- **Plan link and tab IDs** go in `.env` (gitignored): `EVENTING_PLAN_URL`, plus `EVENTING_PLAN_TAB_GIDS` if you use the xlsx file
- **Team notes** go in `data/team-notes.json` (gitignored) — copy [`data/team-notes.example.json`](data/team-notes.example.json) to start

If no plan link is set, tickets still render; they just say "eventing plan" without a link, and the CLI warns you.

### 4. (Optional) Template overrides

If the `Templates` column in your xlsx is stale or has duplicates, you can override it per event in `data/template-overrides.json`:

```json
{
  "Shopping link Clicked": [
    "chat web",
    "chat mobile app",
    "product model web",
    "car model web",
    "product model mobile app",
    "car model mobile app"
  ]
}
```

Each entry = one Jira ticket. Mobile keywords (`mobile`, `app`, `native`) auto-select the Mobile Track template.

---

## Usage

```bash
# Dry run — preview all tickets
node src/index.js

# Dry run — P0 and P1 track events only, with full descriptions
node src/index.js --priority P0,P1 --type track --verbose

# Just the checkout events, web only
node src/index.js --event checkout --platform web

# Export to xlsx (or --format csv) for Jira import
node src/index.js --priority P1 --export

# Live — try one ticket first, then the rest
node src/index.js --priority P1 --live --limit 1
node src/index.js --priority P1 --live
```

| Option | What it does |
|---|---|
| `--live` | Create tickets in Jira. Skips ones that already exist, then asks you to confirm |
| `--export` / `--format xlsx\|csv` | Write a Jira import file to `./output` |
| `--priority P0,P1` | Only these priorities |
| `--type track,identify,page,screen` | Only these tabs |
| `--platform web,mobile,server` | Only tickets routed to these platforms |
| `--event <text>` | Only events whose name (or identify trigger) contains the text |
| `--skip-ticketed` | Leave out events whose Jira Tickets column in the plan already lists a ticket |
| `--limit N` | Only the first N tickets |
| `--verbose` | Dry run: print every full description and its open questions |
| `--no-dev-notes` | Leave the Developer Notes section out of descriptions |
| `--debug-routing` | Write a CSV explaining how each ticket was routed to a template |
| `--yes` | Live: skip the confirmation prompt (for scripts/CI) |
| `--force` | Live: create tickets even if a matching one already exists |

Unknown or mistyped options stop the run instead of being ignored, so a typo like `--priorty` can't turn into "create every ticket". `node src/index.js --help` lists everything.

The npm scripts are shortcuts for the same commands: `npm run dry-run`, `npm run export -- --priority P1`, `npm run live -- --priority P1`, `npm run sample`, `npm test`.

### Re-running safely

Every ticket gets a fingerprint label (e.g. `tp-3f9a1c2b10`) built from its tab, event, and template. Before creating anything, `--live` checks whether it's talking to Jira Cloud or Data Center, searches the project for tickets labeled `instrumentation`, and skips any whose fingerprint or exact summary already exists. Running the same command twice won't create duplicates. This also covers tickets made by older versions of the tool (matched by summary) and tickets brought in through CSV import (exports carry the fingerprint label too).

Each live run writes `output/jira-results-<timestamp>.csv` with the status, issue key, and link for every ticket. Rows are added as tickets are created, so the file is complete even if a run is interrupted, and you can paste the keys back into the plan's Ticket column.

Jira rate limits (HTTP 429/503) are retried automatically, honoring `Retry-After`.

### Output

Each Jira ticket gets:
- **Summary:** `[Instrumentation] {Platform} {Type}: {Event Name} ({template})`
- **Description:** Full Jira wiki markup with event spec, properties table, example payload, [Developer Notes](#developer-notes), Segment docs links, and acceptance criteria
- **Priority:** P0→Highest, P1→High, P2→Medium, P3→Low
- **Labels:** `instrumentation`, `analytics`, `{platform}`, `{template-type}`, `tp-{fingerprint}`, plus any `JIRA_EXTRA_LABELS`
- **Epic:** Set from `JIRA_EPIC_KEY`

### Developer Notes

Each description includes a Developer Notes section generated from the plan row, so engineers don't have to cross-reference the sheet:

| Section | What's in it |
|---|---|
| **(!) Open questions** | Gaps found in the spec: properties missing from the dictionary (type was guessed), unset required/optional status, missing trigger, a platform guessed from Generating Source, or a ticket already listed in the plan. Only shown when there's something to resolve |
| **Team notes** | Standing instructions from your local `data/team-notes.json`, scoped by platform or template (e.g. "call the shared page tracking opt-out on these pages", with a link to its ticket). Edit that file to add or change notes, no code needed |
| **Implementation** | A copy-paste call for the platform's SDK: Analytics.js for web, Analytics React Native for mobile, Java for server-side. It has every property, a typed sample value from the dictionary, and a `// type, status` comment |
| **Implementation checklist** | Platform-specific pitfalls: exact naming, typed values, omitting empty values, duplicate firing, SPA route changes, unload timing, mobile batching, server-side `userId`/`anonymousId` stitching, flushing on shutdown |
| **How to verify** | Step-by-step QA for the platform (Segment Inspector / debug build / staging), ending in a Protocols check |
| **Tracking plan context** | Link to the event's row, template/surface, owning team, product section, rollout status, and the plan's **Comments** and **Code Example** columns |

The properties list is a table: **property, type, description, example values, status**. Nested properties from the plan (`address.city`, `products.$.sku`, where `$` is an array item) are listed by their full path in the table and expanded into real nested objects/arrays in the snippet and example payload.

Use `--no-dev-notes` if you want the original, spec-only description.

---

## Architecture

```
src/
├── index.js        # CLI entry point — parses args, previews/exports/creates
├── columns.js      # Finds tab columns by header name
├── pipeline.js     # parse → enrich → filter → map → render (shared by CLI and tests)
├── reader.js       # Reads the plan from Google Sheets or xlsx into raw 2D arrays per tab
├── parser.js       # Parses multi-row event groups from each tab type
├── enricher.js     # Enriches properties/traits from dictionary tabs
├── mapper.js       # Maps events → ticket instances (one per template) + fingerprints
├── templates.js    # 8 Jira wiki markup templates matching Segment doc types
├── dev-notes.js    # Developer Notes: snippets, checklist, QA steps, open questions, properties table
├── links.js        # Links back to the CR plan, down to the event's row
├── jira.js         # Jira REST API, Cloud and Data Center (create, find existing, retries)
├── jira-fields.js  # Priority map, labels, fingerprints — shared by jira.js and exporter.js
├── exporter.js     # Exports to xlsx/csv matching Jira import format
└── sheets.js       # Google Sheets API helpers
data/
├── team-notes.example.json  # Format for data/team-notes.json (local, gitignored)
└── template-overrides.json
examples/
└── build-sample-plan.js   # Fictional plan in the CR layout, for trying the tool and for tests
test/
├── pipeline.test.js       # End-to-end tests against the sample plan (npm test)
└── jira.test.js           # Jira client against a mock Cloud and Data Center API
```

---

## Customization

This tool is built for a specific workbook format but is designed to be forked and adapted:

- **Different column headers?** Edit `TAB_SPECS` in `parser.js` — each field lists the header names it accepts
- **Standing notes for developers?** Add them to `data/team-notes.json`
- **Different Jira templates?** Edit `templates.js` — each function returns `{ summary, description }`
- **Different developer notes?** Edit `dev-notes.js` — e.g. swap the SDK snippets if your mobile app is native iOS/Android rather than React Native
- **Different priority mapping?** Edit the `PRIORITY_MAP` in `jira-fields.js`
- **Add new tab types?** Add a parse function in `parser.js`, enrich in `enricher.js`, map in `mapper.js`

---

## License

MIT
