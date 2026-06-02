const pool = require('../db');
const sensorCache = require('../cache/sensorCache');

const createSensor = async (req, res) => {
    try {
        const { vehicle_id, serial_number, firmware_version, notes } = req.body;
        if (!vehicle_id || !serial_number)
            return res.status(400).json({ error: 'vehicle_id ve serial_number zorunludur' });

        const vehicle = await pool.query(
            'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
            [vehicle_id, req.user.id]
        );
        if (vehicle.rowCount === 0)
            return res.status(403).json({ error: 'Bu araca erişim yetkiniz yok' });

        const dup = await pool.query('SELECT id FROM sensors WHERE serial_number = $1', [serial_number]);
        if (dup.rowCount > 0)
            return res.status(409).json({ error: 'Bu seri numarası zaten kayıtlı' });

        const result = await pool.query(
            'INSERT INTO sensors (vehicle_id, serial_number, firmware_version, notes) VALUES ($1,$2,$3,$4) RETURNING *',
            [vehicle_id, serial_number, firmware_version || null, notes || null]
        );

        await sensorCache.loadActiveSensors();
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createSensor hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const getSensor = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sensors WHERE id = $1', [req.params.id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Sensör bulunamadı' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('getSensor hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const updateSensor = async (req, res) => {
    try {
        const { id } = req.params;
        const { serial_number, firmware_version, is_active, notes } = req.body;

        const fields = [];
        const values = [];
        let idx = 1;

        if (serial_number !== undefined) {
            const dup = await pool.query(
                'SELECT id FROM sensors WHERE serial_number = $1 AND id != $2',
                [serial_number, id]
            );
            if (dup.rowCount > 0) return res.status(409).json({ error: 'Bu seri numarası zaten kayıtlı' });
            fields.push(`serial_number = $${idx++}`); values.push(serial_number);
        }
        if (firmware_version !== undefined) { fields.push(`firmware_version = $${idx++}`); values.push(firmware_version); }
        if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }
        if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }

        if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

        values.push(id);
        const result = await pool.query(
            `UPDATE sensors SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );

        await sensorCache.loadActiveSensors();
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateSensor hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const deactivateSensor = async (req, res) => {
    try {
        await pool.query('UPDATE sensors SET is_active = FALSE WHERE id = $1', [req.params.id]);
        await sensorCache.loadActiveSensors();
        res.json({ message: 'Sensör devre dışı bırakıldı' });
    } catch (err) {
        console.error('deactivateSensor hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = { createSensor, getSensor, updateSensor, deactivateSensor };
