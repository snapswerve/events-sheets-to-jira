/**
 * jira.js — Jira Cloud REST API v3 integration
 *
 * Creates one Jira issue per event, linked to the Epic in .env.
 * Uses Basic Auth: base64(email:api_token)
 *
 * Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
 */

const JIRA_PRIORITY_MAP = {
  P0: 'Highest',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
};

/**
 * Builds the Jira issue description as Atlassian Document Format (ADF).
 * ADF is the rich-text format Jira Cloud uses internally.
 */
function buildDescription(event) {
  const propertiesRows = event.properties.map((prop) => ({
    type: 'tableRow',
    content: [
      adfCell(prop.name),
      adfCell(prop.type),
      adfCell(prop.required ? 'Yes' : 'No'),
      adfCell(prop.description || '—'),
    ],
  }));

  const nodes = [
    adfHeading('Event Details', 3),
    adfBulletList([
      `**Trigger:** ${event.trigger || 'Not specified'}`,
      `**Platform:** ${event.platform || 'Not specified'}`,
      `**Owner:** ${event.owner || 'Unassigned'}`,
      `**Status:** ${event.status || 'Not Started'}`,
      `**Source:** Tab "${event.sourceTab}", Row ${event.sourceRow}`,
    ]),
  ];

  if (event.properties.length > 0) {
    nodes.push(adfHeading('Event Properties', 3));
    nodes.push({
      type: 'table',
      attrs: { isNumberColumnEnabled: false, layout: 'default' },
      content: [
        {
          type: 'tableRow',
          content: [
            adfHeaderCell('Property'),
            adfHeaderCell('Type'),
            adfHeaderCell('Required'),
            adfHeaderCell('Description'),
          ],
        },
        ...propertiesRows,
      ],
    });
  }

  if (event.notes) {
    nodes.push(adfHeading('Notes', 3));
    nodes.push(adfParagraph(event.notes));
  }

  nodes.push(adfParagraph('---'));
  nodes.push(adfParagraph(`🤖 Created automatically by sheets-to-jira`));

  return { version: 1, type: 'doc', content: nodes };
}

// --- ADF node helpers ---

function adfHeading(text, level) {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

function adfParagraph(text) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

function adfBulletList(items) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [adfParagraph(item)],
    })),
  };
}

function adfCell(text) {
  return {
    type: 'tableCell',
    attrs: {},
    content: [adfParagraph(text)],
  };
}

function adfHeaderCell(text) {
  return {
    type: 'tableHeader',
    attrs: {},
    content: [adfParagraph(text)],
  };
}

/**
 * Maps a priority string like "P0", "High", or "p1" to a Jira priority name.
 */
function resolveJiraPriority(rawPriority) {
  if (!rawPriority) return 'Medium';
  const upper = rawPriority.toUpperCase().trim();
  return JIRA_PRIORITY_MAP[upper] || rawPriority;
}

/**
 * Creates a single Jira issue for one event.
 * Returns the created issue key (e.g. "TRACK-42").
 */
export async function createJiraTicket(event) {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_EPIC_KEY } = process.env;

  const credentials = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

  const body = {
    fields: {
      project: { key: JIRA_PROJECT_KEY },
      summary: `[Instrumentation] ${event.eventName}`,
      description: buildDescription(event),
      issuetype: { name: 'Story' },
      priority: { name: resolveJiraPriority(event.priority) },
      // Link to Epic — Jira Cloud uses "Epic Link" or parent depending on config
      ...(JIRA_EPIC_KEY ? { 'customfield_10014': JIRA_EPIC_KEY } : {}),
      labels: ['instrumentation', 'analytics', event.platform?.toLowerCase()].filter(Boolean),
    },
  };

  const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue`, {
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
