/**
 * Exercises jira.js against a local mock of the Jira REST API — Cloud and Data Center.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { getJiraConfig, detectJiraSetup, findExistingTickets, createJiraTicket } from '../src/jira.js';

let server;
let baseUrl;
let deploymentType;
let requests;
let rateLimitNextCreate;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : undefined;
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: json });
      const send = (status, data, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(data));
      };

      if (req.url === '/rest/api/2/serverInfo') return send(200, { deploymentType });
      if (req.url === '/rest/api/2/field') {
        return send(200, [{ id: 'summary', schema: { type: 'string' } }, { id: 'customfield_10100', schema: { custom: 'com.pyxis.greenhopper.jira:gh-epic-link' } }]);
      }
      if (req.url === '/rest/api/3/search/jql' && deploymentType === 'Cloud') {
        return json.nextPageToken
          ? send(200, { issues: [{ key: 'DP-2', fields: { summary: 'Old ticket', labels: ['instrumentation'] } }], isLast: true })
          : send(200, { issues: [{ key: 'DP-1', fields: { summary: 'A', labels: ['instrumentation', 'tp-abc'] } }], nextPageToken: 'next', isLast: false });
      }
      if (req.url === '/rest/api/2/search' && deploymentType !== 'Cloud') {
        return json.startAt === 0
          ? send(200, { issues: [{ key: 'DP-1', fields: { summary: 'A', labels: ['tp-abc'] } }], total: 2 })
          : send(200, { issues: [{ key: 'DP-2', fields: { summary: 'Old ticket', labels: [] } }], total: 2 });
      }
      if (req.url === '/rest/api/2/issue') {
        if (rateLimitNextCreate) {
          rateLimitNextCreate = false;
          return send(429, { errorMessages: ['slow down'] }, { 'Retry-After': '1' });
        }
        return send(201, { key: 'DP-100' });
      }
      send(404, { errorMessages: ['not found'] });
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

function setEnv(vars) {
  for (const name of ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PAT', 'JIRA_PROJECT_KEY', 'JIRA_EPIC_KEY', 'JIRA_EPIC_FIELD']) {
    delete process.env[name];
  }
  Object.assign(process.env, { JIRA_BASE_URL: baseUrl, JIRA_PROJECT_KEY: 'DP', JIRA_EPIC_KEY: 'DP-9' }, vars);
  requests = [];
}

const ticket = { summary: 'New ticket', description: 'h2. Summary', priority: 'P1', platform: 'Web', templateType: 'web-track', fingerprint: 'tp-new' };

test('Data Center: bearer token, v2 search, Epic Link field', async () => {
  deploymentType = 'DataCenter';
  setEnv({ JIRA_PAT: 'test-pat' });

  const config = await detectJiraSetup(getJiraConfig());
  assert.equal(config.isCloud, false);
  assert.equal(config.epicField, 'customfield_10100');

  const existing = await findExistingTickets(config);
  assert.equal(existing.byFingerprint.get('tp-abc'), 'DP-1');
  assert.equal(existing.bySummary.get('Old ticket'), 'DP-2');

  const created = await createJiraTicket(ticket, config);
  assert.deepEqual(created, { key: 'DP-100', url: `${baseUrl}/browse/DP-100` });

  const create = requests.find((r) => r.url === '/rest/api/2/issue');
  assert.equal(create.auth, 'Bearer test-pat');
  assert.equal(create.body.fields.customfield_10100, 'DP-9');
  assert.equal(create.body.fields.parent, undefined);
  assert.ok(create.body.fields.labels.includes('tp-new'));
});

test('Cloud: basic auth, enhanced JQL search, parent epic, retries 429', async () => {
  deploymentType = 'Cloud';
  setEnv({ JIRA_EMAIL: 'test@example.test', JIRA_API_TOKEN: 'test-token' });

  const config = await detectJiraSetup(getJiraConfig());
  assert.equal(config.epicField, 'parent');

  const existing = await findExistingTickets(config);
  assert.equal(existing.bySummary.get('Old ticket'), 'DP-2');

  rateLimitNextCreate = true;
  await createJiraTicket(ticket, config);

  const creates = requests.filter((r) => r.url === '/rest/api/2/issue');
  assert.equal(creates.length, 2, 'retried once after 429');
  assert.match(creates[1].auth, /^Basic /);
  assert.deepEqual(creates[1].body.fields.parent, { key: 'DP-9' });
});

test('JIRA_EPIC_FIELD overrides detection', async () => {
  deploymentType = 'DataCenter';
  setEnv({ JIRA_PAT: 'test-pat', JIRA_EPIC_FIELD: 'customfield_10008' });
  const config = await detectJiraSetup(getJiraConfig());
  assert.equal(config.epicField, 'customfield_10008');
  assert.ok(!requests.some((r) => r.url === '/rest/api/2/field'));
});

test('missing credentials are reported together', () => {
  setEnv({});
  assert.throws(() => getJiraConfig(), /JIRA_EMAIL, JIRA_API_TOKEN \(or JIRA_PAT/);
});
