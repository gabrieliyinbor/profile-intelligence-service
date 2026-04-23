#!/usr/bin/env node
/**
 * Seed script — inserts all 2026 profiles from a JSON file into the database.
 *
 * Usage:
 *     node scripts/seed.js                       # defaults to ./seed-data/profiles.json
 *     node scripts/seed.js path/to/profiles.json
 *
 * IDEMPOTENT: Re-running does NOT create duplicates.
 * Uses  INSERT ... ON CONFLICT (name) DO NOTHING  on the unique name constraint.
 *
 * Expected JSON shape — an array of objects. Fields are flexible; the script
 * tolerates either the Stage 1 enriched shape OR the raw Insighta Labs seed
 * shape. Required keys per record:
 *
 *   name                 string
 *   gender               "male" | "female"
 *   gender_probability   number 0..1
 *   age                  integer
 *   age_group            "child" | "teenager" | "adult" | "senior"
 *   country_id           2-letter ISO
 *   country_name         string
 *   country_probability  number 0..1
 *
 * If `age_group` is missing, it is derived from `age` using the defaults:
 *   0–12 child, 13–19 teenager, 20–59 adult, 60+ senior
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { v7: uuidv7 } = require("uuid");
const { Pool } = require("pg");

const DEFAULT_PATH = path.join(__dirname, "..", "seed-data", "profiles.json");
const FILE = process.argv[2] || DEFAULT_PATH;

const BATCH_SIZE = 100;

function deriveAgeGroup(age) {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
}

function normalizeRecord(r) {
  const age = parseInt(r.age, 10);
  if (Number.isNaN(age)) throw new Error(`invalid age: ${JSON.stringify(r)}`);
  return {
    id: r.id || uuidv7(),
    name: String(r.name),
    gender: r.gender,
    gender_probability: Number(r.gender_probability),
    age,
    age_group: r.age_group || deriveAgeGroup(age),
    country_id: String(r.country_id).toUpperCase(),
    country_name: r.country_name || null,
    country_probability: Number(r.country_probability),
  };
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`Seed file not found: ${FILE}`);
    console.error("Pass the path as an argument: node scripts/seed.js <file>");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const records = Array.isArray(raw) ? raw : raw.data || raw.profiles;
  if (!Array.isArray(records)) {
    console.error("Seed file must be an array or { data: [...] } / { profiles: [...] }");
    process.exit(1);
  }

  console.log(`Loading ${records.length} records from ${FILE}`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  let inserted = 0, skipped = 0, failed = 0;

  try {
    await client.query("BEGIN");

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];

      for (const raw of batch) {
        let r;
        try { r = normalizeRecord(raw); }
        catch (e) { failed++; continue; }

        const base = values.length;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, ` +
          `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
        );
        values.push(
          r.id, r.name, r.gender, r.gender_probability,
          r.age, r.age_group, r.country_id, r.country_name, r.country_probability
        );
      }

      if (!placeholders.length) continue;

      const sql = `
        INSERT INTO profiles
          (id, name, gender, gender_probability, age, age_group, country_id, country_name, country_probability)
        VALUES
          ${placeholders.join(",\n          ")}
        ON CONFLICT (name) DO NOTHING
        RETURNING id
      `;
      const result = await client.query(sql, values);
      inserted += result.rowCount;
      skipped += batch.length - result.rowCount;

      process.stdout.write(
        `\r  processed ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}  ` +
        `inserted=${inserted}  skipped=${skipped}`
      );
    }

    await client.query("COMMIT");
    console.log("\nSeed complete.");
    console.log(`  inserted: ${inserted}`);
    console.log(`  skipped (already existed): ${skipped}`);
    if (failed) console.log(`  failed to parse: ${failed}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nSeed failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
