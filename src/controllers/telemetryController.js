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
        // Yeni sensör JSON formatı: { "Device Id", timestamp, location: { Lat, Lon }, Sensors: { Weight, ... } }
        const deviceId = req.body['Device Id'];
        const { timestamp } = req.body;
        const lat = req.body.location?.Lat;
        const lon = req.body.location?.Lon;
        const sensors    = req.body.Sensors ?? {};
        const load_kg       = sensors.Weight        ?? null;
        const temperature_c = sensors.Temperature   ?? null;
        const humidity_pct  = sensors.Humidity      ?? null;
        const pressure_hpa  = sensors.Pressure      ?? null;
        const motion        = sensors.Motion != null ? Boolean(sensors.Motion) : null;
        const battery_mv    = sensors['Battery Voltage'] ?? null;

        // 0. Zorunlu alan kontrolü
        if (!deviceId || !timestamp || lat === undefined || lon === undefined) {
            return res.status(400).json({
                error: 'Zorunlu alanlar eksik: Device Id, timestamp, location.Lat, location.Lon'
            });
        }

        // 1. Sensör doğrulama (in-memory cache üzerinden)
        const sensorData = sensorCache.getVehicleIdBySensorSN(deviceId);
        if (!sensorData) {
            return res.status(401).json({ error: 'Yetkisiz Sensör: Aktif bir kayıt bulunamadı.' });
        }

        const vehicleId = sensorData.vehicle_id;
        const sensorId = sensorData.sensor_id;

        // 2. Koordinat doğrulama
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            return res.status(400).json({ error: 'Geçersiz koordinat aralığı' });
        }
        if (load_kg !== null && load_kg < 0) {
            return res.status(400).json({ error: 'load_kg negatif olamaz' });
        }

        // 3. Unix timestamp (saniye) → Date
        const recordDate = new Date(timestamp * 1000);

        // 4. Veritabanına yazma
        await pool.query(
            `INSERT INTO telemetry
             (sensor_id, vehicle_id, lat, lon, fix_valid, load_kg,
              temperature_c, humidity_pct, pressure_hpa, motion, battery_mv, recorded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [sensorId, vehicleId, lat, lon, false, load_kg,
             temperature_c, humidity_pct, pressure_hpa, motion, battery_mv, recordDate]
        );

        // Geofencing — telemetri yanıtını bloklamaz, arka planda çalışır
        checkGeofence(vehicleId, lat, lon, recordDate);

        res.status(200).json({ message: 'OK' });
    } catch (error) {
        console.error('[Telemetry Error]', error);
        res.status(500).json({ error: 'Sunucu tarafında hata oluştu' });
    }
};
