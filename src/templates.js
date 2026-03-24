/**
 * templates.js — Jira wiki markup templates for each event type.
 *
 * These match the 7 .docx templates from the drive download.
 * Jira Cloud wiki markup reference: https://jira.atlassian.com/secure/WikiRendererHelpAction.jspa?section=all
 *
 * Each function returns { summary, description } where description is Jira wiki markup.
 */

const EVENTING_PLAN_URL = 'https://docs.google.com/spreadsheets/d/1k5Vn7e_326PiOGoir-r9GtZg2R3IRvqwpcOCJWMp8m0/edit';

// ─── Web Track ───

export function webTrack(ticket) {
  const props = ticket.properties || [];
  return {
    summary: `[Instrumentation] Web Track: ${ticket.eventName}` + (ticket.instanceLabel !== 'web' ? ` (${ticket.instanceLabel})` : ''),
    description: `h2. Summary

Implement the *${ticket.eventName}* event required for capturing ${ticket.whenFired || '_'} during their web session. This story contains event specifications referenced in the [eventing plan|${EVENTING_PLAN_URL}].

h2. Event spec

h3. ${ticket.eventName}

*Fires when:* ${ticket.whenFired || 'Not specified'}
 * for ${ticket.idState || 'anonymous & identified'} users

*Properties:*
${formatProperties(props)}

*Note:* If a property does not have a value or is not applicable to the user action, it should be omitted from the payload entirely. Do not send null, undefined, or empty string values.

{code:json}
${buildTrackPayloadExample(ticket)}
{code}

h3. Common Fields

Every Track event includes OOB:
 * common context documentation: [https://www.twilio.com/docs/segment/connections/spec/common]

h2. Chrome Extension

Segment offers a Chrome extension, [Segment Inspector|https://chromewebstore.google.com/detail/segment-inspector-officia/jfcbmnpfbhhlhfclmiijpldieboendfo], which can be useful for validating event payloads.

h2. Segment's Documentation

[Analytics.js Source|https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/#track]
[Spec: Track|https://segment.com/docs/connections/spec/track]
[Troubleshooting Analytics.js|https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/troubleshooting]
[Using the Source Debugger|https://segment.com/docs/connections/sources/debugger]

h2. Acceptance Criteria
 * Event implemented exactly as specified
 * All required properties included
 * Seen in Segment Debugger, matching spec
 * Seen in Databricks, matching spec
 * Seen in Unify Profile Explorer, matching spec
 * Zero Protocols violations
 * No unplanned fields or invalid property types
 * Fires once per action
 * Values should be set to lowercase
 ** except for event name (page, track)
 ** except for \`old_page_name\` property`,
  };
}

// ─── Web Page ───

export function webPage(ticket) {
  const props = ticket.properties || [];
  return {
    summary: `[Instrumentation] Web Page: ${ticket.eventName}`,
    description: `h2. Summary

Implement the Segment *page()* event upon load of the ${ticket.eventName} page. This story contains event specifications referenced in the [eventing plan|${EVENTING_PLAN_URL}].

h2. Event spec

h3. "${ticket.eventName}" page event

*Fires when:* ${ticket.whenFired || 'Not specified'}

*Properties:*
${formatProperties(props)}

*Note:* If a property does not have a value or is not applicable to the user action, it should be omitted from the payload entirely. Do not send null, undefined, or empty string values.

{code:json}
${buildPagePayloadExample(ticket)}
{code}

h3. Common Fields

Every Page event includes OOB:
 * common context documentation: [https://www.twilio.com/docs/segment/connections/spec/common]

h2. Chrome Extension

Segment offers a Chrome extension, [Segment Inspector|https://chromewebstore.google.com/detail/segment-inspector-officia/jfcbmnpfbhhlhfclmiijpldieboendfo], which can be useful for validating event payloads.

h2. Segment's Documentation

[Analytics.js Source|https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/#track]
[Spec: Page|https://segment.com/docs/connections/spec/page]
[Troubleshooting Analytics.js|https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/troubleshooting]
[Using the Source Debugger|https://segment.com/docs/connections/sources/debugger]

h2. Acceptance Criteria
 * Event implemented exactly as specified
 * All required properties included
 * Seen in Segment Debugger, matching spec
 * Seen in Databricks, matching spec
 * Seen in Unify Profile Explorer, matching spec
 * Zero Protocols violations
 * No unplanned fields or invalid property types
 * Fires once per action
 * Values should be set to lowercase
 ** except for event name (page, track)
 ** except for \`old_page_name\` property`,
  };
}

// ─── Web Identify ───

export function webIdentify(ticket) {
  const traits = ticket.traits || [];
  return {
    summary: `[Instrumentation] Web Identify: ${ticket.whenFired}`,
    description: `h2. Summary

Implement the *${ticket.priority} Identify call* that follows the ${ticket.whenFired} track call and captures the ${traits.map((t) => t.name).join(', ')} for a user during their web session. This story contains event specifications referenced in the [eventing plan|${EVENTING_PLAN_URL}].

h2. Event spec

h3. Identify with ${ticket.whenFired}

*When fired:* An identified user commits a ${ticket.whenFired}
 * For ${ticket.idState || 'identified'} users

{*}Traits{*}:
${formatTraits(traits)}

{code:json}
${buildIdentifyPayloadExample(ticket, false)}
{code}

h3. Common Fields

Every Identify event includes OOB:
 * common context documentation: [https://www.twilio.com/docs/segment/connections/spec/common]

h2. Chrome Extension

Segment offers a Chrome extension, [Segment Inspector|https://chromewebstore.google.com/detail/segment-inspector-officia/jfcbmnpfbhhlhfclmiijpldieboendfo], which can be useful for validating event payloads.

h2. Segment's Documentation

[Analytics.js Source|https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/#identify]
[Spec: Identify|https://segment.com/docs/connections/spec/identify]
[Troubleshooting Analytics.js|https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/troubleshooting]
[Using the Source Debugger|https://segment.com/docs/connections/sources/debugger]

h2. Acceptance Criteria
 * Event implemented exactly as specified
 * All required traits included
 * Seen in Segment Debugger, matching spec
 * Seen in Databricks, matching spec
 * Seen in Unify Profile Explorer, matching spec
 * Zero Protocols violations
 * No unplanned fields or invalid property types
 * Fires once per action
 * Values should be set to lowercase`,
  };
}

// ─── SS (Server-Side) Track ───

export function ssTrack(ticket) {
  const props = ticket.properties || [];
  return {
    summary: `[Instrumentation] SS Track: ${ticket.eventName}`,
    description: `h2. Summary

Implement the *${ticket.eventName}* event server-side. This story contains event specifications referenced in the [eventing plan|${EVENTING_PLAN_URL}].

h2. Event spec

h3. ${ticket.eventName}

*When fired:* ${ticket.whenFired || 'Not specified'}
 * For ${ticket.idState || 'identified'} users

*Properties:*
${formatProperties(props)}

*Note:* If a property does not have a value or is not applicable to the user action, it should be omitted from the payload entirely. Do not send null, undefined, or empty string values.

{code:json}
${buildTrackPayloadExample(ticket, true)}
{code}

h2. Segment's Documentation

[Java Source|https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/java#track]
[Spec: Track|https://segment.com/docs/connections/spec/track]
[Troubleshooting Java|https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/java#troubleshooting]
[Using the Source Debugger|https://segment.com/docs/connections/sources/debugger]

h2. Acceptance Criteria
 * Event implemented exactly as specified
 * All required properties included
 * Seen in Segment Debugger, matching spec
 * Seen in Databricks, matching spec
 * Seen in Unify Profile Explorer, matching spec
 * Zero Protocols violations
 * No unplanned fields or invalid property types
 * Fires once per action
 * Values should be set to lowercase
 ** except for event name (page, track)
 ** except for \`old_page_name\` property`,
  };
}

// ─── SS (Server-Side) Identify ───

export function ssIdentify(ticket) {
  const traits = ticket.traits || [];
  return {
    summary: `[Instrumentation] SS Identify: ${ticket.whenFired}`,
    description: `h2. Summary

Implement the *${ticket.priority} Identify call* that follows the ${ticket.whenFired} track call and captures the ${traits.map((t) => t.name).join(', ')} for a user. This story contains event specifications referenced in the [eventing plan|${EVENTING_PLAN_URL}].

h2. Event spec

h3. Identify with ${ticket.whenFired}

*When fired:* An identified user commits a ${ticket.whenFired}
 * For ${ticket.idState || 'identified'} users

{*}Traits{*}:
${formatTraits(traits)}

{code:json}
${buildIdentifyPayloadExample(ticket, true)}
{code}

h2. Segment's Documentation

[Java Source|https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/java#identify]
[Spec: Identify|https://segment.com/docs/connections/spec/identify]
[Troubleshooting Java|https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/java#troubleshooting]
[Using the Source Debugger|https://segment.com/docs/connections/sources/debugger]

h2. Acceptance Criteria
 * Event implemented exactly as specified
 * All required traits included
 * Seen in Segment Debugger, matching spec
 * Seen in Databricks, matching spec
 * Seen in Unify Profile Explorer, matching spec
 * Zero Protocols violations
 * No unplanned fields or invalid property types
 * Fires once per action
 * Values should be set to lowercase`,
  };
}

// ─── Mobile App Track ───

export function mobileTrack(ticket) {
  const props = ticket.properties || [];
  return {
    summary: `[Instrumentation] Mobile Track: ${ticket.eventName}` + (ticket.instanceLabel !== 'mobile app' ? ` (${ticket.instanceLabel})` : ''),
    description: `h2. Summary

Implement the *${ticket.eventName}* event required for capturing ${ticket.whenFired || '_'} in the app. This story contains event specifications referenced in the [eventing plan|${EVENTING_PLAN_URL}].

h2. Event spec

h3. ${ticket.eventName}

*When fired:* ${ticket.whenFired || 'Not specified'}
 * for ${ticket.idState || 'anonymous & identified'} users

*Properties:*
${formatProperties(props)}

*Note:* If a property does not have a value or is not applicable to the user action, it should be omitted from the payload entirely. Do not send null, undefined, or empty string values.

{code:JSON}
${buildTrackPayloadExample(ticket, true)}
{code}

h3. Common Fields
Every Track event includes OOB:
 * common context documentation: https://www.twilio.com/docs/segment/connections/spec/common

h2. Segment's Documentation
[Analytics React Native Source|https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/mobile/react-native/implementation#track]
[Spec: Track|https://segment.com/docs/connections/spec/track]
[Troubleshooting Analytics React Native|https://segment.com/docs/connections/sources/catalog/libraries/mobile/react-native/troubleshooting]
[Using the Source Debugger|https://segment.com/docs/connections/sources/debugger]

h2. Acceptance Criteria
 * Event implemented exactly as specified
 * All required properties included
 * Seen in Segment Debugger, matching spec
 * Seen in Databricks, matching spec
 * Seen in Unify Profile Explorer, matching spec
 * Zero Protocols violations
 * No unplanned fields or invalid property types
 * Fires once per action
 * Values should be set to lowercase
 ** except for event name (page, track)
 ** except for \`old_page_name\` property`,
  };
}

// ─── Mobile App Screen ───

export function mobileScreen(ticket) {
  const props = ticket.properties || [];
  return {
    summary: `[Instrumentation] Mobile Screen: ${ticket.eventName}`,
    description: `h2. Summary

Implement the *${ticket.eventName}* screen event required for capturing ${ticket.whenFired || '_'} in the app. This story contains event specifications referenced in the [eventing plan|${EVENTING_PLAN_URL}].

h2. Event spec

h3. ${ticket.eventName}

*When fired:* ${ticket.whenFired || 'Not specified'}
 * for ${ticket.idState || 'anonymous & identified'} users

*Properties:*
${formatProperties(props)}

*Note:* If a property does not have a value or is not applicable to the user action, it should be omitted from the payload entirely. Do not send null, undefined, or empty string values.

{code:JSON}
${buildScreenPayloadExample(ticket)}
{code}

h3. Common Fields
Every Screen event includes OOB:
 * common context documentation: https://www.twilio.com/docs/segment/connections/spec/common

h2. Segment's Documentation
[Analytics React Native Source|https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/mobile/react-native/implementation#screen]
[Spec: Screen|https://segment.com/docs/connections/spec/screen]
[Troubleshooting Analytics React Native|https://segment.com/docs/connections/sources/catalog/libraries/mobile/react-native/troubleshooting]
[Using the Source Debugger|https://segment.com/docs/connections/sources/debugger]

h2. Acceptance Criteria
 * Event implemented exactly as specified
 * All required properties included
 * Seen in Segment Debugger, matching spec
 * Seen in Databricks, matching spec
 * Seen in Unify Profile Explorer, matching spec
 * Zero Protocols violations
 * No unplanned fields or invalid property types
 * Fires once per action
 * Values should be set to lowercase
 ** except for event name (page, track)`,
  };
}

// ─── Mobile App Identify ───

export function mobileIdentify(ticket) {
  const traits = ticket.traits || [];
  return {
    summary: `[Instrumentation] Mobile Identify: ${ticket.whenFired}`,
    description: `h2. Summary

Implement the *${ticket.priority} Identify call* that follows the ${ticket.whenFired} track call and captures the ${traits.map((t) => t.name).join(', ')} for a user during their app session. This story contains event specifications referenced in the [eventing plan|${EVENTING_PLAN_URL}].

h2. Event spec

h3. Identify with ${ticket.whenFired}

*When fired:* An identified user commits a ${ticket.whenFired}
 * For ${ticket.idState || 'identified'} users

{*}Traits{*}:
${formatTraits(traits)}

{code:JSON}
${buildIdentifyPayloadExample(ticket, true)}
{code}

h3. Common Fields
Every Track event includes OOB:
 * common context documentation: https://www.twilio.com/docs/segment/connections/spec/common

h2. Segment's Documentation
[Analytics React Native Source|https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/mobile/react-native/implementation#identify]
[Spec: Identify|https://segment.com/docs/connections/spec/identify]
[Troubleshooting Analytics React Native|https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/mobile/react-native/troubleshooting]
[Using the Source Debugger|https://segment.com/docs/connections/sources/debugger]

h2. Acceptance Criteria
 * Event implemented exactly as specified
 * All required traits included
 * Seen in Segment Debugger, matching spec
 * Seen in Databricks, matching spec
 * Seen in Unify Profile Explorer, matching spec
 * Zero Protocols violations
 * No unplanned fields or invalid property types
 * Fires once per action
 * Values should be set to lowercase`,
  };
}

// ─── Template Dispatcher ───

const TEMPLATE_MAP = {
  'web-track': webTrack,
  'web-page': webPage,
  'web-identify': webIdentify,
  'ss-track': ssTrack,
  'ss-identify': ssIdentify,
  'mobile-track': mobileTrack,
  'mobile-screen': mobileScreen,
  'mobile-identify': mobileIdentify,
};

export function renderTicket(ticket) {
  const fn = TEMPLATE_MAP[ticket.templateType];
  if (!fn) throw new Error(`Unknown template type: ${ticket.templateType}`);
  return fn(ticket);
}

// ─── Formatting Helpers ───

function formatProperties(props) {
  if (!props || props.length === 0) return ' * (none specified)';
  return props
    .map((p) => {
      let line = ` * *${p.name}*`;
      if (p.description) line += `\n ** ${p.description}`;
      if (p.type) line += `\n ** data type = ${p.type}`;
      if (p.exampleValues) line += `\n ** possible values: ${p.exampleValues}`;
      line += `\n ** property status: ${p.status || 'unset'}`;
      return line;
    })
    .join('\n');
}

function formatTraits(traits) {
  if (!traits || traits.length === 0) return ' * (none specified)';
  return traits
    .map((t) => {
      let line = ` * *${t.name}*`;
      if (t.description) line += `\n ** ${t.description}`;
      if (t.type) line += `\n ** data type = ${t.type}`;
      if (t.exampleValues) line += `\n ** examples: ${t.exampleValues}`;
      line += `\n ** status: ${t.status || 'unset'}`;
      return line;
    })
    .join('\n');
}

function buildTrackPayloadExample(ticket, isServer = false) {
  const props = (ticket.properties || []).slice(0, 5);
  const propsObj = {};
  for (const p of props) {
    propsObj[p.name] = `<${p.exampleValues || p.type || 'value'}>`;
  }
  if (ticket.properties && ticket.properties.length > 5) {
    propsObj['...'] = '...';
  }

  const payload = {
    event: ticket.eventName,
    context: '{...}',
    messageId: 'ajs-next-1771903552156-259e5dab-e92c-4b7e-b0fc-0cbc822a6eb0',
    userId: isServer ? 132498384 : null,
    integrations: {},
    timestamp: '2026-02-24T03:25:55.448Z',
    anonymousId: '14244e0f-259e-4dab-a92c-bb7ef0fc0cbc',
    properties: propsObj,
    receivedAt: '2026-02-24T03:25:53.808Z',
    sentAt: '2026-02-24T03:25:52.162Z',
    type: 'track',
    originalTimestamp: '2026-02-24T03:25:53.802Z',
  };

  return JSON.stringify(payload, null, 2);
}

function buildPagePayloadExample(ticket) {
  const props = (ticket.properties || []).slice(0, 5);
  const propsObj = {};
  for (const p of props) {
    propsObj[p.name] = `<${p.exampleValues || p.type || 'value'}>`;
  }

  const payload = {
    name: ticket.eventName,
    context: '{...}',
    messageId: 'ajs-next-1771903552156-259e5dab-e92c-4b7e-b0fc-0cbc822a6eb0',
    userId: null,
    integrations: {},
    timestamp: '2026-02-24T03:25:55.448Z',
    anonymousId: '14244e0f-259e-4dab-a92c-bb7ef0fc0cbc',
    properties: propsObj,
    receivedAt: '2026-02-24T03:25:53.808Z',
    sentAt: '2026-02-24T03:25:52.162Z',
    type: 'page',
    originalTimestamp: '2026-02-24T03:25:53.802Z',
  };

  return JSON.stringify(payload, null, 2);
}

function buildScreenPayloadExample(ticket) {
  const props = (ticket.properties || []).slice(0, 5);
  const propsObj = {};
  for (const p of props) {
    propsObj[p.name] = `<${p.exampleValues || p.type || 'value'}>`;
  }

  const payload = {
    name: ticket.eventName,
    context: '{...}',
    messageId: 'ajs-next-1771903552156-259e5dab-e92c-4b7e-b0fc-0cbc822a6eb0',
    userId: 132498384,
    integrations: {},
    timestamp: '2026-02-24T03:25:55.448Z',
    anonymousId: '14244e0f-259e-4dab-a92c-bb7ef0fc0cbc',
    properties: propsObj,
    receivedAt: '2026-02-24T03:25:53.808Z',
    sentAt: '2026-02-24T03:25:52.162Z',
    type: 'screen',
    originalTimestamp: '2026-02-24T03:25:53.802Z',
  };

  return JSON.stringify(payload, null, 2);
}

function buildIdentifyPayloadExample(ticket, isServer = false) {
  const traits = (ticket.traits || []).slice(0, 5);
  const traitsObj = {};
  for (const t of traits) {
    traitsObj[t.name] = `<${t.exampleValues || t.type || 'value'}>`;
  }

  const payload = {
    context: '{...}',
    messageId: 'ajs-next-1771903552156-259e5dab-e92c-4b7e-b0fc-0cbc822a6eb0',
    userId: isServer ? 132498384 : null,
    integrations: {},
    timestamp: '2026-02-24T03:25:55.448Z',
    anonymousId: '14244e0f-259e-4dab-a92c-bb7ef0fc0cbc',
    traits: traitsObj,
    receivedAt: '2026-02-24T03:25:53.808Z',
    sentAt: '2026-02-24T03:25:52.162Z',
    type: 'identify',
    originalTimestamp: '2026-02-24T03:25:53.802Z',
  };

  return JSON.stringify(payload, null, 2);
}
