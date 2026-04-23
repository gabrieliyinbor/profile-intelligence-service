const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in environment variables");
}

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function runSqlFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const sql = fs.readFileSync(filePath, "utf8").trim();
  if (!sql) return;
  await pool.query(sql);
}

async function initDb() {
  const schemaPath = path.join(__dirname, "..", "sql", "schema.sql");
  const migratePath = path.join(__dirname, "..", "sql", "migrate-stage2.sql");

  await runSqlFile(schemaPath);
  await runSqlFile(migratePath);
}

module.exports = {
  pool,
  initDb,
};
