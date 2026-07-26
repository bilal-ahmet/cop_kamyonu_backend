const pool = require('../db');

const sensorOwnership = async (req, res, next) => {
    try {
        if (req.user.role === 'admin') return next();

        const sensorId = parseInt(req.params.id);
        const userId = req.user.id;

        if (!Number.isInteger(sensorId) || sensorId <= 0)
            return res.status(400).json({ error: 'Geçersiz sensör id' });

        // Sahiplik ile "kayıt yok" ayrı ayrı raporlanır (silinmiş kayıtta 404, başkasınınkinde 403).
        const result = await pool.query(
            `SELECT s.id, s.vehicle_id, v.user_id FROM sensors s
             JOIN vehicles v ON v.id = s.vehicle_id
             WHERE s.id = $1`,
            [sensorId]
        );

        if (result.rowCount === 0)
            return res.status(404).json({ error: 'Sensör bulunamadı' });
        if (result.rows[0].user_id !== userId)
            return res.status(403).json({ error: 'Bu sensöre erişim yetkiniz yok' });

        req.sensorVehicleId = result.rows[0].vehicle_id;
        next();
    } catch (err) {
        console.error('sensorOwnership hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = sensorOwnership;
