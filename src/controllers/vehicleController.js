const pool = require('../db');

exports.getVehicles = async (req, res) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      const targetUserId = req.query.user_id ? parseInt(req.query.user_id) : null;
      if (targetUserId) {
        result = await pool.query(
          `SELECT v.*, u.username AS owner_username, u.full_name AS owner_full_name
           FROM vehicles v
           JOIN users u ON u.id = v.user_id
           WHERE v.is_active = TRUE AND v.user_id = $1
           ORDER BY v.plate`,
          [targetUserId]
        );
      } else {
        result = await pool.query(
          `SELECT v.*, u.username AS owner_username, u.full_name AS owner_full_name
           FROM vehicles v
           JOIN users u ON u.id = v.user_id
           WHERE v.is_active = TRUE
           ORDER BY u.username, v.plate`
        );
      }
    } else {
      result = await pool.query(
        'SELECT * FROM vehicles WHERE user_id = $1 AND is_active = TRUE ORDER BY plate',
        [req.user.id]
      );
    }
    res.json(result.rows);
  } catch (error) {
    console.error('getVehicles Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.createVehicle = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plate, brand, model, year, vehicle_type, capacity_kg } = req.body;
    if (!plate) return res.status(400).json({ error: 'plate (plaka) zorunludur' });

    if (year !== undefined && (isNaN(year) || year < 1900 || year > 2100))
      return res.status(400).json({ error: 'year 1900-2100 arasında olmalıdır' });
    if (capacity_kg !== undefined && capacity_kg < 0)
      return res.status(400).json({ error: 'capacity_kg negatif olamaz' });

    const dup = await pool.query('SELECT id FROM vehicles WHERE plate = $1', [plate]);
    if (dup.rowCount > 0) return res.status(409).json({ error: 'Bu plaka zaten kayıtlı' });

    const result = await pool.query(
      'INSERT INTO vehicles (user_id, plate, brand, model, year, vehicle_type, capacity_kg) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [userId, plate, brand || null, model || null, year || null, vehicle_type || null, capacity_kg || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createVehicle Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.updateVehicle = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const { plate, brand, model, year, vehicle_type, capacity_kg } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (plate !== undefined) {
      const dup = await pool.query('SELECT id FROM vehicles WHERE plate = $1 AND id != $2', [plate, vehicleId]);
      if (dup.rowCount > 0) return res.status(409).json({ error: 'Bu plaka zaten kayıtlı' });
      fields.push(`plate = $${idx++}`); values.push(plate);
    }
    if (brand !== undefined) { fields.push(`brand = $${idx++}`); values.push(brand); }
    if (model !== undefined) { fields.push(`model = $${idx++}`); values.push(model); }
    if (year !== undefined) {
      if (isNaN(year) || year < 1900 || year > 2100)
        return res.status(400).json({ error: 'year 1900-2100 arasında olmalıdır' });
      fields.push(`year = $${idx++}`); values.push(year);
    }
    if (vehicle_type !== undefined) { fields.push(`vehicle_type = $${idx++}`); values.push(vehicle_type); }
    if (capacity_kg !== undefined) {
      if (capacity_kg < 0) return res.status(400).json({ error: 'capacity_kg negatif olamaz' });
      fields.push(`capacity_kg = $${idx++}`); values.push(capacity_kg);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

    values.push(vehicleId);
    const result = await pool.query(
      `UPDATE vehicles SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('updateVehicle Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.deactivateVehicle = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);

    const activeSensors = await pool.query(
      'SELECT id FROM sensors WHERE vehicle_id = $1 AND is_active = TRUE',
      [vehicleId]
    );
    if (activeSensors.rowCount > 0)
      return res.status(409).json({ error: 'Önce araçtaki aktif sensörleri devre dışı bırakın' });

    await pool.query('UPDATE vehicles SET is_active = FALSE WHERE id = $1', [vehicleId]);
    res.json({ message: 'Araç devre dışı bırakıldı' });
  } catch (error) {
    console.error('deactivateVehicle Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.getVehicleLocation = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const result = await pool.query(
      `SELECT lat, lon, cog_deg, speed_kmh, speed_knots, load_kg, recorded_at, fix_valid
       FROM telemetry WHERE vehicle_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [vehicleId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Konum verisi bulunamadı' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('getVehicleLocation Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.getVehicleSummary = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const result = await pool.query(
      'SELECT * FROM daily_summaries WHERE vehicle_id = $1 AND summary_date = $2',
      [vehicleId, date]
    );
    if (result.rowCount === 0) return res.json({ message: 'Bu tarih için özet bulunamadı' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('getVehicleSummary Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.getVehicleWaypoints = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM waypoints WHERE vehicle_id = $1 ORDER BY arrived_at DESC LIMIT 50',
      [vehicleId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('getVehicleWaypoints Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.getVehicleTelemetry = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const { from, to, fix_valid } = req.query;
    let limit = parseInt(req.query.limit) || 100;
    if (limit < 1) limit = 1;
    if (limit > 1000) limit = 1000;

    const conditions = ['vehicle_id = $1'];
    const values = [vehicleId];
    let idx = 2;

    if (from) { conditions.push(`recorded_at >= $${idx++}`); values.push(from); }
    if (to) { conditions.push(`recorded_at <= $${idx++}`); values.push(to); }
    if (fix_valid !== undefined) { conditions.push(`fix_valid = $${idx++}`); values.push(fix_valid === 'true'); }

    values.push(limit);
    const result = await pool.query(
      `SELECT * FROM telemetry WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC LIMIT $${idx}`,
      values
    );
    res.json(result.rows);
  } catch (error) {
    console.error('getVehicleTelemetry Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.getVehicleSensors = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM sensors WHERE vehicle_id = $1 ORDER BY installed_at DESC',
      [vehicleId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('getVehicleSensors Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.createWaypoint = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const { lat, lon, arrived_at, driver_id, location_name, load_received_kg, load_delivered_kg, departed_at, notes } = req.body;

    if (lat === undefined || lon === undefined || !arrived_at)
      return res.status(400).json({ error: 'lat, lon ve arrived_at zorunludur' });
    if (lat < -90 || lat > 90) return res.status(400).json({ error: 'lat -90 ile 90 arasında olmalıdır' });
    if (lon < -180 || lon > 180) return res.status(400).json({ error: 'lon -180 ile 180 arasında olmalıdır' });

    if (driver_id) {
      const driver = await pool.query('SELECT id FROM drivers WHERE id = $1 AND is_active = TRUE', [driver_id]);
      if (driver.rowCount === 0) return res.status(404).json({ error: 'Sürücü bulunamadı veya pasif' });
    }

    if (departed_at && new Date(departed_at) < new Date(arrived_at))
      return res.status(400).json({ error: 'departed_at, arrived_at tarihinden önce olamaz' });

    const result = await pool.query(
      `INSERT INTO waypoints (vehicle_id, driver_id, location_name, lat, lon, load_received_kg, load_delivered_kg, arrived_at, departed_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [vehicleId, driver_id || null, location_name || null, lat, lon,
       load_received_kg || null, load_delivered_kg || null, arrived_at, departed_at || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('createWaypoint Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.updateWaypoint = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const waypointId = parseInt(req.params.waypointId);

    const exists = await pool.query(
      'SELECT id, arrived_at FROM waypoints WHERE id = $1 AND vehicle_id = $2',
      [waypointId, vehicleId]
    );
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Waypoint bulunamadı' });

    const { lat, lon, arrived_at, driver_id, location_name, load_received_kg, load_delivered_kg, departed_at, notes } = req.body;
    const fields = [];
    const values = [];
    let idx = 1;

    if (lat !== undefined) {
      if (lat < -90 || lat > 90) return res.status(400).json({ error: 'lat -90 ile 90 arasında olmalıdır' });
      fields.push(`lat = $${idx++}`); values.push(lat);
    }
    if (lon !== undefined) {
      if (lon < -180 || lon > 180) return res.status(400).json({ error: 'lon -180 ile 180 arasında olmalıdır' });
      fields.push(`lon = $${idx++}`); values.push(lon);
    }
    if (arrived_at !== undefined) { fields.push(`arrived_at = $${idx++}`); values.push(arrived_at); }
    if (departed_at !== undefined) { fields.push(`departed_at = $${idx++}`); values.push(departed_at); }
    if (driver_id !== undefined) { fields.push(`driver_id = $${idx++}`); values.push(driver_id); }
    if (location_name !== undefined) { fields.push(`location_name = $${idx++}`); values.push(location_name); }
    if (load_received_kg !== undefined) { fields.push(`load_received_kg = $${idx++}`); values.push(load_received_kg); }
    if (load_delivered_kg !== undefined) { fields.push(`load_delivered_kg = $${idx++}`); values.push(load_delivered_kg); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }

    if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

    values.push(waypointId);
    const result = await pool.query(
      `UPDATE waypoints SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('updateWaypoint Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.deleteWaypoint = async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.id);
    const waypointId = parseInt(req.params.waypointId);

    const exists = await pool.query(
      'SELECT id FROM waypoints WHERE id = $1 AND vehicle_id = $2',
      [waypointId, vehicleId]
    );
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Waypoint bulunamadı' });

    await pool.query('DELETE FROM waypoints WHERE id = $1', [waypointId]);
    res.json({ message: 'Waypoint silindi' });
  } catch (error) {
    console.error('deleteWaypoint Error:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
