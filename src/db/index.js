const { Pool } = require('pg');
require('dotenv').config();

// PG_URL: DigitalOcean'da çakışma yaratmayan özel değişken adı.
// DATABASE_URL: DO App Platform tarafından otomatik inject edildiği için çakışıyor.
const connectionString = process.env.PG_URL || process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
});

module.exports = pool;
