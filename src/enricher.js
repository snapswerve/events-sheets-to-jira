/**
 * enricher.js — Enriches parsed events with dictionary data.
 *
 * Concept: The eventing plan has two "dictionary" tabs:
 *   - Track Properties Dictionary: property name → type, description, example values
 *   - Identify Traits Dictionary: trait name → type, description, example values, when fired
 *
 * The parser gives us property/trait names. The enricher looks up the details.
 */

/**
 * Builds a lookup map from the Track Properties Dictionary.
 * Key: property name (lowercase), Value: { type, description, exampleValues }
 *
 * Track Props Dict columns:
 *   Properties(0) | Property Type(1) | Property Description(2) | Example Values(3)
 */
export function buildTrackPropsDict(rows) {
  const dict = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[0] || '').trim();
    if (!name) continue;
    dict.set(name.toLowerCase(), {
      name,
      type: (row[1] || 'string').trim(),
      description: (row[2] || '').trim(),
      exampleValues: (row[3] || '').toString().trim(),
    });
  }
  return dict;
}

/**
 * Builds a lookup map from the Identify Traits Dictionary.
 * Key: trait name (lowercase), Value: { type, description, exampleValues, whenFired }
 *
 * Identify Traits Dict columns:
 *   Priority(0) | Trait(1) | Data Type(2) | Description(3) | Example Values(4) | When fired(5)
 */
export function buildIdentifyTraitsDict(rows) {
  const dict = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[1] || '').trim();
    if (!name) continue;
    // Don't overwrite — first entry wins (usually the most specific)
    if (!dict.has(name.toLowerCase())) {
      dict.set(name.toLowerCase(), {
        name,
        type: (row[2] || 'string').trim(),
        description: (row[3] || '').trim(),
        exampleValues: (row[4] || '').toString().trim(),
        whenFired: (row[5] || '').trim(),
      });
    }
  }
  return dict;
}

/**
 * Enriches track events — adds type, description, exampleValues to each property.
 */
export function enrichTrackEvents(events, trackDict) {
  for (const event of events) {
    for (const prop of event.properties) {
      const lookup = trackDict.get(prop.name.toLowerCase());
      if (lookup) {
        prop.type = prop.type || lookup.type;
        prop.description = prop.description || lookup.description;
        prop.exampleValues = prop.exampleValues || lookup.exampleValues;
      } else {
        prop.type = prop.type || 'string';
        prop.description = prop.description || '';
        prop.exampleValues = prop.exampleValues || '';
      }
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
      const lookup = identifyDict.get(trait.name.toLowerCase());
      if (lookup) {
        trait.type = trait.type || lookup.type;
        trait.description = trait.description || lookup.description;
        trait.exampleValues = trait.exampleValues || lookup.exampleValues;
      } else {
        trait.type = trait.type || 'string';
        trait.description = trait.description || '';
        trait.exampleValues = trait.exampleValues || '';
      }
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
