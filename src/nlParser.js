/**
 * Rule-based natural language query parser for /api/profiles/search.
 * NO LLMs, NO AI — pure regex + lookup per task brief.
 *
 * Input:   plain English query string (e.g. "young males from nigeria")
 * Output:  { filters: { ... } }                 on success
 *          { error: 'empty' | 'uninterpretable' } on failure
 *
 * Filter keys produced match the /api/profiles filter contract:
 *   gender, age_group, country_id, min_age, max_age
 * (probability filters are not inferrable from English phrasing.)
 */

const { resolveCountry } = require("./countries");

/** Age-group synonyms → canonical stored value. */
const AGE_GROUP_PATTERNS = [
  { re: /\b(child|children|kid|kids)\b/,          value: "child"     },
  { re: /\b(teenager|teenagers|teen|teens)\b/,    value: "teenager"  },
  { re: /\b(adult|adults)\b/,                     value: "adult"     },
  { re: /\b(senior|seniors|elderly|old\s+people)\b/, value: "senior" },
];

/** Words that signal the query IS a query even when no filter is extracted. */
const CONTENT_WORDS_RE = /\b(people|everyone|users?|profiles?|individuals?|persons?|anyone|show|list|find|get|all)\b/;

/**
 * Parse a natural-language query into structured filters.
 * Returns { filters } or { error }.
 */
function parseNaturalLanguage(query) {
  if (query === undefined || query === null) {
    return { error: "empty" };
  }
  if (typeof query !== "string") {
    return { error: "empty" };
  }

  // Normalise: lowercase, strip trailing punctuation, collapse whitespace.
  const s = query
    .toLowerCase()
    .replace(/[?!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return { error: "empty" };

  const filters = {};
  let recognized = false;

  // ---------------------------------------------------------------
  // 1. Country: "from <country-name>"
  //    Stop the capture at structural words (above, below, who, that,
  //    aged, and, or, with, etc.) so we don't eat trailing modifiers.
  // ---------------------------------------------------------------
  const countryMatch = s.match(
    /\bfrom\s+([a-z\s'.\-]+?)(?:\s+(?:who|that|which|with|and|or|aged?|above|over|older|under|below|younger|between|greater|less|more|fewer)\b|$)/
  );
  if (countryMatch) {
    const iso = resolveCountry(countryMatch[1].trim());
    if (iso) {
      filters.country_id = iso;
      recognized = true;
    }
  }

  // ---------------------------------------------------------------
  // 2. Age group (first match wins)
  // ---------------------------------------------------------------
  for (const { re, value } of AGE_GROUP_PATTERNS) {
    if (re.test(s)) {
      filters.age_group = value;
      recognized = true;
      break;
    }
  }

  // ---------------------------------------------------------------
  // 3. Gender — "male and female" means no gender filter.
  // ---------------------------------------------------------------
  const hasMale   = /\b(male|males|man|men|boy|boys|guys?)\b/.test(s);
  const hasFemale = /\b(female|females|woman|women|girl|girls|ladies|lady)\b/.test(s);

  if (hasMale && !hasFemale) {
    filters.gender = "male";
    recognized = true;
  } else if (hasFemale && !hasMale) {
    filters.gender = "female";
    recognized = true;
  } else if (hasMale && hasFemale) {
    // Both mentioned — no filter, but query is interpretable.
    recognized = true;
  }

  // ---------------------------------------------------------------
  // 4. Explicit age comparisons (override "young" defaults)
  // ---------------------------------------------------------------
  let m;

  // "above 30", "over 30", "older than 30", "aged above 30"
  if ((m = s.match(/\b(?:aged?\s+)?(?:above|over|older\s+than|greater\s+than|more\s+than)\s+(\d+)/))) {
    filters.min_age = parseInt(m[1], 10);
    recognized = true;
  }

  // "below 50", "under 50", "younger than 50", "less than 50"
  if ((m = s.match(/\b(?:aged?\s+)?(?:below|under|younger\s+than|less\s+than|fewer\s+than)\s+(\d+)/))) {
    filters.max_age = parseInt(m[1], 10);
    recognized = true;
  }

  // "between 20 and 40", "from 20 to 40", "aged 20 to 40", "20-40"
  if ((m = s.match(/\b(?:between|aged?\s+from|aged?|from)\s+(\d+)\s+(?:and|to|-)\s+(\d+)/))) {
    filters.min_age = parseInt(m[1], 10);
    filters.max_age = parseInt(m[2], 10);
    recognized = true;
  } else if ((m = s.match(/\b(\d+)\s*-\s*(\d+)\b/))) {
    filters.min_age = parseInt(m[1], 10);
    filters.max_age = parseInt(m[2], 10);
    recognized = true;
  }

  // "aged 30" (exact age)
  if (
    filters.min_age === undefined &&
    filters.max_age === undefined &&
    (m = s.match(/\baged?\s+(\d+)\b(?!\s*(?:and|to|-))/))
  ) {
    const n = parseInt(m[1], 10);
    filters.min_age = n;
    filters.max_age = n;
    recognized = true;
  }

  // ---------------------------------------------------------------
  // 5. "young" descriptor → 16–24 (spec: parsing-only, not a stored group)
  //    Only fills gaps; explicit comparisons above win.
  // ---------------------------------------------------------------
  if (/\byoung\b/.test(s)) {
    if (filters.min_age === undefined) filters.min_age = 16;
    if (filters.max_age === undefined) filters.max_age = 24;
    recognized = true;
  }

  // ---------------------------------------------------------------
  // 6. Content words — query is interpretable even if no filters extracted
  //    (e.g. "all profiles", "show me everyone").
  // ---------------------------------------------------------------
  if (CONTENT_WORDS_RE.test(s)) {
    recognized = true;
  }

  if (!recognized) {
    return { error: "uninterpretable" };
  }

  return { filters };
}

module.exports = { parseNaturalLanguage };
