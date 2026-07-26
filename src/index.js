const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./db');
const cache = require('./cache/sensorCache');
const authRoutes = require('./routes/auth');
const telemetryRoutes = require('./routes/telemetry');
const vehicleRoutes = require('./routes/vehicles');
const adminRoutes = require('./routes/admin');
const driverRoutes = require('./routes/drivers');
const sensorRoutes = require('./routes/sensors');
const assignmentRoutes = require('./routes/assignments');
const userRoutes = require('./routes/users');
const stopLocationRoutes = require('./routes/stopLocations');
const { scheduleDailySummary } = require('./cron/dailySummary');

const app = express();
const PORT = process.env.PORT || 3000;
const START_TIME = new Date().toISOString();

app.use(cors());
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    if (req.url.includes('/api/telemetry')) {
      console.log('[TELEMETRY RAW]', buf.toString(encoding || 'utf8').substring(0, 500));
    }
  }
}));

app.use('/api/auth', authRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/sensors', sensorRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stop-locations', stopLocationRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Sunucu çalışıyor! 🚀' });
});

/**
 * Deploy durumu kontrolü (kimlik doğrulama gerektirmez).
 * `features` listesi, çalışan sürümün hangi endpoint'leri desteklediğini söyler;
 * "route var mı yok mu" sorusunu 401 duvarına takılmadan yanıtlar.
 */
app.get('/api/health', async (req, res) => {
  const body = {
    ok: true,
    version: require('../package.json').version,
    startedAt: START_TIME,
    features: [
      'assignments.end',        // POST /api/assignments/:id/end
      'assignments.hardDelete', // DELETE /api/assignments/:id (kalıcı siler)
      'assignments.reopen',     // PUT /api/assignments/:id { released_date: null }
      'stopLocations.kind',     // stop_locations.kind (stop|start|end)
      'stopLocations.hardDelete',
      'sensors.hardDelete',
      'drivers.hardDelete',
      'drivers.reactivate',     // PUT /api/drivers/:id { is_active: true }
      'telemetry.offset',       // GET /api/vehicles/:id/telemetry?offset=
      'waypoints.stopKind',
    ],
  };

  // Şema kontrolü: kodun beklediği migrasyonlar veritabanına uygulanmış mı?
  // Uygulanmadıysa "kind hep Durak görünüyor" gibi sessiz hatalar oluşur.
  try {
    const { rows } = await pool.query(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='stop_locations' AND column_name='kind')              AS has_stop_location_kind,
        EXISTS (SELECT 1 FROM pg_constraint
                WHERE conname='waypoints_stop_location_id_fkey' AND confdeltype='n')   AS waypoint_fk_set_null
    `);
    const migrations = rows[0];
    body.migrations = migrations;
    body.migrationsApplied = Object.values(migrations).every(Boolean);
    if (!body.migrationsApplied) {
      body.hint = 'Eksik migrasyon var. Backend klasöründe "npm run migrate" çalıştırın.';
    }
  } catch (err) {
    body.migrations = { error: err.code || err.message };
    body.migrationsApplied = false;
  }

  res.json(body);
});

const startServer = async () => {
    // 1. Sensör cache'ini DB'den yükle (başlangıçta)
    await cache.loadActiveSensors();

    // 2. Zamanlanmış görevleri (Cron) başlat
    scheduleDailySummary();

    // 3. Sunucuyu dinle
    app.listen(PORT, () => {
      console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
    });
};

startServer();