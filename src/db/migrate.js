/**
 * init.sql'i veritabanına uygular (npm run migrate).
 *
 * init.sql tamamen idempotenttir (CREATE ... IF NOT EXISTS / CREATE OR REPLACE /
 * ADD COLUMN IF NOT EXISTS), bu yüzden tekrar tekrar çalıştırılabilir. Mevcut
 * veriye dokunmaz; yalnızca eksik tablo/kolon/index/fonksiyonları tamamlar.
 *
 * Kullanım:
 *   npm run migrate            → DATABASE_URL / PG_URL neyi gösteriyorsa oraya
 *   npm run migrate -- --dry   → yalnızca hedefi göster, hiçbir şey çalıştırma
 */
const fs = require('fs');
const path = require('path');
const pool = require('./index');

const SQL_PATH = path.join(__dirname, 'init.sql');

/** Bağlantı dizesinden şifreyi gizleyerek "user@host/db" özeti üretir. */
function describeTarget() {
    const raw = process.env.PG_URL || process.env.DATABASE_URL;
    if (!raw) return '(DATABASE_URL / PG_URL tanımlı değil)';
    try {
        const u = new URL(raw);
        return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`;
    } catch {
        return '(bağlantı dizesi çözümlenemedi)';
    }
}

async function main() {
    const target = describeTarget();
    console.log(`Hedef veritabanı : ${target}`);
    console.log(`Şema dosyası     : ${SQL_PATH}`);

    if (process.argv.includes('--dry')) {
        console.log('\n--dry verildi, hiçbir şey çalıştırılmadı.');
        return;
    }

    const sql = fs.readFileSync(SQL_PATH, 'utf8');
    const client = await pool.connect();
    try {
        await client.query(sql);
        console.log('\nŞema uygulandı.');

        const { rows } = await client.query(
            `SELECT column_name, data_type, column_default
             FROM information_schema.columns
             WHERE table_name = 'stop_locations' AND column_name = 'kind'`
        );
        console.log(
            rows.length > 0
                ? `Doğrulama: stop_locations.kind mevcut (${rows[0].data_type}, varsayılan ${rows[0].column_default}).`
                : 'UYARI: stop_locations.kind bulunamadı!'
        );
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error('\nMigrasyon hatası:', err.code || '', err.message);
    process.exit(1);
});
