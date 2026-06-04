const express = require('express');
const cors = require('cors');
require('dotenv').config();

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