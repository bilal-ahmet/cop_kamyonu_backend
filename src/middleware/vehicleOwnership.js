const pool = require('../db');

const verifyVehicleOwnership = async (req, res, next) => {
  try {
    // Admin tüm araçlara erişebilir
    if (req.user.role === 'admin') return next();

    const userId = req.user.id;
    const vehicleId = parseInt(req.params.id);

    const checkVehicle = await pool.query('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, userId]);
    if (checkVehicle.rowCount === 0) {
      return res.status(403).json({ error: 'Bu aracı görüntüleme/işlem yapma yetkiniz yok' });
    }

    next();
  } catch (error) {
    console.error('verifyVehicleOwnership Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

module.exports = verifyVehicleOwnership;
