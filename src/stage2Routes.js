/**
 * Stage 2 routes — mountable Express router.
 *
 * This module REPLACES the existing `GET /api/profiles` list endpoint with
 * one that supports the full Stage 2 filter/sort/pagination contract, and
 * ADDS `GET /api/profiles/search` for the natural-language query endpoint.
 *
 * It does NOT touch POST / DELETE / GET-by-id — those keep running from your
 * Stage 1 handlers in server.js.
 *
 * Usage in your server.js:
 *
 *     const { pool } = require("./db");
 *     const stage2 = require("./stage2Routes")(pool);
 *
 *     // Mount BEFORE your existing GET /api/profiles handler, OR remove the
 *     // old GET /api/profiles handler entirely. GET /api/profiles/:id is
 *     // unaffected because Express matches exact paths first only when the
 *     // route ordering is right — see README for the ordering note.
 *     app.use(stage2);
 *
 * The router uses the pg Pool you pass in.
 */

const express = require("express");
const { validateAndNormalize, buildListQuery } = require("./queryBuilder");
const { parseNaturalLanguage } = require("./nlParser");

function errorResponse(res, code, message) {
  return res.status(code).json({ status: "error", message });
}

function shapeRow(row) {
  // Ensure the response shape matches the spec exactly.
  // created_at → UTC ISO 8601 string.
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    gender_probability:
      row.gender_probability !== null ? Number(row.gender_probability) : null,
    age: row.age,
    age_group: row.age_group,
    country_id: row.country_id,
    country_name: row.country_name,
    country_probability:
      row.country_probability !== null ? Number(row.country_probability) : null,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

async function runListQuery(pool, params) {
  const { sql, values, page, limit } = buildListQuery(params);
  const { rows } = await pool.query(sql, values);
  const total = rows.length > 0 ? parseInt(rows[0].__total, 10) : 0;
  const data = rows.map((r) => {
    const { __total, ...rest } = r;
    return shapeRow(rest);
  });
  return { page, limit, total, data };
}

module.exports = function stage2Routes(pool) {
  const router = express.Router();

  // -----------------------------------------------------------------
  // GET /api/profiles/search  — natural language query
  // IMPORTANT: must be declared BEFORE GET /api/profiles/:id so Express
  // does not route "search" into the :id handler.
  // -----------------------------------------------------------------
  router.get("/api/profiles/search", async (req, res, next) => {
    try {
      const q = req.query.q;

      if (q === undefined || q === null || String(q).trim() === "") {
        return errorResponse(res, 400, "Invalid query parameters");
      }

      const parsed = parseNaturalLanguage(String(q));
      if (parsed.error) {
        return errorResponse(res, 400, "Unable to interpret query");
      }

      // Merge NL filters with any explicit pagination/sort query params the
      // caller passes alongside ?q=
      const raw = {
        ...parsed.filters,
        ...(req.query.page !== undefined ? { page: req.query.page } : {}),
        ...(req.query.limit !== undefined ? { limit: req.query.limit } : {}),
        ...(req.query.sort_by !== undefined
          ? { sort_by: req.query.sort_by }
          : {}),
        ...(req.query.order !== undefined ? { order: req.query.order } : {}),
      };

      const v = validateAndNormalize(raw);
      if (!v.ok) return errorResponse(res, v.code, v.message);

      const result = await runListQuery(pool, v.params);
      return res.json({
        status: "success",
        page: result.page,
        limit: result.limit,
        total: result.total,
        data: result.data,
      });
    } catch (err) {
      next(err);
    }
  });

  // -----------------------------------------------------------------
  // GET /api/profiles  — filter + sort + pagination
  // -----------------------------------------------------------------
  router.get("/api/profiles", async (req, res, next) => {
    try {
      const v = validateAndNormalize(req.query);
      if (!v.ok) return errorResponse(res, v.code, v.message);

      const result = await runListQuery(pool, v.params);
      return res.json({
        status: "success",
        page: result.page,
        limit: result.limit,
        total: result.total,
        data: result.data,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
