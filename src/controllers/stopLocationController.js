const pool = require('../db');

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
        const { vehicle_id, name, lat, lon, radius_m } = req.body;
        if (!vehicle_id || !name || lat === undefined || lon === undefined)
            return res.status(400).json({ error: 'vehicle_id, name, lat ve lon zorunludur' });

        const vehicle = await pool.query(
            'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
            [vehicle_id, req.user.id]
        );
        if (vehicle.rowCount === 0)
            return res.status(403).json({ error: 'Bu araca erişim yetkiniz yok' });

        const result = await pool.query(
            `INSERT INTO stop_locations (vehicle_id, name, lat, lon, radius_m)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [vehicle_id, name, lat, lon, radius_m || 5]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createStopLocation hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const updateStopLocation = async (req, res) => {
    try {
        const { name, lat, lon, radius_m, is_active } = req.body;
        const fields = [];
        const values = [];
        let idx = 1;

        if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
        if (lat !== undefined) { fields.push(`lat = $${idx++}`); values.push(lat); }
        if (lon !== undefined) { fields.push(`lon = $${idx++}`); values.push(lon); }
        if (radius_m !== undefined) { fields.push(`radius_m = $${idx++}`); values.push(radius_m); }
        if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }

        if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

        values.push(req.params.id);
        const result = await pool.query(
            `UPDATE stop_locations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateStopLocation hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const deactivateStopLocation = async (req, res) => {
    try {
        await pool.query(
            'UPDATE stop_locations SET is_active = FALSE WHERE id = $1',
            [req.params.id]
        );
        res.json({ message: 'Durak lokasyonu devre dışı bırakıldı' });
    } catch (err) {
        console.error('deactivateStopLocation hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = {
    getStopLocations,
    getStopLocation,
    createStopLocation,
    updateStopLocation,
    deactivateStopLocation,
};
