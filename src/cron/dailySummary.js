const cron = require('node-cron');
const pool = require('../db');

const calculateDailySummary = async () => {
    console.log('[Cron] Günlük istatistik hesaplama başlatıldı...');
    try {
        const query = `
            INSERT INTO daily_summaries 
                (vehicle_id, driver_id, summary_date, avg_speed_kmh, max_speed_kmh, waypoint_count, total_load_kg, telemetry_count)
            SELECT
                vehicle_id,
                get_active_driver(vehicle_id),
                CURRENT_DATE - 1,
                COALESCE(AVG(speed_kmh), 0),
                COALESCE(MAX(speed_kmh), 0),
                (SELECT COUNT(*) FROM waypoints WHERE vehicle_id = t.vehicle_id AND arrived_at::date = CURRENT_DATE - 1),
                (SELECT COALESCE(SUM(load_received_kg), 0) FROM waypoints WHERE vehicle_id = t.vehicle_id AND arrived_at::date = CURRENT_DATE - 1),
                COUNT(*)
            FROM telemetry t
            WHERE recorded_at::date = CURRENT_DATE - 1
              AND fix_valid = TRUE
            GROUP BY vehicle_id
            ON CONFLICT (vehicle_id, summary_date) DO NOTHING;
        `;
        
        const result = await pool.query(query);
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
