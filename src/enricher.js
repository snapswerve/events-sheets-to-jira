/**
 * enricher.js — Enriches parsed events with dictionary data.
 *
 * Concept: The eventing plan has two "dictionary" tabs:
 *   - Track Properties Dictionary: property name → type, description, example values
 *   - Identify Traits Dictionary: trait name → type, description, example values, when fired
 *
 * The parser gives us property/trait names. The enricher looks up the details.
 */

import { findColumns, missingHeadersMessage, rowReader } from './columns.js';

const TRACK_DICT_COLUMNS = {
  name: ['Property', 'Properties'],
  type: ['Property Type', 'Data Type', 'Type'],
  description: ['Property Description', 'Description'],
  exampleValues: ['Example Values', 'Examples'],
};

const IDENTIFY_DICT_COLUMNS = {
  name: ['Trait', 'Traits'],
  type: ['Data Type', 'Trait Type', 'Type'],
  description: ['Description', 'Trait Description'],
  exampleValues: ['Example Values', 'Examples'],
  whenFired: ['When fired'],
};

/**
 * Builds a lookup map from the Track Properties Dictionary.
 * Key: property name (lowercase), Value: { type, description, exampleValues }
 *
 * Columns (found by header): Property | Property Type | Property Description | Example Values
 * Nested properties use their full path, e.g. "products.$.sku".
 */
export function buildTrackPropsDict(rows) {
  return buildDict(rows, 'Track Properties Dictionary', TRACK_DICT_COLUMNS);
}

/**
 * Builds a lookup map from the Identify Traits Dictionary.
 * Key: trait name (lowercase), Value: { type, description, exampleValues, whenFired }
 *
 * Columns (found by header): Priority | Trait | Data Type | Description | Example Values | When fired
 */
export function buildIdentifyTraitsDict(rows) {
  return buildDict(rows, 'Identify Traits Dictionary', IDENTIFY_DICT_COLUMNS);
}

function buildDict(rows, tabName, columns) {
  const dict = new Map();
  if (rows.length === 0) return dict;

  const found = findColumns(rows, columns, ['name']);
  if (!found) {
    console.warn(`⚠️  ${missingHeadersMessage(tabName, columns, ['name'])}`);
    return dict;
  }

  const get = rowReader(found.cols);
  for (let i = found.headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = get(row, 'name');
    // Don't overwrite — first entry wins (usually the most specific)
    if (!name || dict.has(name.toLowerCase())) continue;
    dict.set(name.toLowerCase(), {
      name,
      type: get(row, 'type') || 'string',
      description: get(row, 'description'),
      exampleValues: get(row, 'exampleValues'),
      whenFired: get(row, 'whenFired'),
    });
  }
  return dict;
}

/**
 * Enriches track events — adds type, description, exampleValues to each property.
 */
export function enrichTrackEvents(events, trackDict) {
  for (const event of events) {
    for (const prop of event.properties) {
      enrichField(prop, trackDict.get(prop.name.toLowerCase()));
    }
  }
  return events;
}

/**
 * Enriches identify events — adds type, description, exampleValues to each trait.
 */
export function enrichIdentifyEvents(events, identifyDict) {
  for (const event of events) {
    for (const trait of event.traits) {
      enrichField(trait, identifyDict.get(trait.name.toLowerCase()));
    }
  }
  return events;
}

/**
 * Enriches page/screen events — uses trackDict since page/screen properties overlap.
 */
export function enrichPageScreenEvents(events, trackDict) {
  return enrichTrackEvents(events, trackDict);
}

/**
 * Fills type/description/examples from a dictionary entry. When the field isn't in the
 * dictionary, the type falls back to "string" and inDictionary=false lets the ticket flag it.
 */
function enrichField(field, lookup) {
  field.inDictionary = Boolean(lookup);
  field.type = field.type || lookup?.type || 'string';
  field.description = field.description || lookup?.description || '';
  field.exampleValues = field.exampleValues || lookup?.exampleValues || '';
}
