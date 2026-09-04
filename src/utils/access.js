const pool = require('../db');

/**
 * Sahiplik sorgularının ortak noktası: admin için sahiplik filtresi hiç
 * eklenmez (her kayda erişir), diğer kullanıcılar için `user_id` filtresi
 * uygulanır. Kayıt yoksa veya erişilemiyorsa null döner.
 *
 * actingUser middleware'i req.isAdmin'i doldurduğu için burada rol tekrar
 * okunmaz.
 */

/** Araca erişim. `activeOnly` verilirse pasif araç da null döner. */
async function findAccessibleVehicle(req, vehicleId, { activeOnly = false } = {}) {
    const id = parseInt(vehicleId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;

    const conditions = ['id = $1'];
    const values = [id];
    if (activeOnly) conditions.push('is_active = TRUE');
    if (!req.isAdmin) { conditions.push(`user_id = $${values.length + 1}`); values.push(req.user.id); }

    const result = await pool.query(`SELECT * FROM vehicles WHERE ${conditions.join(' AND ')}`, values);
    return result.rowCount === 0 ? null : result.rows[0];
}

/** Şoföre erişim. */
async function findAccessibleDriver(req, driverId) {
    const id = parseInt(driverId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;

    const conditions = ['id = $1'];
    const values = [id];
    if (!req.isAdmin) { conditions.push('user_id = $2'); values.push(req.user.id); }

    const result = await pool.query(`SELECT * FROM drivers WHERE ${conditions.join(' AND ')}`, values);
    return result.rowCount === 0 ? null : result.rows[0];
}

/** Atamaya erişim (araç sahibi üzerinden). */
async function findAccessibleAssignment(req, assignmentId) {
    const id = parseInt(assignmentId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;

    const conditions = ['va.id = $1'];
    const values = [id];
    if (!req.isAdmin) { conditions.push('v.user_id = $2'); values.push(req.user.id); }

    const result = await pool.query(
        `SELECT va.* FROM vehicle_assignments va
         JOIN vehicles v ON v.id = va.vehicle_id
         WHERE ${conditions.join(' AND ')}`,
        values
    );
    return result.rowCount === 0 ? null : result.rows[0];
}

/**
 * Erişilemeyen araç için yanıt. Admin'de "yetkiniz yok" demek yanıltıcı olur —
 * admin her araca erişebildiğine göre kayıt gerçekten yoktur.
 */
function denyVehicle(req, res) {
    return req.isAdmin
        ? res.status(404).json({ error: 'Araç bulunamadı' })
        : res.status(403).json({ error: 'Bu araca erişim yetkiniz yok' });
}

module.exports = {
    findAccessibleVehicle,
    findAccessibleDriver,
    findAccessibleAssignment,
    denyVehicle,
};
