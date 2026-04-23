/**
 * Query builder for GET /api/profiles (and the NL search endpoint).
 *
 * - Validates & coerces query parameters
 * - Produces parameterized SQL (no string concatenation of user input)
 * - Uses COUNT(*) OVER() to get filtered total in a single round-trip
 *
 * Two exports:
 *   validateAndNormalize(raw)  → { ok: true, params } | { ok: false, code, message }
 *   buildListQuery(params)     → { sql, values, page, limit }
 */

const ALLOWED_GENDERS    = new Set(["male", "female"]);
const ALLOWED_AGE_GROUPS = new Set(["child", "teenager", "adult", "senior"]);
const ALLOWED_SORTS      = new Set(["age", "created_at", "gender_probability"]);
const ALLOWED_ORDERS     = new Set(["asc", "desc"]);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT     = 50;

/** Parse an integer strictly — returns NaN on anything non-integer. */
function strictInt(v) {
  if (v === undefined || v === null || v === "") return NaN;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return NaN;
  return parseInt(s, 10);
}

/** Parse a float strictly. */
function strictFloat(v) {
  if (v === undefined || v === null || v === "") return NaN;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return parseFloat(s);
}

/**
 * Validate raw query params from req.query and normalize into a typed object.
 * Returns { ok: true, params } or { ok: false, code, message } where code is
 * an HTTP status (400 or 422) and message is the client-safe message.
 *
 * 400 = missing/empty required-but-provided-empty parameter
 * 422 = wrong type / out-of-range value
 */
function validateAndNormalize(raw) {
  const p = {};

  // Helper: reject an empty string value where a value was "provided"
  const present = (k) => Object.prototype.hasOwnProperty.call(raw, k);
  const isEmpty = (v) => v === "" || (typeof v === "string" && v.trim() === "");

  // ---- String enums ----
  if (present("gender")) {
    if (isEmpty(raw.gender)) return { ok: false, code: 400, message: "Invalid query parameters" };
    const g = String(raw.gender).toLowerCase();
    if (!ALLOWED_GENDERS.has(g)) return { ok: false, code: 422, message: "Invalid query parameters" };
    p.gender = g;
  }

  if (present("age_group")) {
    if (isEmpty(raw.age_group)) return { ok: false, code: 400, message: "Invalid query parameters" };
    const a = String(raw.age_group).toLowerCase();
    if (!ALLOWED_AGE_GROUPS.has(a)) return { ok: false, code: 422, message: "Invalid query parameters" };
    p.age_group = a;
  }

  if (present("country_id")) {
    if (isEmpty(raw.country_id)) return { ok: false, code: 400, message: "Invalid query parameters" };
    const c = String(raw.country_id).toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return { ok: false, code: 422, message: "Invalid query parameters" };
    p.country_id = c;
  }

  // ---- Integer ranges ----
  for (const key of ["min_age", "max_age"]) {
    if (!present(key)) continue;
    if (isEmpty(raw[key])) return { ok: false, code: 400, message: "Invalid query parameters" };
    const n = strictInt(raw[key]);
    if (Number.isNaN(n)) return { ok: false, code: 422, message: "Invalid query parameters" };
    if (n < 0 || n > 150) return { ok: false, code: 422, message: "Invalid query parameters" };
    p[key] = n;
  }
  if (p.min_age !== undefined && p.max_age !== undefined && p.min_age > p.max_age) {
    return { ok: false, code: 422, message: "Invalid query parameters" };
  }

  // ---- Float probabilities ----
  for (const key of ["min_gender_probability", "min_country_probability"]) {
    if (!present(key)) continue;
    if (isEmpty(raw[key])) return { ok: false, code: 400, message: "Invalid query parameters" };
    const f = strictFloat(raw[key]);
    if (Number.isNaN(f)) return { ok: false, code: 422, message: "Invalid query parameters" };
    if (f < 0 || f > 1) return { ok: false, code: 422, message: "Invalid query parameters" };
    p[key] = f;
  }

  // ---- Sorting ----
  if (present("sort_by")) {
    if (isEmpty(raw.sort_by)) return { ok: false, code: 400, message: "Invalid query parameters" };
    const sb = String(raw.sort_by).toLowerCase();
    if (!ALLOWED_SORTS.has(sb)) return { ok: false, code: 422, message: "Invalid query parameters" };
    p.sort_by = sb;
  }
  if (present("order")) {
    if (isEmpty(raw.order)) return { ok: false, code: 400, message: "Invalid query parameters" };
    const o = String(raw.order).toLowerCase();
    if (!ALLOWED_ORDERS.has(o)) return { ok: false, code: 422, message: "Invalid query parameters" };
    p.order = o;
  }

  // ---- Pagination ----
  p.page = DEFAULT_LIMIT; // placeholder
  if (present("page")) {
    if (isEmpty(raw.page)) return { ok: false, code: 400, message: "Invalid query parameters" };
    const n = strictInt(raw.page);
    if (Number.isNaN(n) || n < 1) return { ok: false, code: 422, message: "Invalid query parameters" };
    p.page = n;
  } else {
    p.page = 1;
  }

  if (present("limit")) {
    if (isEmpty(raw.limit)) return { ok: false, code: 400, message: "Invalid query parameters" };
    const n = strictInt(raw.limit);
    if (Number.isNaN(n) || n < 1) return { ok: false, code: 422, message: "Invalid query parameters" };
    p.limit = Math.min(n, MAX_LIMIT);
  } else {
    p.limit = DEFAULT_LIMIT;
  }

  return { ok: true, params: p };
}

/**
 * Build the parameterized list query.
 * Returns { sql, values, page, limit }.
 *
 * COUNT(*) OVER() gives the unfiltered-by-pagination total so the caller
 * only makes ONE database round-trip.
 */
function buildListQuery(params) {
  const where = [];
  const values = [];
  const push = (expr, val) => {
    values.push(val);
    where.push(expr.replace("?", `$${values.length}`));
  };

  if (params.gender)                   push("gender = ?", params.gender);
  if (params.age_group)                push("age_group = ?", params.age_group);
  if (params.country_id)               push("country_id = ?", params.country_id);
  if (params.min_age !== undefined)    push("age >= ?", params.min_age);
  if (params.max_age !== undefined)    push("age <= ?", params.max_age);
  if (params.min_gender_probability !== undefined)
    push("gender_probability >= ?", params.min_gender_probability);
  if (params.min_country_probability !== undefined)
    push("country_probability >= ?", params.min_country_probability);

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sortCol = params.sort_by || "created_at";
  const order   = params.order   || "desc";

  const page  = params.page  || 1;
  const limit = params.limit || DEFAULT_LIMIT;
  const offset = (page - 1) * limit;

  values.push(limit);
  const limitPh = `$${values.length}`;
  values.push(offset);
  const offsetPh = `$${values.length}`;

  const sql = `
    SELECT
      id,
      name,
      gender,
      gender_probability,
      age,
      age_group,
      country_id,
      country_name,
      country_probability,
      created_at,
      COUNT(*) OVER() AS __total
    FROM profiles
    ${whereClause}
    ORDER BY ${sortCol} ${order.toUpperCase()}, id ASC
    LIMIT ${limitPh} OFFSET ${offsetPh}
  `;

  return { sql, values, page, limit };
}

module.exports = {
  validateAndNormalize,
  buildListQuery,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
