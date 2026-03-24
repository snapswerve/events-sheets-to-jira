# AGENTS.md — events-sheets-to-jira

> Project-specific rules. Global rules live in `/projects/AGENTS.md` and always apply.

---

## Project Purpose
A Node.js script that reads a Google Sheet containing a multi-tab event tracking plan,
processes each tab's event rows and property columns, and creates Jira tickets
(one per event) under a specified Epic.

## Stack
- **Runtime:** Node.js (plain script, no framework)
- **Google Sheets:** `googleapis` npm package (service account auth)
- **Jira:** Jira Cloud REST API v3 (API token auth)
- **Config:** `.env` file (never committed)

## Rules for goose
- Keep the script a single entry point: `src/index.js`
- Pull config from `.env` — never hardcode credentials
- Log clearly as each ticket is created (event name, Jira issue key)
- Handle errors gracefully — skip bad rows, log the reason, continue
- Comments only where the logic is non-obvious

## Project Path
/Users/codyjuric/projects/events-sheets-to-jira
