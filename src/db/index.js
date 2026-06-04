const { Pool } = require('pg');
require('dotenv').config();

// PG_URL: DigitalOcean'da çakışma yaratmayan özel değişken adı.
// DATABASE_URL: DO App Platform tarafından otomatik inject edildiği için çakışıyor.
const connectionString = process.env.PG_URL || process.env.DATABASE_URL;

// localhost dışındaki bağlantılar (DigitalOcean vb.) için SSL doğrulamasını devre dışı bırak.
// sslmode=require connection string'de kalır ama sertifika zinciri kontrolü atlanır.
const isRemote = connectionString &&
  !connectionString.includes('localhost') &&
  !connectionString.includes('127.0.0.1');

const pool = new Pool({
  connectionString,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
});

module.exports = pool;
