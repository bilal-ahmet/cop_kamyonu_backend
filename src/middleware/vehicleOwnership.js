const pool = require('../db');

const verifyVehicleOwnership = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const vehicleId = parseInt(req.params.id);

    const checkVehicle = await pool.query('SELECT id FROM vehicles WHERE id = $1 AND user_id = $2', [vehicleId, userId]);
    if (checkVehicle.rowCount === 0) {
      return res.status(403).json({ error: 'Bu aracı görüntüleme/işlem yapma yetkiniz yok' });
    }
    
    // Doğrulama başarılıysa sonraki adıma geç
    next();
  } catch (error) {
    console.error('verifyVehicleOwnership Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

module.exports = verifyVehicleOwnership;
