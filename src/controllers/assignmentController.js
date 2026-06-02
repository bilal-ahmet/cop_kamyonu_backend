const pool = require('../db');

const getAssignments = async (req, res) => {
    try {
        const userId = req.user.id;
        const { vehicle_id, driver_id, active_only } = req.query;

        const conditions = ['v.user_id = $1'];
        const values = [userId];
        let idx = 2;

        if (vehicle_id) {
            const owns = await pool.query(
                'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2',
                [vehicle_id, userId]
            );
            if (owns.rowCount === 0) return res.status(403).json({ error: 'Bu araca erişim yetkiniz yok' });
            conditions.push(`va.vehicle_id = $${idx++}`); values.push(vehicle_id);
        }
        if (driver_id) { conditions.push(`va.driver_id = $${idx++}`); values.push(driver_id); }
        if (active_only === 'true') conditions.push('va.released_date IS NULL');

        const result = await pool.query(
            `SELECT va.*, d.full_name AS driver_name, v.plate AS vehicle_plate
             FROM vehicle_assignments va
             JOIN vehicles v ON v.id = va.vehicle_id
             JOIN drivers d ON d.id = va.driver_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY va.assigned_date DESC`,
            values
        );
        res.json(result.rows);
    } catch (err) {
        console.error('getAssignments hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const getAssignment = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT va.*, d.full_name AS driver_name, v.plate AS vehicle_plate
             FROM vehicle_assignments va
             JOIN vehicles v ON v.id = va.vehicle_id
             JOIN drivers d ON d.id = va.driver_id
             WHERE va.id = $1 AND v.user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Atama bulunamadı' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('getAssignment hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const createAssignment = async (req, res) => {
    try {
        const { vehicle_id, driver_id, assigned_date, notes } = req.body;
        if (!vehicle_id || !driver_id)
            return res.status(400).json({ error: 'vehicle_id ve driver_id zorunludur' });

        const vehicle = await pool.query(
            'SELECT id FROM vehicles WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
            [vehicle_id, req.user.id]
        );
        if (vehicle.rowCount === 0)
            return res.status(403).json({ error: 'Bu araca erişim yetkiniz yok veya araç pasif' });

        const driver = await pool.query(
            'SELECT id FROM drivers WHERE id = $1 AND is_active = TRUE',
            [driver_id]
        );
        if (driver.rowCount === 0)
            return res.status(404).json({ error: 'Sürücü bulunamadı veya pasif' });

        const conflict = await pool.query(
            'SELECT id FROM vehicle_assignments WHERE vehicle_id = $1 AND released_date IS NULL',
            [vehicle_id]
        );
        if (conflict.rowCount > 0)
            return res.status(409).json({ error: 'Bu araç için zaten aktif bir atama var' });

        const result = await pool.query(
            `INSERT INTO vehicle_assignments (vehicle_id, driver_id, assigned_date, notes)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [vehicle_id, driver_id, assigned_date || new Date().toISOString().split('T')[0], notes || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createAssignment hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const updateAssignment = async (req, res) => {
    try {
        const existing = await pool.query(
            `SELECT va.* FROM vehicle_assignments va
             JOIN vehicles v ON v.id = va.vehicle_id
             WHERE va.id = $1 AND v.user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (existing.rowCount === 0)
            return res.status(404).json({ error: 'Atama bulunamadı' });

        const row = existing.rows[0];
        const { released_date, notes } = req.body;
        const fields = [];
        const values = [];
        let idx = 1;

        if (released_date !== undefined) {
            if (new Date(released_date) < new Date(row.assigned_date))
                return res.status(400).json({ error: 'released_date, assigned_date tarihinden önce olamaz' });
            fields.push(`released_date = $${idx++}`); values.push(released_date);
        }
        if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }

        if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

        values.push(req.params.id);
        const result = await pool.query(
            `UPDATE vehicle_assignments SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateAssignment hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const deleteAssignment = async (req, res) => {
    try {
        const existing = await pool.query(
            `SELECT va.* FROM vehicle_assignments va
             JOIN vehicles v ON v.id = va.vehicle_id
             WHERE va.id = $1 AND v.user_id = $2`,
            [req.params.id, req.user.id]
        );
        if (existing.rowCount === 0)
            return res.status(404).json({ error: 'Atama bulunamadı' });

        const row = existing.rows[0];
        if (row.released_date !== null)
            return res.status(409).json({ error: 'Geçmiş atamalar silinemez' });

        await pool.query(
            'UPDATE vehicle_assignments SET released_date = CURRENT_DATE WHERE id = $1',
            [req.params.id]
        );
        res.json({ message: 'Atama sonlandırıldı' });
    } catch (err) {
        console.error('deleteAssignment hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = { getAssignments, getAssignment, createAssignment, updateAssignment, deleteAssignment };
