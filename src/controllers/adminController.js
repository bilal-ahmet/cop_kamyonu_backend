const sensorCache = require('../cache/sensorCache');

exports.refreshCache = async (req, res) => {
    try {
        await sensorCache.loadActiveSensors();
        res.status(200).json({ message: 'Sensör cache belleği veritabanından güncellendi' });
    } catch (error) {
        console.error('[Admin] Cache yenileme hatası:', error);
        res.status(500).json({ error: 'Cache güncellenirken sunucu hatası oluştu' });
    }
};