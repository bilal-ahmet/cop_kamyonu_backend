-- ============================================================
--  1. USERS — Sisteme giriş yapan izleyiciler
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL          PRIMARY KEY,
    username        VARCHAR(60)     NOT NULL UNIQUE,
    email           VARCHAR(255)    NOT NULL UNIQUE,
    password_hash   TEXT            NOT NULL,
    full_name       VARCHAR(150),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    last_login      TIMESTAMPTZ
);
 
COMMENT ON TABLE  users               IS 'Sisteme şifresiyle giriş yapan izleyiciler/yöneticiler';
COMMENT ON COLUMN users.password_hash IS 'Düz metin asla saklanmaz — bcrypt hash (pgcrypto)';
COMMENT ON COLUMN users.is_active     IS 'FALSE yapılırsa kullanıcı giriş yapamaz, veriler silinmez';
 
 
-- ============================================================
--  2. VEHICLES — Araçlar
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
    id              SERIAL          PRIMARY KEY,
    user_id         INT             NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plate           VARCHAR(20)     NOT NULL UNIQUE,
    brand           VARCHAR(60),
    model           VARCHAR(60),
    year            SMALLINT,
    vehicle_type    VARCHAR(50),
    capacity_kg     NUMERIC(10,2),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
 
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate   ON vehicles(plate);
 
COMMENT ON TABLE  vehicles             IS 'Filodaki araçlar — her araç bir kullanıcıya (izleyiciye) aittir';
COMMENT ON COLUMN vehicles.user_id     IS 'Bu araç hangi kullanıcıya ait — erişim kontrolünün temeli';
COMMENT ON COLUMN vehicles.plate       IS 'Araç plakası — sensörün hangi araca ait olduğunu belirler';
COMMENT ON COLUMN vehicles.capacity_kg IS 'Aracın maksimum yük taşıma kapasitesi (kg)';
 
 
-- ============================================================
--  3. DRIVERS — Şoförler
-- ============================================================
CREATE TABLE IF NOT EXISTS drivers (
    id              SERIAL          PRIMARY KEY,
    full_name       VARCHAR(150)    NOT NULL,
    license_no      VARCHAR(40)     UNIQUE,
    phone           VARCHAR(30),
    birth_date      DATE,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
 
COMMENT ON TABLE  drivers          IS 'Şoförler — sisteme giriş yapmaz, sadece bilgi kaydı';
COMMENT ON COLUMN drivers.is_active IS 'FALSE yapılırsa şoför artık aktif değil ama geçmiş kayıtlar korunur';
 
 
-- ============================================================
--  4. SENSORS — Araçtaki Fiziksel Sensör/GPS Cihazları
-- ============================================================
CREATE TABLE IF NOT EXISTS sensors (
    id               SERIAL         PRIMARY KEY,
    vehicle_id       INT            NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    serial_number    VARCHAR(100)   NOT NULL UNIQUE,
    firmware_version VARCHAR(30),
    is_active        BOOLEAN        NOT NULL DEFAULT TRUE,
    installed_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    notes            TEXT
);
 
CREATE INDEX IF NOT EXISTS idx_sensors_vehicle_id ON sensors(vehicle_id);
 
COMMENT ON TABLE  sensors               IS 'Araçlara takılı fiziksel GPS/sensör cihazları';
COMMENT ON COLUMN sensors.serial_number IS 'Cihaz seri numarası — backend API bu numara ile aracı tanır';
COMMENT ON COLUMN sensors.is_active     IS 'Cihaz değiştirilirse eskisi FALSE yapılır, geçmiş veri korunur';
 
 
-- ============================================================
--  5. VEHICLE_ASSIGNMENTS — Araç–Şoför Atamaları
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_assignments (
    id              SERIAL          PRIMARY KEY,
    vehicle_id      INT             NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    driver_id       INT             NOT NULL REFERENCES drivers(id)  ON DELETE RESTRICT,
    assigned_date   DATE            NOT NULL DEFAULT CURRENT_DATE,
    released_date   DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
 
    CONSTRAINT chk_dates CHECK (released_date IS NULL OR released_date >= assigned_date)
);
 
CREATE INDEX IF NOT EXISTS idx_va_vehicle_id ON vehicle_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_va_driver_id  ON vehicle_assignments(driver_id);
CREATE INDEX IF NOT EXISTS idx_va_dates      ON vehicle_assignments(assigned_date, released_date);
 
COMMENT ON TABLE  vehicle_assignments               IS '"X şoförü, Y tarihinde, Z aracını kullandı" bilgisi';
COMMENT ON COLUMN vehicle_assignments.released_date IS 'NULL ise atama hâlâ devam ediyor demektir';
 
 
-- ============================================================
--  6. TELEMETRY — Ham Sensör Verisi
-- ============================================================
CREATE TABLE IF NOT EXISTS telemetry (
    id              BIGSERIAL       PRIMARY KEY,
    sensor_id       INT             NOT NULL REFERENCES sensors(id)  ON DELETE RESTRICT,
    vehicle_id      INT             NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
 
    -- Konum 
    lat             NUMERIC(10,7)   NOT NULL,
    lon             NUMERIC(10,7)   NOT NULL,
    cog_deg         NUMERIC(6,2),
    fix_valid       BOOLEAN         NOT NULL DEFAULT FALSE,
 
    -- Hız
    speed_kmh       NUMERIC(7,2)    NOT NULL,
    speed_knots     NUMERIC(7,2),
 
    -- Yük
    load_kg         NUMERIC(10,2)   NOT NULL DEFAULT 0,
 
    -- Zaman
    recorded_at     TIMESTAMPTZ     NOT NULL,
    received_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
 
CREATE INDEX IF NOT EXISTS idx_tel_vehicle_time ON telemetry(vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_tel_sensor_id    ON telemetry(sensor_id);
CREATE INDEX IF NOT EXISTS idx_tel_recorded_at  ON telemetry(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_tel_fix_valid    ON telemetry(fix_valid) WHERE fix_valid = TRUE;
 
COMMENT ON TABLE  telemetry             IS 'Sensörden gelen ham anlık veriler';
 
 
-- ============================================================
--  7. WAYPOINTS — Uğranılan Noktalar ve Yük Transferleri
-- ============================================================
CREATE TABLE IF NOT EXISTS waypoints (
    id                  SERIAL          PRIMARY KEY,
    vehicle_id          INT             NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    driver_id           INT             REFERENCES drivers(id),
    location_name       VARCHAR(200),
    lat                 NUMERIC(10,7)   NOT NULL,
    lon                 NUMERIC(10,7)   NOT NULL,
    load_received_kg    NUMERIC(10,2)   NOT NULL DEFAULT 0,
    load_delivered_kg   NUMERIC(10,2)   NOT NULL DEFAULT 0,
    arrived_at          TIMESTAMPTZ     NOT NULL,
    departed_at         TIMESTAMPTZ,
    notes               TEXT,
 
    CONSTRAINT chk_wp_times CHECK (departed_at IS NULL OR departed_at >= arrived_at)
);
 
CREATE INDEX IF NOT EXISTS idx_wp_vehicle_id ON waypoints(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_wp_arrived_at ON waypoints(arrived_at DESC);
 
 
-- ============================================================
--  8. DAILY_SUMMARIES — Günlük Özet İstatistikler
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_summaries (
    id                  SERIAL          PRIMARY KEY,
    vehicle_id          INT             NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    driver_id           INT             REFERENCES drivers(id),
    summary_date        DATE            NOT NULL,
 
    avg_speed_kmh       NUMERIC(7,2),
    max_speed_kmh       NUMERIC(7,2),
    total_distance_km   NUMERIC(10,2),
 
    waypoint_count      INT             NOT NULL DEFAULT 0,
    total_load_kg       NUMERIC(12,2)   NOT NULL DEFAULT 0,
    avg_load_kg         NUMERIC(10,2),
 
    telemetry_count     INT             NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
 
    UNIQUE (vehicle_id, summary_date)
);
 
CREATE INDEX IF NOT EXISTS idx_ds_vehicle_date ON daily_summaries(vehicle_id, summary_date DESC);
CREATE INDEX IF NOT EXISTS idx_ds_date         ON daily_summaries(summary_date DESC);

-- ============================================================
--  9. FONKSİYONLAR
-- ============================================================
CREATE OR REPLACE FUNCTION get_active_driver(p_vehicle_id INT)
RETURNS INT AS $$
DECLARE
    v_driver_id INT;
BEGIN
    SELECT driver_id INTO v_driver_id
    FROM vehicle_assignments
    WHERE vehicle_id = p_vehicle_id
      AND (released_date IS NULL OR released_date >= CURRENT_DATE)
    ORDER BY assigned_date DESC
    LIMIT 1;
    
    RETURN v_driver_id;
END;
$$ LANGUAGE plpgsql;
