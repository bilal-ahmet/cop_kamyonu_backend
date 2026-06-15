const cron = require('node-cron');
const pool = require('../db');

// Dünün tarihini YYYY-MM-DD formatında döner
function yesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

const calculateDailySummary = async (targetDate = null) => {
    const date = targetDate ?? yesterday();
    console.log(`[Cron] Günlük istatistik hesaplama başlatıldı (${date})...`);
    try {
        const query = `
            INSERT INTO daily_summaries (
                vehicle_id, driver_id, summary_date,
                avg_speed_kmh, max_speed_kmh,
                waypoint_count, total_load_kg, telemetry_count,
                avg_temperature_c, min_temperature_c, max_temperature_c,
                avg_humidity_pct, avg_pressure_hpa,
                motion_count, avg_battery_mv
            )
            SELECT
                vehicle_id,
                get_active_driver(vehicle_id),
                $1::date,
                COALESCE(AVG(speed_kmh), 0),
                COALESCE(MAX(speed_kmh), 0),
                (SELECT COUNT(*) FROM waypoints WHERE vehicle_id = t.vehicle_id AND arrived_at::date = $1::date),
                (SELECT COALESCE(SUM(load_received_kg), 0) FROM waypoints WHERE vehicle_id = t.vehicle_id AND arrived_at::date = $1::date),
                COUNT(*),
                AVG(temperature_c),
                MIN(temperature_c),
                MAX(temperature_c),
                AVG(humidity_pct),
                AVG(pressure_hpa),
                COALESCE(SUM(CASE WHEN motion = TRUE THEN 1 ELSE 0 END), 0),
                AVG(battery_mv)::INT
            FROM telemetry t
            WHERE recorded_at::date = $1::date
            GROUP BY vehicle_id
            ON CONFLICT (vehicle_id, summary_date) DO UPDATE SET
                avg_speed_kmh     = EXCLUDED.avg_speed_kmh,
                max_speed_kmh     = EXCLUDED.max_speed_kmh,
                waypoint_count    = EXCLUDED.waypoint_count,
                total_load_kg     = EXCLUDED.total_load_kg,
                telemetry_count   = EXCLUDED.telemetry_count,
                avg_temperature_c = EXCLUDED.avg_temperature_c,
                min_temperature_c = EXCLUDED.min_temperature_c,
                max_temperature_c = EXCLUDED.max_temperature_c,
                avg_humidity_pct  = EXCLUDED.avg_humidity_pct,
                avg_pressure_hpa  = EXCLUDED.avg_pressure_hpa,
                motion_count      = EXCLUDED.motion_count,
                avg_battery_mv    = EXCLUDED.avg_battery_mv;
        `;
        
        const result = await pool.query(query, [date]);
        console.log(`[Cron] ${result.rowCount} aracın günlük özeti oluşturuldu.`);
    } catch (error) {
        console.error('[Cron] Günlük istatistik oluşturulurken hata:', error);
    }
};

// Her gece 00:05'te çalışacak şekilde ayarla
const scheduleDailySummary = () => {
    cron.schedule('5 0 * * *', () => {
        calculateDailySummary();
    });
    console.log('[Cron Job] Günlük istatistik rutini zamanlandı (00:05).');
};

module.exports = {
    scheduleDailySummary,
    calculateDailySummary // Manuel tetikleme veya test için export ediyoruz
};
