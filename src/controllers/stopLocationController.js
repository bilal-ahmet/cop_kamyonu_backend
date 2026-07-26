const pool = require('../db');

const KINDS = ['stop', 'start', 'end'];

/**
 * Araç başına tek başlangıç / tek bitiş kuralı: aynı türdeki diğer kayıtları
 * sıradan durağa düşürür. ('stop' için bir şey yapmaz.)
 */
async function demoteOtherKinds(vehicleId, kind, exceptId) {
    if (kind !== 'start' && kind !== 'end') return;
    await pool.query(
        `UPDATE stop_locations SET kind = 'stop'
         WHERE vehicle_id = $1 AND kind = $2 AND id <> $3`,
        [vehicleId, kind, exceptId]
    );
}

const getStopLocations = async (req, res) => {
    try {
        const vehicleId = parseInt(req.params.id);
        const result = await pool.query(
            'SELECT * FROM stop_locations WHERE vehicle_id = $1 ORDER BY created_at DESC',
            [vehicleId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('getStopLocations hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const getStopLocation = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM stop_locations WHERE id = $1',
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Durak lokasyonu bulunamadı' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('getStopLocation hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const createStopLocation = async (req, res) => {
    try {
        const { vehicle_id, name, lat, lon, radius_m, kind } = req.body;
        if (!vehicle_id || !name || lat === undefined || lon === undefined)
            return res.status(400).json({ error: 'vehicle_id, name, lat ve lon zorunludur' });

        if (kind !== undefined && kind !== null && !KINDS.includes(kind))
            return res.status(400).json({ error: `kind şunlardan biri olmalı: ${KINDS.join(', ')}` });

        const vehicle = await pool.query(
            'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
            [vehicle_id, req.user.id]
        );
        if (vehicle.rowCount === 0)
            return res.status(403).json({ error: 'Bu araca erişim yetkiniz yok' });

        const result = await pool.query(
            `INSERT INTO stop_locations (vehicle_id, name, lat, lon, radius_m, kind)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [vehicle_id, name, lat, lon, radius_m || 5, kind || 'stop']
        );

        const created = result.rows[0];
        await demoteOtherKinds(created.vehicle_id, created.kind, created.id);

        res.status(201).json(created);
    } catch (err) {
        console.error('createStopLocation hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const updateStopLocation = async (req, res) => {
    try {
        const { name, lat, lon, radius_m, is_active, kind } = req.body;

        if (kind !== undefined && !KINDS.includes(kind))
            return res.status(400).json({ error: `kind şunlardan biri olmalı: ${KINDS.join(', ')}` });

        const fields = [];
        const values = [];
        let idx = 1;

        if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
        if (lat !== undefined) { fields.push(`lat = $${idx++}`); values.push(lat); }
        if (lon !== undefined) { fields.push(`lon = $${idx++}`); values.push(lon); }
        if (radius_m !== undefined) { fields.push(`radius_m = $${idx++}`); values.push(radius_m); }
        if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }
        if (kind !== undefined) { fields.push(`kind = $${idx++}`); values.push(kind); }

        if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

        values.push(req.params.id);
        const result = await pool.query(
            `UPDATE stop_locations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Durak lokasyonu bulunamadı' });

        const updated = result.rows[0];
        if (kind !== undefined) await demoteOtherKinds(updated.vehicle_id, updated.kind, updated.id);

        res.json(updated);
    } catch (err) {
        console.error('updateStopLocation hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

/** Lokasyonu devre dışı bırakır (POST /stop-locations/:id/deactivate) — kayıt durur. */
const deactivateStopLocation = async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE stop_locations SET is_active = FALSE WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Durak lokasyonu bulunamadı' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('deactivateStopLocation hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

/**
 * Lokasyonu kalıcı olarak siler (DELETE /stop-locations/:id).
 * Bağlı waypoint'ler silinmez; FK ON DELETE SET NULL sayesinde bağları kopar,
 * ziyaret geçmişi (location_name, saatler, yük) olduğu gibi kalır.
 */
const deleteStopLocation = async (req, res) => {
    try {
        const linked = await pool.query(
            'SELECT COUNT(*)::int AS n FROM waypoints WHERE stop_location_id = $1',
            [req.params.id]
        );
        const result = await pool.query(
            'DELETE FROM stop_locations WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Durak lokasyonu bulunamadı' });
        res.json({ message: 'Durak lokasyonu silindi', unlinked_waypoints: linked.rows[0].n });
    } catch (err) {
        console.error('deleteStopLocation hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = {
    getStopLocations,
    getStopLocation,
    createStopLocation,
    updateStopLocation,
    deactivateStopLocation,
    deleteStopLocation,
};
