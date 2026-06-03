const pool = require('../db');
const sensorCache = require('../cache/sensorCache');

/** Haversine formülü — iki GPS noktası arasındaki mesafeyi metre cinsinden hesaplar. */
function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Geofencing kontrolü: kamyonun aktif durak lokasyonlarına yakınlığını kontrol eder.
 * - Yarıçap içindeyse ve açık waypoint yoksa → yeni waypoint oluşturur (arrived_at set).
 * - Yarıçap dışındaysa ve açık waypoint varsa → departed_at set eder.
 * Hata durumunda telemetri kaydını engellemez, sadece loglar.
 */
async function checkGeofence(vehicleId, lat, lon, recordedAt) {
    try {
        const { rows: stopLocations } = await pool.query(
            'SELECT * FROM stop_locations WHERE vehicle_id = $1 AND is_active = TRUE',
            [vehicleId]
        );
        if (stopLocations.length === 0) return;

        for (const stop of stopLocations) {
            const distance = haversineMeters(
                lat, lon,
                parseFloat(stop.lat), parseFloat(stop.lon)
            );
            const isInside = distance <= stop.radius_m;

            if (isInside) {
                // Açık waypoint var mı kontrol et
                const { rows: openWp } = await pool.query(
                    `SELECT id FROM waypoints
                     WHERE vehicle_id = $1 AND stop_location_id = $2 AND departed_at IS NULL
                     LIMIT 1`,
                    [vehicleId, stop.id]
                );
                if (openWp.length === 0) {
                    // Yeni varış — waypoint oluştur
                    await pool.query(
                        `INSERT INTO waypoints
                         (vehicle_id, stop_location_id, location_name, lat, lon, arrived_at)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [vehicleId, stop.id, stop.name,
                         parseFloat(stop.lat), parseFloat(stop.lon), recordedAt]
                    );
                    console.log(`[Geofence] Varış: araç=${vehicleId} durak="${stop.name}"`);
                }
            } else {
                // Kamyon dışarıda — açık waypoint varsa departed_at set et
                await pool.query(
                    `UPDATE waypoints SET departed_at = $1
                     WHERE vehicle_id = $2 AND stop_location_id = $3 AND departed_at IS NULL`,
                    [recordedAt, vehicleId, stop.id]
                );
            }
        }
    } catch (err) {
        console.error('[Geofence] Hata:', err);
    }
}

exports.receiveTelemetry = async (req, res) => {
    try {
        const {
            serial_number, lat, lon, speed_kmh, speed_knots, cog_deg,
            load_kg, fix_valid, year, month, day, hour, minute, second
        } = req.body;

        // 0. Eksik Alan Kontrolü
        if (!serial_number || lat === undefined || lon === undefined ||
            load_kg === undefined ||
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

        // Geofencing — telemetri yanıtını bloklamaz, arka planda çalışır
        checkGeofence(vehicleId, lat, lon, recordDate);

        res.status(200).json({ message: 'OK' });
    } catch (error) {
        console.error('[Telemetry Error]', error);
        res.status(500).json({ error: 'Sunucu tarafında hata oluştu' });
    }
};
