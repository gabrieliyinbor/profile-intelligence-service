require('dotenv').config();
const { initDb, pool } = require('../src/db');

(async () => {
  try {
    await initDb();
    console.log('Database initialized successfully.');
    await pool.end();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    await pool.end();
    process.exit(1);
  }
})();
