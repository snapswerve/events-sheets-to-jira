/**
 * jira.js — Jira Cloud REST API v3 integration
 *
 * Creates one Jira issue per rendered ticket.
 * Uses Basic Auth: base64(email:api_token)
 *
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

const PRIORITY_MAP = {
  P0: 'Highest',
  P0C: 'Highest',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
};

/**
 * Creates a single Jira issue via the API.
 * @param {Object} renderedTicket - { summary, description, priority, platform, templateType }
 * @returns {string} The created issue key (e.g. "TRACK-42")
 */
export async function createJiraTicket(renderedTicket) {
  const {
    JIRA_BASE_URL,
    JIRA_EMAIL,
    JIRA_API_TOKEN,
    JIRA_PROJECT_KEY,
    JIRA_EPIC_KEY,
  } = process.env;

  const credentials = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  // Jira REST API v3 uses ADF for descriptions, but wiki markup is supported
  // via the v2 endpoint. We use v2 here since our templates are wiki markup.
  const body = {
    fields: {
      project: { key: JIRA_PROJECT_KEY },
      summary: renderedTicket.summary,
      description: renderedTicket.description,
      issuetype: { name: 'Story' },
      priority: { name: PRIORITY_MAP[renderedTicket.priority?.toUpperCase()] || 'Medium' },
      labels: buildLabels(renderedTicket),
      ...(JIRA_EPIC_KEY ? { customfield_10014: JIRA_EPIC_KEY } : {}),
    },
  };

  const response = await fetch(`${JIRA_BASE_URL}/rest/api/2/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.key;
}

function buildLabels(ticket) {
  const labels = ['instrumentation', 'analytics'];
  if (ticket.platform) labels.push(ticket.platform.toLowerCase());
  if (ticket.templateType) labels.push(ticket.templateType);
  return labels;
}
