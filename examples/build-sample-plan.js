/**
 * build-sample-plan.js — Writes a small, fictional tracking plan workbook laid out like the
 * CR event tracking plan (same tabs, same column headers and order), with made-up values. Use it to try the tool
 * without access to the real plan, or as a template when setting up a new one.
 *
 *   node examples/build-sample-plan.js            # → examples/sample-eventing-plan.xlsx
 *   npm run sample                                # builds it and runs a dry run against it
 *
 * It covers all 8 ticket templates plus the cases the Developer Notes handle: nested properties
 * (address.city, products.$.sku), per-property comments, a property missing from the dictionary,
 * an unset status, a platform guessed from Generating Source, and an event that already lists
 * Jira tickets.
 */

import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

export const SAMPLE_PLAN_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sample-eventing-plan.xlsx');

/** Builds rows from objects keyed by header name, so each row reads like the sheet. */
function tab(headers, records) {
  return [headers, ...records.map((record) => headers.map((h) => record[h] ?? ''))];
}

// ─── Track ───
// The unnamed column after Properties holds "Go to Definition" links in the real plan.

const TRACK_HEADERS = ['Priority', 'Generating Source', 'Product Section', 'Event Name', 'When Fired', 'ID state', 'Templates', 'Reviewed by MC', 'Team Ownership', 'Property Priority', 'Properties', '', 'Property Status', 'Jira Tickets', 'Code Example', 'Comments', 'In dev', 'In Stage', 'In Prod', 'Implement Status'];

const track = tab(TRACK_HEADERS, [
  {
    Priority: 'P1', 'Generating Source': 'Web; Mobile', 'Product Section': 'Checkout', 'Event Name': 'Checkout Started',
    'When Fired': 'user views the checkout page with at least one item in the cart', 'ID state': 'Both',
    Templates: 'standard flow\ngift\nnative mobile app', 'Reviewed by MC': true, 'Team Ownership': 'ECQ',
    'Property Priority': 'P1', Properties: 'checkout_id', 'Property Status': 'Required',
    'Code Example': "analytics.track('Checkout Started', { checkout_id, total })",
    Comments: 'Fire once the cart total has loaded — not on the button click that opens checkout.',
    'Implement Status': 'Not Started',
  },
  { 'Property Priority': 'P1', Properties: 'checkout_flow_type', 'Property Status': 'Required' },
  { 'Property Priority': 'P1', Properties: 'total', 'Property Status': 'Required' },
  { 'Property Priority': 'P1', Properties: 'currency', 'Property Status': 'Required' },
  { 'Property Priority': 'P1', Properties: 'products', 'Property Status': 'Required' },
  { 'Property Priority': 'P1', Properties: 'products.$.product_id', 'Property Status': 'Required' },
  { 'Property Priority': 'P1', Properties: 'products.$.sku', 'Property Status': 'Required' },
  { 'Property Priority': 'P1', Properties: 'products.$.price', 'Property Status': 'Required' },
  { 'Property Priority': 'P2', Properties: 'products.$.quantity', 'Property Status': 'Required', Comments: 'always 1 for memberships' },
  { 'Property Priority': 'P2', Properties: 'coupon_code' },
  {
    Priority: 'P0', 'Generating Source': 'Server', 'Product Section': 'Checkout', 'Event Name': 'Order Completed',
    'When Fired': 'the payments service captures payment for an order', 'ID state': 'Identified',
    Templates: 'server side', 'Team Ownership': 'ECQ', 'Property Priority': 'P1', Properties: 'order_id',
    'Property Status': 'Required', 'Jira Tickets': 'DP-42, DP-43', 'In dev': true, 'In Stage': 'Yes', 'In Prod': 'Yes',
    'Implement Status': 'On Prod',
  },
  { 'Property Priority': 'P1', Properties: 'total', 'Property Status': 'Required' },
  { 'Property Priority': 'P2', Properties: 'address.city', 'Property Status': 'Optional' },
  { 'Property Priority': 'P2', Properties: 'address.state', 'Property Status': 'Optional' },
  { 'Property Priority': 'P2', Properties: 'payment_method', 'Property Status': 'Optional' },
  {
    Priority: 'P2', 'Generating Source': 'Web', 'Product Section': 'Search', 'Event Name': 'Products Searched',
    'When Fired': 'user submits a search query', 'ID state': 'Both', 'Team Ownership': 'Search',
    'Property Priority': 'P2', Properties: 'query', 'Property Status': 'Required',
  },
  { 'Property Priority': 'P2', Properties: 'result_count', 'Property Status': 'Optional' },
]);

// ─── Identify ───

const IDENTIFY_HEADERS = ['Priority', 'Generating Source', 'When fires', 'Team Ownership', 'ID state', 'Templates', 'Trait Priority', 'Traits', 'Trait Status', 'Jira Tickets', 'Implement Status', 'In Stage', 'In prod'];

const identify = tab(IDENTIFY_HEADERS, [
  {
    Priority: 'P1', 'Generating Source': 'Web; Mobile', 'When fires': 'Signed Up', 'Team Ownership': 'Growth',
    'ID state': 'Identified', Templates: 'web identify\nmobile identify', 'Trait Priority': 'P1', Traits: 'email',
    'Trait Status': 'Required',
  },
  { 'Trait Priority': 'P1', Traits: 'member_tier', 'Trait Status': 'Optional' },
  { 'Trait Priority': 'P1', Traits: 'created_at', 'Trait Status': 'Required' },
  {
    Priority: 'P2', 'Generating Source': 'Server', 'When fires': 'Subscription Changed', 'Team Ownership': 'ECQ',
    'ID state': 'Identified', Templates: 'server side', 'Trait Priority': 'P2', Traits: 'member_tier', 'Trait Status': 'Required',
  },
]);

// ─── Page / Screen ───
// Intro rows, then the header. Property rows before the first named page are the generic
// page properties (documented on Common Fields) and are skipped.

const PAGE_HEADERS = ['Priority', 'Page Name', 'When Fired', 'ID state', 'Team Ownership', 'Properties', 'Property Description', 'Property Status', 'Jira Tickets', 'Implement Status'];

const page = [
  ['Named Pages'],
  ['Along with the generic page tracking on the Common Fields tab, the following named pages should be tracked with a named Page() call:'],
  ...tab(PAGE_HEADERS, [
    { Properties: 'cia', 'Implement Status': 'On Production' },
    {
      Priority: 'P2', 'Page Name': 'Checkout', 'When Fired': 'Checkout flow pages for subscription, gifting or donation',
      'ID state': 'Both', 'Team Ownership': 'ECQ', Properties: 'old_page_name',
      'Property Description': 'legacy page name, kept for reporting continuity', 'Property Status': 'Required',
    },
    { Properties: 'template_version', 'Property Description': 'version of the template for this page', 'Property Status': 'Required' },
    { Properties: 'cart_value', 'Property Description': 'cart total in USD when the page loads', 'Property Status': 'Optional' },
  ]),
];

const SCREEN_HEADERS = ['Priority', 'Screen Name', 'When Fired', 'ID state', 'Team Ownership', 'Properties', 'Description', 'Property Status', 'Implement Status', 'Jira Tickets'];

const screen = [
  ['Named Screens'],
  ['Along with the generic screen tracking on the Common Fields tab, the following named screens should be tracked with a named Screen() call:'],
  ...tab(SCREEN_HEADERS, [
    {
      Priority: 'P2', 'Screen Name': 'Product Detail', 'When Fired': 'Product detail screen', 'ID state': 'Identified',
      'Team Ownership': 'Mobile', Properties: 'product_id', Description: 'product shown on the screen', 'Property Status': 'Required',
    },
    { Properties: 'source_screen', Description: 'screen the user came from' },
  ]),
];

// ─── Dictionaries ───

const trackDict = tab(['Property', 'Property Type', 'Property Description', 'Example Values', 'Segment SA Comments'], [
  { Property: 'checkout_id', 'Property Type': 'string', 'Property Description': 'ID of checkout', 'Example Values': 'chk_8f2k1' },
  { Property: 'checkout_flow_type', 'Property Type': 'string', 'Property Description': 'which checkout flow', 'Example Values': 'membership, gift, donation' },
  { Property: 'total', 'Property Type': 'decimal', 'Property Description': 'total amount of purchase', 'Example Values': '60.99' },
  { Property: 'currency', 'Property Type': 'string', 'Property Description': 'currency of purchase', 'Example Values': 'USD' },
  { Property: 'products', 'Property Type': 'array', 'Property Description': 'products array', 'Example Values': '{object, object}' },
  { Property: 'products.$.product_id', 'Property Type': 'integer', 'Property Description': 'product ID', 'Example Values': 1234567 },
  { Property: 'products.$.sku', 'Property Type': 'string', 'Property Description': 'product sku', 'Example Values': 'MEMBERSHIP-ANNUAL' },
  { Property: 'products.$.price', 'Property Type': 'decimal', 'Property Description': 'product price amount', 'Example Values': '29.99' },
  { Property: 'products.$.quantity', 'Property Type': 'integer', 'Property Description': 'quantity of the product', 'Example Values': '1' },
  { Property: 'order_id', 'Property Type': 'integer', 'Property Description': 'order/transaction ID', 'Example Values': '100045' },
  { Property: 'address.city', 'Property Type': 'string', 'Property Description': 'city', 'Example Values': 'san francisco' },
  { Property: 'address.state', 'Property Type': 'string', 'Property Description': 'state, province or subcountry section', 'Example Values': 'ca' },
  { Property: 'payment_method', 'Property Type': 'enum', 'Property Description': 'method of payment', 'Example Values': '"credit card", "paypal"' },
  { Property: 'query', 'Property Type': 'string', 'Property Description': 'search text as the user typed it', 'Example Values': 'air fryer' },
  { Property: 'result_count', 'Property Type': 'integer', 'Property Description': 'number of results returned', 'Example Values': 24 },
  { Property: 'old_page_name', 'Property Type': 'string', 'Property Description': 'legacy page name of concatenated values', 'Example Values': 'subcia:supercategory:model:details' },
  { Property: 'template_version', 'Property Type': 'string', 'Property Description': 'version of the template for this page', 'Example Values': 'version 1' },
  { Property: 'cart_value', 'Property Type': 'decimal', 'Property Description': 'cart total in USD', 'Example Values': 120.5 },
  { Property: 'product_id', 'Property Type': 'string', 'Property Description': 'product identifier', 'Example Values': 'p_123' },
]);

const identifyDict = tab(['Priority', 'Trait', 'Data Type', 'Description', 'Example Values', 'When fired'], [
  { Priority: 'P1', Trait: 'email', 'Data Type': 'string', Description: "user's email address", 'Example Values': 'example@example.com', 'When fired': 'Signed Up' },
  { Priority: 'P1', Trait: 'member_tier', 'Data Type': 'string', Description: "member's tier", 'Example Values': 'basic, digital, all-access' },
  { Priority: 'P1', Trait: 'created_at', 'Data Type': 'date', Description: 'when the account was created', 'Example Values': 'yyyy-mm-ddT00:00:00.000Z' },
]);

export const SAMPLE_TABS = {
  Track: track,
  Identify: identify,
  Page: page,
  Screen: screen,
  'Track Properties Dictionary': trackDict,
  'Identify Traits Dictionary': identifyDict,
};

export function writeSamplePlan(filePath = SAMPLE_PLAN_PATH) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(SAMPLE_TABS)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  XLSX.writeFile(wb, filePath);
  return filePath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`📝 Sample tracking plan written: ${path.relative(process.cwd(), writeSamplePlan())}`);
}
