/**
 * /api/telemetry'e gelip kabul edilmeyen (401) istekleri kaydeder.
 *
 * Bu kayıt, bir aracın neden sustuğunu ayırt etmenin en net yoludur: cihaz sunucuya
 * ULAŞABİLİYORSA sessizliğin sebebi internet değil, sensör tanımıdır. Kayıt olmadan bu iki
 * durum backend'den ayırt edilemez.
 */
const pool = require('../db');

/** Aynı seri numarası için en fazla bu sıklıkta DB'ye yazılır. */
const WRITE_THROTTLE_MS = 60 * 1000;

/** Throttle tablosu bu boyutu aşarsa eski kayıtlar temizlenir (bellek sınırı). */
const MAX_TRACKED_SERIALS = 500;

/** serial_number -> { lastWriteAt, suppressed } */
const throttle = new Map();

function pruneThrottle(now) {
  if (throttle.size <= MAX_TRACKED_SERIALS) return;
  for (const [serial, entry] of throttle) {
    if (now - entry.lastWriteAt >= WRITE_THROTTLE_MS) throttle.delete(serial);
  }
}

/**
 * Başarısız telemetri denemesini kaydeder.
 *
 * Yabancı/bozuk bir cihazın sunucuyu yormaması için seri numarası başına dakikada bir
 * yazılır. Ara dönemde bastırılan denemeler bir sonraki yazımda sayaca eklenir; yani
 * `attempt_count`, son penceredeki henüz aktarılmamış denemeler dışında gerçek sayıdır.
 */
const recordAuthFailure = async (serialNumber) => {
  if (!serialNumber) return;

  const now = Date.now();
  const entry = throttle.get(serialNumber);

  if (entry && now - entry.lastWriteAt < WRITE_THROTTLE_MS) {
    entry.suppressed += 1;
    return;
  }

  const attempts = 1 + (entry?.suppressed ?? 0);
  throttle.set(serialNumber, { lastWriteAt: now, suppressed: 0 });
  pruneThrottle(now);

  try {
    // Sebep ayrımı: cihaz hiç tanınmıyor mu, kayıtlı ama pasif mi, yoksa veritabanında
    // aktif olduğu hâlde sunucu cache'i mi bayat (yeni eklenen sensör, cache yenilenmemiş)?
    const { rows } = await pool.query(
      'SELECT vehicle_id, is_active FROM sensors WHERE serial_number = $1',
      [serialNumber]
    );

    let reason = 'unknown_serial';
    let vehicleId = null;
    if (rows.length > 0) {
      vehicleId = rows[0].vehicle_id;
      reason = rows[0].is_active ? 'stale_cache' : 'inactive_sensor';
    }

    await pool.query(
      `INSERT INTO sensor_auth_failures
         (serial_number, reason, vehicle_id, attempt_count, first_attempt_at, last_attempt_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (serial_number) DO UPDATE SET
         reason          = EXCLUDED.reason,
         vehicle_id      = EXCLUDED.vehicle_id,
         attempt_count   = sensor_auth_failures.attempt_count + EXCLUDED.attempt_count,
         last_attempt_at = NOW()`,
      [serialNumber, reason, vehicleId, attempts]
    );
  } catch (err) {
    // Kayıt tutulamazsa telemetri yanıtı yine de dönmeli.
    console.error('[SensorAuthLog] Kayıt hatası:', err.code || '', err.message);
  }
};

module.exports = { recordAuthFailure };
