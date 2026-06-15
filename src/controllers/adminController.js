const sensorCache = require('../cache/sensorCache');
const { calculateDailySummary } = require('../cron/dailySummary');

exports.refreshCache = async (req, res) => {
    try {
        await sensorCache.loadActiveSensors();
        res.status(200).json({ message: 'Sensör cache belleği veritabanından güncellendi' });
    } catch (error) {
        console.error('[Admin] Cache yenileme hatası:', error);
        res.status(500).json({ error: 'Cache güncellenirken sunucu hatası oluştu' });
    }
};

exports.runDailySummary = async (req, res) => {
    try {
        const { date } = req.query;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'date parametresi YYYY-MM-DD formatında olmalıdır' });
        }
        await calculateDailySummary(date ?? null);
        res.status(200).json({ message: `Günlük özet hesaplandı (${date ?? 'dün'})` });
    } catch (error) {
        console.error('[Admin] Günlük özet hatası:', error);
        res.status(500).json({ error: 'Günlük özet hesaplanırken sunucu hatası oluştu' });
    }
};