#!/usr/bin/env node
/**
 * Seed script — inserts all profiles from a JSON file into the database.
 *
 * IDEMPOTENT via ON CONFLICT (name) DO NOTHING.
 * Dynamically introspects the profiles table columns; populates
 * normalized_name = lower(trim(name)) if that column exists.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { v7: uuidv7 } = require("uuid");
const { Pool } = require("pg");

const DEFAULT_PATH = path.join(
  __dirname,
  "..",
  "seed-data",
  "seed_profiles.json",
);
const FILE = process.argv[2] || DEFAULT_PATH;

const BATCH_SIZE = 50;

function deriveAgeGroup(age) {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
}

function normalizeRecord(r) {
  const age = parseInt(r.age, 10);
  if (Number.isNaN(age)) throw new Error(`invalid age: ${JSON.stringify(r)}`);
  const name = String(r.name);
  return {
    id: r.id || uuidv7(),
    name,
    normalized_name: name.trim().toLowerCase(),
    gender: r.gender,
    gender_probability: Number(r.gender_probability),
    age,
    age_group: r.age_group || deriveAgeGroup(age),
    country_id: String(r.country_id).toUpperCase(),
    country_name: r.country_name || null,
    country_probability: Number(r.country_probability),
    sample_size: r.sample_size !== undefined ? Number(r.sample_size) : 0,
  };
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`Seed file not found: ${FILE}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const records = Array.isArray(raw) ? raw : raw.data || raw.profiles;
  if (!Array.isArray(records)) {
    console.error(
      "Seed file must be an array or { data: [...] } / { profiles: [...] }",
    );
    process.exit(1);
  }

  console.log(`Loading ${records.length} records from ${FILE}`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
  });

  const client = await pool.connect();
  let inserted = 0,
    skipped = 0,
    failed = 0;

  try {
    const colResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles'
    `);
    const existingCols = new Set(colResult.rows.map((r) => r.column_name));

    const desiredCols = [
      "id",
      "name",
      "normalized_name",
      "gender",
      "gender_probability",
      "age",
      "age_group",
      "country_id",
      "country_name",
      "country_probability",
      "sample_size",
    ];
    const cols = desiredCols.filter((c) => existingCols.has(c));

    if (!cols.length) {
      console.error(
        "No matching columns found in profiles table. Did the migration run?",
      );
      process.exit(1);
    }

    console.log(`Inserting into columns: ${cols.join(", ")}`);

    await client.query("BEGIN");

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];

      for (const raw of batch) {
        let r;
        try {
          r = normalizeRecord(raw);
        } catch (e) {
          failed++;
          continue;
        }

        const rowPlaceholders = [];
        for (const col of cols) {
          values.push(r[col]);
          rowPlaceholders.push(`$${values.length}`);
        }
        placeholders.push(`(${rowPlaceholders.join(", ")})`);
      }

      if (!placeholders.length) continue;

      const sql = `
        INSERT INTO profiles (${cols.join(", ")})
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (name) DO NOTHING
        RETURNING id
      `;

      try {
        const result = await client.query(sql, values);
        inserted += result.rowCount;
        skipped += batch.length - result.rowCount;
      } catch (e) {
        console.error(`\nBatch ${i}-${i + batch.length} failed:`, e.message);
        throw e;
      }

      process.stdout.write(
        `\r  processed ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}  ` +
          `inserted=${inserted}  skipped=${skipped}`,
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
