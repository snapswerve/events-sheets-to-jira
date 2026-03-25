/**
 * exporter.js — Exports tickets to XLSX/CSV matching Jira import needs.
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

function buildRows(renderedTickets, opts = {}) {
  const {
    projectKey = process.env.JIRA_PROJECT_KEY || 'DP',
    epicKey = process.env.JIRA_EPIC_KEY || 'DP-117',
  } = opts;

  const rows = [JIRA_HEADERS];

  for (const ticket of renderedTickets) {
    const labels = buildLabels(ticket);
    const priority = PRIORITY_MAP[ticket.priority?.toUpperCase()] || 'Medium';

    const row = new Array(JIRA_HEADERS.length).fill('');
    row[0] = ticket.summary;
    row[1] = 'Story';
    row[3] = projectKey;
    row[8] = priority;
    row[19] = labels.join(' ');
    row[20] = ticket.description;
    row[24] = epicKey;

    rows.push(row);
  }

  return rows;
}

export function exportToXlsx(renderedTickets, opts = {}) {
  const { outputDir = './output' } = opts;
  const rows = buildRows(renderedTickets, opts);

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

export function exportToCsv(renderedTickets, opts = {}) {
  const { outputDir = './output' } = opts;
  const rows = buildRows(renderedTickets, opts);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `jira-import-${timestamp}.csv`;
  const filePath = path.join(outputDir, fileName);

  const csv = rows
    .map((row) => row.map(csvSafe).join(','))
    .join('\n');

  fs.writeFileSync(filePath, csv, 'utf-8');
  return filePath;
}

function csvSafe(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildLabels(ticket) {
  const labels = ['instrumentation', 'analytics'];
  if (ticket.platform) labels.push(ticket.platform.toLowerCase());
  if (ticket.templateType) labels.push(ticket.templateType);
  return labels;
}
