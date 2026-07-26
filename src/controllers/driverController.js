const pool = require('../db');

const getDrivers = async (req, res) => {
    try {
        const includeInactive = req.query.include_inactive === 'true';
        const query = includeInactive
            ? 'SELECT * FROM drivers WHERE user_id = $1 ORDER BY full_name'
            : 'SELECT * FROM drivers WHERE user_id = $1 AND is_active = TRUE ORDER BY full_name';
        const result = await pool.query(query, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error('getDrivers hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const getDriver = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM drivers WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Sürücü bulunamadı' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('getDriver hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const createDriver = async (req, res) => {
    try {
        const { full_name, license_no, phone, birth_date } = req.body;
        if (!full_name) return res.status(400).json({ error: 'full_name zorunludur' });

        if (license_no) {
            const dup = await pool.query(
                'SELECT id FROM drivers WHERE license_no = $1 AND user_id = $2',
                [license_no, req.user.id]
            );
            if (dup.rowCount > 0) return res.status(409).json({ error: 'Bu ehliyet numarası zaten kayıtlı' });
        }

        const result = await pool.query(
            'INSERT INTO drivers (user_id, full_name, license_no, phone, birth_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [req.user.id, full_name, license_no || null, phone || null, birth_date || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createDriver hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const updateDriver = async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, license_no, phone, birth_date, is_active } = req.body;

        const exists = await pool.query(
            'SELECT id FROM drivers WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (exists.rowCount === 0) return res.status(404).json({ error: 'Sürücü bulunamadı' });

        const fields = [];
        const values = [];
        let idx = 1;

        if (full_name !== undefined) { fields.push(`full_name = $${idx++}`); values.push(full_name); }
        if (license_no !== undefined) {
            const dup = await pool.query(
                'SELECT id FROM drivers WHERE license_no = $1 AND id != $2 AND user_id = $3',
                [license_no, id, req.user.id]
            );
            if (dup.rowCount > 0) return res.status(409).json({ error: 'Bu ehliyet numarası zaten kayıtlı' });
            fields.push(`license_no = $${idx++}`); values.push(license_no);
        }
        if (phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(phone); }
        if (birth_date !== undefined) { fields.push(`birth_date = $${idx++}`); values.push(birth_date); }
        // Pasif şoförü yeniden aktif etmek için (Şoförler sekmesindeki "Tekrar aktif et").
        if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(Boolean(is_active)); }

        if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

        values.push(id);
        const result = await pool.query(
            `UPDATE drivers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateDriver hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const deactivateDriver = async (req, res) => {
    try {
        const { id } = req.params;

        const exists = await pool.query(
            'SELECT id FROM drivers WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (exists.rowCount === 0) return res.status(404).json({ error: 'Sürücü bulunamadı' });

        const activeAssignment = await pool.query(
            'SELECT id FROM vehicle_assignments WHERE driver_id = $1 AND released_date IS NULL',
            [id]
        );
        if (activeAssignment.rowCount > 0)
            return res.status(409).json({ error: 'Şoförün aktif araç ataması var, önce atamayı sonlandırın' });

        const result = await pool.query(
            'UPDATE drivers SET is_active = FALSE WHERE id = $1 RETURNING *', [id]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('deactivateDriver hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

/**
 * Şoförü kalıcı olarak siler (DELETE /drivers/:id).
 * Geçmişi olan şoför silinemez — atama/durak/rapor kayıtları şoföre bağlı ve
 * bunları sessizce yok etmek yerine "Devre dışı" önerilir.
 */
const deleteDriver = async (req, res) => {
    try {
        const { id } = req.params;

        const exists = await pool.query(
            'SELECT full_name FROM drivers WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (exists.rowCount === 0) return res.status(404).json({ error: 'Sürücü bulunamadı' });

        // Şoföre bağlı kayıtlar (FK'lar RESTRICT/NO ACTION olduğu için silme engellenir)
        const refs = await pool.query(
            `SELECT
               (SELECT COUNT(*)::int FROM vehicle_assignments WHERE driver_id = $1) AS assignments,
               (SELECT COUNT(*)::int FROM waypoints           WHERE driver_id = $1) AS waypoints,
               (SELECT COUNT(*)::int FROM daily_summaries     WHERE driver_id = $1) AS summaries`,
            [id]
        );
        const { assignments, waypoints, summaries } = refs.rows[0];
        const total = assignments + waypoints + summaries;
        if (total > 0) {
            const parts = [];
            if (assignments) parts.push(`${assignments} araç tanımı`);
            if (waypoints) parts.push(`${waypoints} durak kaydı`);
            if (summaries) parts.push(`${summaries} günlük rapor`);
            return res.status(409).json({
                error: `Bu şoföre bağlı ${parts.join(', ')} var; silinemez. ` +
                       `Geçmişi korumak için "Devre dışı" seçeneğini kullanın.`,
            });
        }

        await pool.query('DELETE FROM drivers WHERE id = $1', [id]);
        res.json({ message: 'Şoför silindi' });
    } catch (err) {
        console.error('deleteDriver hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = { getDrivers, getDriver, createDriver, updateDriver, deactivateDriver, deleteDriver };
