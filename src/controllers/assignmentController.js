const pool = require('../db');
const {
    findAccessibleVehicle,
    findAccessibleAssignment,
    denyVehicle,
} = require('../utils/access');

const getAssignments = async (req, res) => {
    try {
        const { vehicle_id, driver_id, active_only } = req.query;

        // Admin hedef kullanıcı seçmediyse scopeUserId null gelir ve tüm
        // filonun atamaları listelenir.
        const conditions = [];
        const values = [];
        let idx = 1;

        if (req.scopeUserId !== null) {
            conditions.push(`v.user_id = $${idx++}`); values.push(req.scopeUserId);
        }
        if (vehicle_id) {
            const vehicle = await findAccessibleVehicle(req, vehicle_id);
            if (!vehicle) return denyVehicle(req, res);
            conditions.push(`va.vehicle_id = $${idx++}`); values.push(vehicle_id);
        }
        if (driver_id) { conditions.push(`va.driver_id = $${idx++}`); values.push(driver_id); }
        if (active_only === 'true') conditions.push('va.released_date IS NULL');
        if (conditions.length === 0) conditions.push('TRUE');

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
        const conditions = ['va.id = $1'];
        const values = [req.params.id];
        if (!req.isAdmin) { conditions.push('v.user_id = $2'); values.push(req.user.id); }

        const result = await pool.query(
            `SELECT va.*, d.full_name AS driver_name, v.plate AS vehicle_plate
             FROM vehicle_assignments va
             JOIN vehicles v ON v.id = va.vehicle_id
             JOIN drivers d ON d.id = va.driver_id
             WHERE ${conditions.join(' AND ')}`,
            values
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

        // Admin her araca şoför atayabilir; müşteri yalnızca kendi araçlarına.
        const vehicle = await findAccessibleVehicle(req, vehicle_id);
        if (!vehicle) return denyVehicle(req, res);
        if (!vehicle.is_active)
            return res.status(409).json({ error: 'Araç pasif; önce aracı yeniden aktif edin' });

        const driver = await pool.query(
            'SELECT id, user_id FROM drivers WHERE id = $1 AND is_active = TRUE',
            [driver_id]
        );
        if (driver.rowCount === 0)
            return res.status(404).json({ error: 'Sürücü bulunamadı veya pasif' });

        // Şoför, aracın sahibi olan müşteriye ait olmalı — id tahmin edilerek
        // başka bir müşterinin şoförü bu araca tanımlanamasın. drivers.user_id
        // kolonu sonradan eklendiği için sahipsiz eski kayıtlar muaf tutulur.
        if (driver.rows[0].user_id != null && driver.rows[0].user_id !== vehicle.user_id)
            return res.status(409).json({ error: 'Bu şoför, aracın sahibi olan müşteriye ait değil' });

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

/** ":id" parametresini güvenle sayıya çevirir; geçersizse null döner. */
function parseId(raw) {
    const id = parseInt(raw, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

/** "YYYY-MM-DD" biçimini doğrular (timezone kayması olmadan karşılaştırılabilir). */
function toDateOnly(value) {
    if (value instanceof Date) {
        // pg DATE kolonlarını yerel gece yarısı Date olarak döndürür.
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const s = String(value).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

const updateAssignment = async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'Geçersiz atama id' });

        const row = await findAccessibleAssignment(req, id);
        if (!row) return res.status(404).json({ error: 'Atama bulunamadı' });

        const { released_date, notes } = req.body;
        const fields = [];
        const values = [];
        let idx = 1;

        if (released_date !== undefined) {
            if (released_date === null || released_date === '') {
                // Atamayı yeniden aç — ama araçta zaten aktif bir tanım varsa çakışır.
                if (row.released_date !== null) {
                    const conflict = await pool.query(
                        `SELECT id FROM vehicle_assignments
                         WHERE vehicle_id = $1 AND released_date IS NULL AND id <> $2`,
                        [row.vehicle_id, id]
                    );
                    if (conflict.rowCount > 0) {
                        return res.status(409).json({
                            error: 'Bu araç için zaten aktif bir tanım var; önce onu sonlandırın.',
                        });
                    }
                }
                fields.push(`released_date = NULL`);
            } else {
                const released = toDateOnly(released_date);
                if (released === null)
                    return res.status(400).json({ error: 'released_date geçerli bir tarih değil (YYYY-MM-DD)' });
                // Metin karşılaştırması: ISO tarihleri sözlük sırasıyla kronolojiktir.
                if (released < toDateOnly(row.assigned_date))
                    return res.status(400).json({ error: 'released_date, assigned_date tarihinden önce olamaz' });
                fields.push(`released_date = $${idx++}`); values.push(released);
            }
        }
        if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }

        if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

        values.push(id);
        const result = await pool.query(
            `UPDATE vehicle_assignments SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateAssignment hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

/**
 * Atamayı sonlandırır (POST /assignments/:id/end).
 * GREATEST(CURRENT_DATE, assigned_date) sayesinde gelecek tarihli atamalarda da
 * chk_dates kısıtı ihlal edilmez (eski DELETE davranışındaki 500'ün kaynağıydı).
 */
const endAssignment = async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'Geçersiz atama id' });

        const row = await findAccessibleAssignment(req, id);
        if (!row) return res.status(404).json({ error: 'Atama bulunamadı' });
        if (row.released_date !== null)
            return res.status(409).json({ error: 'Bu atama zaten sonlandırılmış' });

        const result = await pool.query(
            `UPDATE vehicle_assignments
             SET released_date = GREATEST(CURRENT_DATE, assigned_date)
             WHERE id = $1 RETURNING *`,
            [id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('endAssignment hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

/** Atamayı kalıcı olarak siler (DELETE /assignments/:id). */
const deleteAssignment = async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'Geçersiz atama id' });

        const row = await findAccessibleAssignment(req, id);
        if (!row) return res.status(404).json({ error: 'Atama bulunamadı' });

        await pool.query('DELETE FROM vehicle_assignments WHERE id = $1', [id]);
        res.json({ message: 'Atama silindi' });
    } catch (err) {
        console.error('deleteAssignment hatası:', err.code, err.message);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = {
    getAssignments,
    getAssignment,
    createAssignment,
    updateAssignment,
    endAssignment,
    deleteAssignment,
};
