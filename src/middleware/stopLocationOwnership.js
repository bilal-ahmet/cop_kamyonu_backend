const pool = require('../db');

const stopLocationOwnership = async (req, res, next) => {
    try {
        const stopLocationId = parseInt(req.params.id);
        const userId = req.user.id;

        const result = await pool.query(
            `SELECT sl.id FROM stop_locations sl
             JOIN vehicles v ON v.id = sl.vehicle_id
             WHERE sl.id = $1 AND v.user_id = $2`,
            [stopLocationId, userId]
        );

        if (result.rowCount === 0)
            return res.status(403).json({ error: 'Bu durak lokasyonuna erişim yetkiniz yok' });

        next();
    } catch (err) {
        console.error('stopLocationOwnership hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = stopLocationOwnership;
