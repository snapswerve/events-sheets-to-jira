/**
 * exporter.js — Exports tickets to XLSX/CSV matching Jira import needs.
 */

import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { buildLabels, jiraPriority } from './jira-fields.js';

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

function buildRows(renderedTickets, opts = {}) {
  const {
    projectKey = process.env.JIRA_PROJECT_KEY || '',
    epicKey = process.env.JIRA_EPIC_KEY || '',
    issueType = process.env.JIRA_ISSUE_TYPE || 'Story',
  } = opts;

  const rows = [JIRA_HEADERS];

  for (const ticket of renderedTickets) {
    const row = new Array(JIRA_HEADERS.length).fill('');
    row[0] = ticket.summary;
    row[1] = issueType;
    row[3] = projectKey;
    row[8] = jiraPriority(ticket.priority);
    row[19] = buildLabels(ticket).join(' ');
    row[20] = ticket.description;
    row[24] = epicKey;

    rows.push(row);
  }

  return rows;
}

export function exportToXlsx(renderedTickets, opts = {}) {
  const rows = buildRows(renderedTickets, opts);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jira Import');

  const filePath = outputPath(opts.outputDir, 'jira-import', 'xlsx');
  XLSX.writeFile(wb, filePath);
  return filePath;
}

export function exportToCsv(renderedTickets, opts = {}) {
  const filePath = outputPath(opts.outputDir, 'jira-import', 'csv');
  fs.writeFileSync(filePath, toCsv(buildRows(renderedTickets, opts)), 'utf-8');
  return filePath;
}

/**
 * Returns ./output/<prefix>-<timestamp>.<ext>, creating the directory if needed.
 * The timestamp includes the time so repeated runs on the same day don't overwrite each other.
 */
export function outputPath(outputDir = './output', prefix, ext) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return path.join(outputDir, `${prefix}-${timestamp}.${ext}`);
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvSafe).join(',')).join('\n');
}

function csvSafe(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
