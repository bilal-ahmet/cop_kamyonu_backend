const pool = require('../db');
const sensorCache = require('../cache/sensorCache');

exports.receiveTelemetry = async (req, res) => {
    try {
        const {
            serial_number, lat, lon, speed_kmh, speed_knots, cog_deg,
            load_kg, fix_valid, year, month, day, hour, minute, second
        } = req.body;

        // 0. Eksik Alan Kontrolü
        if (!serial_number || lat === undefined || lon === undefined ||
            speed_kmh === undefined || load_kg === undefined ||
            !year || !month || !day || hour === undefined || minute === undefined || second === undefined) {
            return res.status(400).json({ error: 'Zorunlu alanlar eksik' });
        }

        // 1. Sensör Doğrulama (In-Memory Cache üzerinden)
        const sensorData = sensorCache.getVehicleIdBySensorSN(serial_number);
        if (!sensorData) {
            return res.status(401).json({ error: 'Yetkisiz Sensör: Aktif bir kayıt bulunamadı.' });
        }
        
        const vehicleId = sensorData.vehicle_id;
        const sensorId = sensorData.sensor_id;

        // 2. Veri Doğrulama (Basic validasyonlar)
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || speed_kmh < 0 || load_kg < 0) {
            return res.status(400).json({ error: 'Geçersiz veri aralığı' });
        }

        // 3. Zaman formatlama (JS Date API'si üzerinden TIMESTAMPTZ)
        // Türkiye saatini açıkça belirterek UTC+3 olarak kaydet
        const recordDate = new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}+03:00`);
        
        // 4. Veritabanına Yazma
        const insertQuery = `
            INSERT INTO telemetry 
            (sensor_id, vehicle_id, lat, lon, cog_deg, fix_valid, speed_kmh, speed_knots, load_kg, recorded_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;
        const values = [
            sensorId, vehicleId, lat, lon, cog_deg, fix_valid, speed_kmh, speed_knots, load_kg, recordDate
        ];

        await pool.query(insertQuery, values);
        
        res.status(200).json({ message: 'OK' });
    } catch (error) {
        console.error('[Telemetry Error]', error);
        res.status(500).json({ error: 'Sunucu tarafında hata oluştu' });
    }
};
