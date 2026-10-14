/**
 * jira.js — Jira REST API integration (Cloud and Data Center/Server)
 *
 * Creates one Jira issue per rendered ticket, and looks up tickets this tool already
 * created so re-runs don't make duplicates.
 *
 * Auth: JIRA_PAT (personal access token, Data Center) is sent as a Bearer token;
 * otherwise Basic auth with JIRA_EMAIL + JIRA_API_TOKEN (Cloud).
 *
 * Cloud and Data Center differ in two ways we care about, so detectJiraSetup() asks the server:
 *   - search: Cloud uses /rest/api/3/search/jql; Data Center uses /rest/api/2/search
 *   - epics:  Cloud links via the "parent" field; Data Center uses the Epic Link custom field
 *
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 *       https://docs.atlassian.com/software/jira/docs/api/REST/latest/
 */

import { buildLabels, jiraPriority, FINGERPRINT_PREFIX } from './jira-fields.js';

const EPIC_LINK_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-link';
const MAX_RETRIES = 4;

/**
 * Reads and validates Jira settings from the environment. Throws listing every missing variable.
 */
export function getJiraConfig() {
  const env = process.env;
  const required = ['JIRA_BASE_URL', 'JIRA_PROJECT_KEY', ...(env.JIRA_PAT ? [] : ['JIRA_EMAIL', 'JIRA_API_TOKEN'])];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    const hint = env.JIRA_PAT ? '' : ' (or JIRA_PAT for a Data Center personal access token)';
    throw new Error(`Missing Jira settings in .env: ${missing.join(', ')}${hint}`);
  }

  return {
    baseUrl: env.JIRA_BASE_URL.replace(/\/+$/, ''),
    authorization: env.JIRA_PAT
      ? `Bearer ${env.JIRA_PAT}`
      : `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`,
    projectKey: env.JIRA_PROJECT_KEY,
    epicKey: env.JIRA_EPIC_KEY || '',
    // Blank = detect: "parent" on Cloud, the Epic Link custom field on Data Center
    epicField: env.JIRA_EPIC_FIELD || '',
    issueType: env.JIRA_ISSUE_TYPE || 'Story',
  };
}

/**
 * Asks Jira what it is (Cloud vs Data Center/Server) and fills in the settings that depend on it.
 * Also confirms the credentials work before anything is created.
 */
export async function detectJiraSetup(config) {
  const info = await jiraRequest(config, 'GET', '/rest/api/2/serverInfo');
  const isCloud = info.deploymentType === 'Cloud';

  let epicField = config.epicField;
  if (!epicField && config.epicKey) {
    epicField = isCloud ? 'parent' : await findEpicLinkField(config);
  }
  return { ...config, isCloud, epicField, deploymentType: info.deploymentType || 'Server' };
}

async function findEpicLinkField(config) {
  const fields = await jiraRequest(config, 'GET', '/rest/api/2/field');
  const epicLink = fields.find((f) => f.schema?.custom === EPIC_LINK_SCHEMA);
  if (!epicLink) {
    throw new Error("Couldn't find this Jira's Epic Link field — set JIRA_EPIC_FIELD in .env (e.g. customfield_10008)");
  }
  return epicLink.id;
}

/**
 * Creates a single Jira issue via the API.
 * @param {Object} renderedTicket - { summary, description, priority, platform, templateType, fingerprint }
 * @returns {{ key: string, url: string }} The created issue key (e.g. "TRACK-42") and browse URL
 */
export async function createJiraTicket(renderedTicket, config) {
  const epic = !config.epicKey
    ? {}
    : config.epicField === 'parent'
      ? { parent: { key: config.epicKey } }
      : { [config.epicField]: config.epicKey };

  // Jira REST API v3 uses ADF for descriptions, but wiki markup is supported
  // via the v2 endpoint. We use v2 here since our templates are wiki markup.
  const body = {
    fields: {
      project: { key: config.projectKey },
      summary: renderedTicket.summary,
      description: renderedTicket.description,
      issuetype: { name: config.issueType },
      priority: { name: jiraPriority(renderedTicket.priority) },
      labels: buildLabels(renderedTicket),
      ...epic,
    },
  };

  const data = await jiraRequest(config, 'POST', '/rest/api/2/issue', body);
  return { key: data.key, url: issueUrl(config, data.key) };
}

/**
 * Finds tickets this tool already created in the project (label "instrumentation").
 * Returns lookups by fingerprint label and by exact summary — the summary lookup catches
 * tickets created before fingerprint labels existed.
 * @param {Object} config - from detectJiraSetup()
 */
export async function findExistingTickets(config) {
  const byFingerprint = new Map();
  const bySummary = new Map();
  const query = {
    jql: `project = "${config.projectKey}" AND labels = instrumentation`,
    fields: ['summary', 'labels'],
    maxResults: 100,
  };

  const collect = (issues = []) => {
    for (const issue of issues) {
      const { summary, labels = [] } = issue.fields || {};
      if (summary && !bySummary.has(summary)) bySummary.set(summary, issue.key);
      for (const label of labels) {
        if (label.startsWith(FINGERPRINT_PREFIX)) byFingerprint.set(label, issue.key);
      }
    }
  };

  if (config.isCloud) {
    // Cloud: token-paginated enhanced search (the v2/v3 /search endpoints were retired on Cloud)
    let nextPageToken;
    do {
      const data = await jiraRequest(config, 'POST', '/rest/api/3/search/jql', { ...query, ...(nextPageToken ? { nextPageToken } : {}) });
      collect(data.issues);
      nextPageToken = data.isLast === false ? data.nextPageToken : undefined;
    } while (nextPageToken);
  } else {
    // Data Center/Server: offset-paginated v2 search
    let startAt = 0;
    let total;
    do {
      const data = await jiraRequest(config, 'POST', '/rest/api/2/search', { ...query, startAt });
      const issues = data.issues || [];
      collect(issues);
      total = data.total ?? 0;
      startAt += issues.length;
      if (issues.length === 0) break;
    } while (startAt < total);
  }

  return { byFingerprint, bySummary };
}

export function issueUrl(config, key) {
  return `${config.baseUrl}/browse/${key}`;
}

/**
 * Sends a request, retrying when Jira rate-limits (429) or is briefly unavailable (503).
 * Other errors are not retried — a failed create may still have created the issue.
 */
async function jiraRequest(config, method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: config.authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.ok) return response.json();
    if (response.status === 401) {
      throw new Error('Jira rejected the credentials (401) — check JIRA_PAT, or JIRA_EMAIL + JIRA_API_TOKEN for Jira Cloud');
    }

    const retryable = response.status === 429 || response.status === 503;
    if (!retryable || attempt >= MAX_RETRIES) {
      const errorText = await response.text();
      throw new Error(`Jira API error ${response.status}: ${errorText}`);
    }

    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    console.warn(`  ⏳ Jira returned ${response.status} — retrying in ${Math.ceil(waitMs / 1000)}s...`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
