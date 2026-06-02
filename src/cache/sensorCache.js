const pool = require('../db');

// Map object to store serial_number -> vehicle_id mapping
const activeSensors = new Map();

const loadActiveSensors = async () => {
    try {
        const result = await pool.query('SELECT id, serial_number, vehicle_id FROM sensors WHERE is_active = TRUE');
        activeSensors.clear();
        for (const row of result.rows) {
            activeSensors.set(row.serial_number, { vehicle_id: row.vehicle_id, sensor_id: row.id });
        }
        console.log(`[Cache] Başarıyla ${activeSensors.size} aktif sensör yüklendi.`);
    } catch (error) {
        console.error('[Cache] Sensörler yüklenirken hata oluştu:', error);
    }
};

const getVehicleIdBySensorSN = (serialNumber) => {
    return activeSensors.get(serialNumber);
};

module.exports = {
    loadActiveSensors,
    getVehicleIdBySensorSN
};
