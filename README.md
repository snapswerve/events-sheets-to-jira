# sheets-to-jira

Reads a Google Sheet containing a multi-tab event tracking plan and creates Jira tickets — one per event — under a specified Epic.

---

## What it does

1. Connects to a Google Sheet using a service account
2. Loops through every tab in the spreadsheet
3. Parses each row into a structured event (name, trigger, platform, properties, owner, priority)
4. Creates a Jira Story for each event, formatted with a description table of properties
5. Links each ticket to your Epic

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/sheets-to-jira.git
cd sheets-to-jira
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in your values:

| Variable | What it is |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Path to your service account credentials JSON |
| `SPREADSHEET_ID` | The ID from your Google Sheet URL |
| `JIRA_BASE_URL` | e.g. `https://your-org.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | [Create one here](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEY` | Your Jira project key (e.g. `TRACK`) |
| `JIRA_EPIC_KEY` | The Epic to link all tickets to (e.g. `TRACK-10`) |

### 3. Set up Google Sheets access

1. Create a service account in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Sheets API**
3. Download the credentials JSON — save as `service-account-key.json` in the project root
4. Share your Google Sheet with the service account email (Viewer access is enough)

---

## Running

```bash
# Dry run — see what would be created without touching Jira
npm run dry-run

# Live run — creates real Jira tickets
npm start
```

---

## Sheet format

Each tab in your spreadsheet should have a header row with these column names (order doesn't matter, case-insensitive):

| Column | Required | Notes |
|---|---|---|
| `Event Name` | ✅ | Must be present; rows without this are skipped |
| `Trigger / User Action` | No | What the user does to fire the event |
| `Platform` | No | Web, iOS, Android, Server |
| `Properties` | No | Newline-separated: `cta_text (string, required)` |
| `Owner` | No | Engineer name or team |
| `Priority` | No | P0, P1, P2 |
| `Status` | No | Not Started / In Progress / etc. |
| `Notes` | No | Anything extra |

---

## Output

Each Jira ticket gets:
- **Summary:** `[Instrumentation] {Event Name}`
- **Description:** Event details + properties table (formatted in Atlassian Document Format)
- **Priority:** Mapped from P0→Highest, P1→High, P2→Medium
- **Labels:** `instrumentation`, `analytics`, `{platform}`
- **Epic Link:** Set from `JIRA_EPIC_KEY`
