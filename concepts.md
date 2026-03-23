# Concepts Log — sheets-to-jira

_Concepts introduced while building this project._

---

## Google Sheets API
Google exposes spreadsheet data via a REST API. To read a sheet, you authenticate
with a **service account** (a bot account with its own credentials) and request
rows from a named range or tab. The response is a 2D array: rows × columns.

## Jira REST API v3
Jira Cloud has a REST API that lets you create, update, and query issues programmatically.
You authenticate with a **base64-encoded email:api_token** passed as a Basic Auth header.
Creating a ticket = a POST to `/rest/api/3/issue` with a JSON body.

## Service Account vs OAuth
- **Service account** = a non-human account with a credentials JSON file. Good for scripts.
- **OAuth** = user-facing login flow. Good for apps where a real user authorizes access.
For this script, service account is the right choice — no human interaction needed.

## .env Pattern
Secrets (API tokens, spreadsheet IDs) live in `.env` and are loaded via `dotenv`.
`.env` is always gitignored. `.env.example` is committed with placeholder values.
