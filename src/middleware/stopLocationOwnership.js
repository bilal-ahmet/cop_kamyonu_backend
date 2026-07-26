const pool = require('../db');

const stopLocationOwnership = async (req, res, next) => {
    try {
        if (req.user.role === 'admin') return next();

        const stopLocationId = parseInt(req.params.id);
        const userId = req.user.id;

        if (!Number.isInteger(stopLocationId) || stopLocationId <= 0)
            return res.status(400).json({ error: 'Geçersiz lokasyon id' });

        // Sahiplik ile "kayıt yok" ayrı ayrı raporlanır: silinmiş bir kayda
        // "yetkiniz yok" demek kullanıcıyı yanıltıyordu.
        const result = await pool.query(
            `SELECT sl.id, v.user_id FROM stop_locations sl
             JOIN vehicles v ON v.id = sl.vehicle_id
             WHERE sl.id = $1`,
            [stopLocationId]
        );

        if (result.rowCount === 0)
            return res.status(404).json({ error: 'Durak lokasyonu bulunamadı' });
        if (result.rows[0].user_id !== userId)
            return res.status(403).json({ error: 'Bu durak lokasyonuna erişim yetkiniz yok' });

        next();
    } catch (err) {
        console.error('stopLocationOwnership hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = stopLocationOwnership;
