/**
 * sheets.js — Google Sheets helpers
 *
 * Handles tab discovery and row fetching.
 * Returns raw 2D arrays — parsing lives in parser.js.
 */

/**
 * Returns all tab (sheet) names in the spreadsheet.
 */
export async function getSheetTabs(sheetsClient, spreadsheetId) {
  const response = await sheetsClient.spreadsheets.get({ spreadsheetId });
  return response.data.sheets.map((sheet) => sheet.properties.title);
}

/**
 * Returns all rows from a given tab as a 2D array.
 * Row 0 = headers, Row 1+ = data.
 */
export async function getTabRows(sheetsClient, spreadsheetId, tabName) {
  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: tabName,
  });

  return response.data.values || [];
}
