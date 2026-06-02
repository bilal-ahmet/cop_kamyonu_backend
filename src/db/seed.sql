-- ============================================================
--  SEED — Geliştirme/test verisi (tekrar çalıştırılabilir / idempotent)
--  Araç 1–5 için GÜNCEL tarihli telemetri, durak ve günlük özet üretir.
--  users / vehicles / sensors / drivers tablolarına DOKUNMAZ.
--
--  Çalıştırma:
--    PGPASSWORD='...' psql -h localhost -U postgres -d postgres -f src/db/seed.sql
-- ============================================================

BEGIN;

-- Önce bu araçlara ait eski test verisini temizle (tekrar çalıştırmaya uygun olsun).
DELETE FROM telemetry       WHERE vehicle_id BETWEEN 1 AND 5;
DELETE FROM waypoints       WHERE vehicle_id BETWEEN 1 AND 5;
DELETE FROM daily_summaries WHERE vehicle_id BETWEEN 1 AND 5;

-- ------------------------------------------------------------
-- 1) TELEMETRY: her araca son ~1 saatte 30 nokta (2 dk arayla), en yenisi ~şimdi.
-- ------------------------------------------------------------
INSERT INTO telemetry (sensor_id, vehicle_id, lat, lon, cog_deg, fix_valid,
                       speed_kmh, speed_knots, load_kg, recorded_at)
SELECT v.sensor_id, v.vehicle_id,
       (v.base_lat + g.n * 0.0009)::numeric(10,7),
       (v.base_lon + g.n * 0.0011)::numeric(10,7),
       ((g.n * 12) % 360)::numeric(6,2), TRUE,
       (30 + g.n)::numeric(7,2),
       ((30 + g.n) / 1.852)::numeric(7,2),
       (10000 + g.n * 250)::numeric(10,2),
       NOW() - ((29 - g.n) * interval '2 minutes')
FROM (VALUES
        (1, 1, 40.9268, 29.0942),  -- Kadıköy
        (2, 2, 41.0082, 28.9784),  -- Sultanahmet
        (3, 3, 39.9334, 32.8597),  -- Ankara (plaka 06)
        (4, 4, 41.0151, 28.9795),
        (5, 5, 38.4192, 27.1287)   -- İzmir (plaka 35)
     ) AS v(sensor_id, vehicle_id, base_lat, base_lon)
CROSS JOIN generate_series(0, 29) AS g(n);

-- ------------------------------------------------------------
-- 2) WAYPOINTS: her araca 3 durak (son birkaç saat).
-- ------------------------------------------------------------
INSERT INTO waypoints (vehicle_id, driver_id, location_name, lat, lon,
                       load_received_kg, load_delivered_kg, arrived_at, departed_at)
SELECT v.vehicle_id, v.driver_id, w.name,
       (v.base_lat + w.dlat)::numeric(10,7), (v.base_lon + w.dlon)::numeric(10,7),
       w.recv::numeric(10,2), w.deliv::numeric(10,2),
       NOW() - w.ago, NOW() - w.ago + interval '15 minutes'
FROM (VALUES
        (1, 1, 40.9268, 29.0942),
        (2, 2, 41.0082, 28.9784),
        (3, 3, 39.9334, 32.8597),
        (4, 4, 41.0151, 28.9795),
        (5, 1, 38.4192, 27.1287)
     ) AS v(vehicle_id, driver_id, base_lat, base_lon)
CROSS JOIN (VALUES
        ('Aktarma İstasyonu A',       0.002,  0.003, 5000,     0, interval '3 hours'),
        ('Mahalle Toplama Noktası',  -0.004,  0.001, 3200,     0, interval '2 hours'),
        ('Çöp Aktarma Merkezi',       0.006, -0.002,    0, 12000, interval '1 hour')
     ) AS w(name, dlat, dlon, recv, deliv, ago);

-- ------------------------------------------------------------
-- 3) DAILY_SUMMARIES: her araca son 7 gün (CURRENT_DATE-6 … CURRENT_DATE).
-- ------------------------------------------------------------
INSERT INTO daily_summaries (vehicle_id, driver_id, summary_date, avg_speed_kmh,
                             max_speed_kmh, total_distance_km, waypoint_count,
                             total_load_kg, avg_load_kg, telemetry_count)
SELECT v.vehicle_id, v.driver_id, d::date,
       (35 + random() * 15)::numeric(7,2),
       (65 + random() * 25)::numeric(7,2),
       (90 + random() * 110)::numeric(10,2),
       (2 + (random() * 4))::int,
       (14000 + random() * 9000)::numeric(12,2),
       (8000 + random() * 4000)::numeric(10,2),
       (250 + (random() * 500))::int
FROM (VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 1)) AS v(vehicle_id, driver_id)
CROSS JOIN generate_series(CURRENT_DATE - 6, CURRENT_DATE, interval '1 day') AS d;

COMMIT;
