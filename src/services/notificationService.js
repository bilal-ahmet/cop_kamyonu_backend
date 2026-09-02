/**
 * Bildirim üretimi — tek yerden.
 *
 * Bildirimler ALICI BAŞINA bir satır olarak yazılır. Böylece "okundu" bilgisi kişiye özel
 * kalır ve okuma tarafı tek bir `WHERE user_id = $1` ile çalışır (ayrı sahiplik middleware'i
 * gerekmez).
 */
const pool = require('../db');

/** Aracın sahibi + tüm aktif admin kullanıcılar (tekrarsız). */
const recipientsForVehicle = async (vehicleOwnerId) => {
  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE is_active = TRUE AND (id = $1 OR role = 'admin')`,
    [vehicleOwnerId]
  );
  return rows.map((r) => r.id);
};

/** Yalnızca aktif adminler — filo geneli / sistem bildirimleri için. */
const adminRecipients = async () => {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE is_active = TRUE AND role = 'admin'`
  );
  return rows.map((r) => r.id);
};

/**
 * Aynı bildirimi birden çok kullanıcıya tek sorguda yazar.
 * userIds boşsa hiçbir şey yapmaz (ör. sistemde aktif admin kalmamışsa).
 */
const createNotification = async ({
  userIds,
  vehicleId = null,
  type,
  severity = 'warning',
  title,
  message = null,
  probableCause = null,
  causeConfidence = null,
  metadata = null,
}) => {
  if (!userIds || userIds.length === 0) return 0;

  const result = await pool.query(
    `INSERT INTO notifications
       (user_id, vehicle_id, type, severity, title, message,
        probable_cause, cause_confidence, metadata)
     SELECT u, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
     FROM UNNEST($1::int[]) AS u`,
    [userIds, vehicleId, type, severity, title, message,
     probableCause, causeConfidence, metadata ? JSON.stringify(metadata) : null]
  );
  return result.rowCount;
};

/**
 * Kapanmış bir kesintinin bildirimlerine geriye dönük sebep yazar.
 * Sinyal #3 (backfill) kesintinin gerçekten bağlantı kaynaklı olduğunu ispatladığında,
 * o kesinti sırasında üretilmiş "veri gelmiyor" satırları tahminden kesinliğe yükseltilir.
 */
const confirmCauseForOutage = async (vehicleId, silentSince, { cause, confidence, detail }) => {
  const result = await pool.query(
    `UPDATE notifications
     SET probable_cause   = $1,
         cause_confidence = $2,
         metadata         = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('confirmation', $3::text)
     WHERE vehicle_id = $4
       AND type = 'vehicle_data_stale'
       AND created_at >= $5`,
    [cause, confidence, detail, vehicleId, silentSince]
  );
  return result.rowCount;
};

module.exports = {
  recipientsForVehicle,
  adminRecipients,
  createNotification,
  confirmCauseForOutage,
};
