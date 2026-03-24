/**
 * reader.js — Reads the eventing plan from Google Sheets (live) or xlsx (local fallback).
 *
 * Concept: When GOOGLE_SHEETS_MODE=true, we use the Google Sheets API via a service account
 * to read the latest data. Otherwise, we read a downloaded .xlsx file using the xlsx library.
 * Both paths return the same shape: { track, identify, page, screen, trackDict, identifyDict, sheetNames }.
 */

import XLSX from 'xlsx';
import { google } from 'googleapis';
import fs from 'fs';

const TAB_NAMES = {
  track: 'Track',
  identify: 'Identify',
  page: 'Page',
  screen: 'Screen',
  trackDict: 'Track Properties Dictionary',
  identifyDict: 'Identify Traits Dictionary',
  protocolsImport: 'Protocols Import',
};

/**
 * Main entry: reads the eventing plan from the best available source.
 */
export async function readEventingPlan() {
  const useSheets = process.env.GOOGLE_SHEETS_MODE === 'true';

  if (useSheets) {
    console.log('📡 Reading live from Google Sheets...');
    return readFromGoogleSheets();
  }

  const filePath = process.env.EVENTING_PLAN_PATH || './data/eventing-plan.xlsx';
  console.log(`📁 Reading local file: ${filePath}`);
  return readFromXlsx(filePath);
}

/**
 * Reads from a local .xlsx file.
 */
function readFromXlsx(filePath) {
  const wb = XLSX.readFile(filePath);

  const getSheet = (name) => {
    const ws = wb.Sheets[name];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1 });
  };

  return {
    track: getSheet(TAB_NAMES.track),
    identify: getSheet(TAB_NAMES.identify),
    page: getSheet(TAB_NAMES.page),
    screen: getSheet(TAB_NAMES.screen),
    trackDict: getSheet(TAB_NAMES.trackDict),
    identifyDict: getSheet(TAB_NAMES.identifyDict),
    protocolsImport: getSheet(TAB_NAMES.protocolsImport),
    sheetNames: wb.SheetNames,
  };
}

/**
 * Reads live from Google Sheets using a service account.
 */
async function readFromGoogleSheets() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './service-account-key.json';

  if (!spreadsheetId) {
    throw new Error('GOOGLE_SPREADSHEET_ID is required when GOOGLE_SHEETS_MODE=true');
  }
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Service account key not found at ${keyPath}. See README for setup instructions.`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Get all sheet names
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetNames = meta.data.sheets.map((s) => s.properties.title);

  const getTab = async (name) => {
    if (!sheetNames.includes(name)) return [];
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: name,
    });
    return res.data.values || [];
  };

  // Fetch all tabs in parallel
  const [track, identify, page, screen, trackDict, identifyDict, protocolsImport] = await Promise.all([
    getTab(TAB_NAMES.track),
    getTab(TAB_NAMES.identify),
    getTab(TAB_NAMES.page),
    getTab(TAB_NAMES.screen),
    getTab(TAB_NAMES.trackDict),
    getTab(TAB_NAMES.identifyDict),
    getTab(TAB_NAMES.protocolsImport),
  ]);

  return { track, identify, page, screen, trackDict, identifyDict, protocolsImport, sheetNames };
}
