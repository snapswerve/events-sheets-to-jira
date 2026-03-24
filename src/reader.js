/**
 * reader.js — Reads the CR Eventing Plan xlsx and returns raw data per tab.
 *
 * Concept: xlsx is a JS library that parses Excel files into 2D arrays.
 * Each "sheet" in the workbook becomes a named array of rows.
 */

import XLSX from 'xlsx';

/**
 * Reads the eventing plan workbook and returns structured raw data.
 * @param {string} filePath - Path to the .xlsx file
 * @returns {{ track: any[][], identify: any[][], page: any[][], screen: any[][], trackDict: any[][], identifyDict: any[][] }}
 */
export function readEventingPlan(filePath) {
  const wb = XLSX.readFile(filePath);

  const getSheet = (name) => {
    const ws = wb.Sheets[name];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1 });
  };

  return {
    track: getSheet('Track'),
    identify: getSheet('Identify'),
    page: getSheet('Page'),
    screen: getSheet('Screen'),
    trackDict: getSheet('Track Properties Dictionary'),
    identifyDict: getSheet('Identify Traits Dictionary'),
    protocolsImport: getSheet('Protocols Import'),
    sheetNames: wb.SheetNames,
  };
}
