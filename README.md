# events-sheets-to-jira

Reads an event tracking plan from an Excel workbook and generates Jira tickets — one per event instance — under a specified Epic. Built for PM-led instrumentation workflows where the tracking plan is the source of truth.

---

## How it works

```
eventing-plan.xlsx → parser → enricher → mapper → templates → Jira tickets
```

1. **Reads** an `.xlsx` workbook with tabs: Track, Identify, Page, Screen, plus two dictionary tabs (Track Properties Dictionary, Identify Traits Dictionary)
2. **Parses** each tab's event groups — priority, event name, trigger, properties/traits
3. **Enriches** properties/traits with type, description, and example values from the dictionary tabs
4. **Maps** each event to one or more ticket instances based on templates (e.g. "Checkout Started" fires on 6 different web/mobile templates → 6 tickets)
5. **Renders** each instance into Jira wiki markup using the correct template (Web Track, Web Page, Web Identify, SS Track, SS Identify, Mobile Track, Mobile Screen)
6. **Creates** Jira Stories via REST API, or exports to `.xlsx` for Jira CSV import

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/snapswerve/events-sheets-to-jira.git
cd events-sheets-to-jira
npm install
```

### 2. Add your eventing plan

Place your `.xlsx` workbook at `./data/eventing-plan.xlsx` (this file is gitignored — it contains company-specific data).

The workbook should have these tabs:
| Tab | Purpose |
|---|---|
| `Track` | Track events with properties |
| `Identify` | Identify calls with traits |
| `Page` | Web page view events |
| `Screen` | Mobile screen view events |
| `Track Properties Dictionary` | Property name → type, description, examples |
| `Identify Traits Dictionary` | Trait name → type, description, examples |

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in your values:

| Variable | What it is |
|---|---|
| `EVENTING_PLAN_PATH` | Path to your `.xlsx` file (default: `./data/eventing-plan.xlsx`) |
| `JIRA_BASE_URL` | e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | [Create one here](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEY` | Your Jira project key (e.g. `TRACK`) |
| `JIRA_EPIC_KEY` | The Epic to link all tickets to (e.g. `TRACK-123`) |

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

# Dry run — P1 events only
node src/index.js --priority P1

# Export to xlsx for Jira CSV import
node src/index.js --priority P1 --export

# Live — create real Jira tickets
node src/index.js --priority P1 --live
```

### Output

Each Jira ticket gets:
- **Summary:** `[Instrumentation] {Platform} {Type}: {Event Name} ({template})`
- **Description:** Full Jira wiki markup with event spec, properties table, payload example, Segment docs links, and acceptance criteria
- **Priority:** P0→Highest, P1→High, P2→Medium, P3→Low
- **Labels:** `instrumentation`, `analytics`, `{platform}`, `{template-type}`
- **Epic Link:** Set from `JIRA_EPIC_KEY`

---

## Architecture

```
src/
├── index.js        # CLI entry point — parses args, orchestrates pipeline
├── reader.js       # Reads xlsx workbook into raw 2D arrays per tab
├── parser.js       # Parses multi-row event groups from each tab type
├── enricher.js     # Enriches properties/traits from dictionary tabs
├── mapper.js       # Maps events → ticket instances (one per template)
├── templates.js    # 7 Jira wiki markup templates matching Segment doc types
├── jira.js         # Jira REST API v2 integration (create issue)
├── exporter.js     # Exports to xlsx matching Jira import format
└── sheets.js       # Google Sheets helpers (for future live-sheet mode)
```

---

## Customization

This tool is built for a specific workbook format but is designed to be forked and adapted:

- **Different column layout?** Edit `parser.js` — column indices are commented at the top of each function
- **Different Jira templates?** Edit `templates.js` — each function returns `{ summary, description }`
- **Different priority mapping?** Edit the `PRIORITY_MAP` in `jira.js` and `exporter.js`
- **Add new tab types?** Add a parse function in `parser.js`, enrich in `enricher.js`, map in `mapper.js`

---

## License

MIT
