/**
 * exporter.js — Exports tickets to XLSX matching the Jira Import Template format.
 *
 * Concept: Jira supports CSV/XLSX import. The template has these columns:
 *   Summary | Issue Type | Status | Project key | ... | Priority | Labels | Description | Epic Link
 *
 * We fill Summary, Issue Type, Priority, Labels, Description, and Epic Link.
 */

import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const JIRA_HEADERS = [
  'Summary',
  'Issue Type',
  'Status',
  'Project key',
  'Project name',
  'Project lead',
  'Project description',
  'Project url',
  'Priority',
  'Resolution',
  'Assignee',
  'Reporter',
  'Creator',
  'Created',
  'Updated',
  'Last Viewed',
  'Resolved',
  'Due Date',
  'Votes',
  'Labels',
  'Description',
  'Environment',
  'Watchers',
  'Attachment',
  'Custom field (Epic Link)',
];

const PRIORITY_MAP = {
  P0: 'Highest',
  P0C: 'Highest',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
};

/**
 * Exports rendered tickets to an xlsx file.
 *
 * @param {Array<{ summary, description, priority, platform, templateType }>} renderedTickets
 * @param {Object} opts - { projectKey, epicKey, outputDir }
 * @returns {string} path to the generated xlsx file
 */
export function exportToXlsx(renderedTickets, opts = {}) {
  const {
    projectKey = 'TRACK',
    epicKey = '',
    outputDir = './output',
  } = opts;

  const rows = [JIRA_HEADERS];

  for (const ticket of renderedTickets) {
    const labels = buildLabels(ticket);
    const priority = PRIORITY_MAP[ticket.priority?.toUpperCase()] || 'Medium';

    const row = new Array(JIRA_HEADERS.length).fill('');
    row[0] = ticket.summary;           // Summary
    row[1] = 'Story';                  // Issue Type
    row[3] = projectKey;               // Project key
    row[8] = priority;                 // Priority
    row[19] = labels.join(' ');        // Labels (space-separated for Jira import)
    row[20] = ticket.description;      // Description
    row[24] = epicKey;                 // Epic Link

    rows.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jira Import');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `jira-import-${timestamp}.xlsx`;
  const filePath = path.join(outputDir, fileName);

  XLSX.writeFile(wb, filePath);
  return filePath;
}

function buildLabels(ticket) {
  const labels = ['instrumentation', 'analytics'];
  if (ticket.platform) labels.push(ticket.platform.toLowerCase());
  if (ticket.templateType) labels.push(ticket.templateType);
  return labels;
}
