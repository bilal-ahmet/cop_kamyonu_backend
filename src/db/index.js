const { Pool } = require('pg');
require('dotenv').config();

// PG_URL: DigitalOcean'da çakışma yaratmayan özel değişken adı.
// DATABASE_URL: DO App Platform tarafından otomatik inject edildiği için çakışıyor.
const rawConn = process.env.PG_URL || process.env.DATABASE_URL;

const isRemote = rawConn &&
  !rawConn.includes('localhost') &&
  !rawConn.includes('127.0.0.1');

// pg-connection-string v3'te sslmode=require → verify-full olarak yorumlanır ve
// self-signed sertifika hatası verir. sslmode'u string'den çıkarıp SSL'yi açıkça set ediyoruz.
const connectionString = rawConn
  ?.replace(/\?sslmode=[^&]*&/, '?')   // ?sslmode=x&other=y → ?other=y
  ?.replace(/[?&]sslmode=[^&]*/g, ''); // ?sslmode=x veya &sslmode=x → kaldır

const pool = new Pool({
  connectionString,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
});

module.exports = pool;
