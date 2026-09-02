const pool = require('../db');

/**
 * Bildirimler alıcı başına ayrı satır olarak yazıldığı için her sorgu
 * `user_id = req.user.id` ile filtrelenir; ayrı bir sahiplik middleware'i gerekmez.
 * Admin de kendi satırlarını görür (ilgilendiği araçların bildirimleri ona da yazılır).
 */

exports.getNotifications = async (req, res) => {
  try {
    const { type, cause, unread_only } = req.query;

    let limit = parseInt(req.query.limit) || 50;
    if (limit < 1) limit = 1;
    if (limit > 200) limit = 200;
    let offset = parseInt(req.query.offset) || 0;
    if (offset < 0) offset = 0;

    const conditions = ['n.user_id = $1'];
    const values = [req.user.id];
    let idx = 2;

    if (unread_only === 'true') conditions.push('n.is_read = FALSE');
    if (type) { conditions.push(`n.type = $${idx++}`); values.push(type); }
    if (cause) { conditions.push(`n.probable_cause = $${idx++}`); values.push(cause); }
    if (req.query.vehicle_id) {
      conditions.push(`n.vehicle_id = $${idx++}`);
      values.push(parseInt(req.query.vehicle_id));
    }

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT n.*, v.plate
       FROM notifications n
       LEFT JOIN vehicles v ON v.id = n.vehicle_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY n.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      values
    );
    res.json(result.rows);
  } catch (error) {
    console.error('getNotifications Error:', error.code, error.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

/** Zil rozeti için ucuz sorgu — kısmi index (idx_notif_user_unread) üzerinden çalışır. */
exports.getUnreadCount = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id]
    );
    res.json({ count: result.rows[0].count });
  } catch (error) {
    console.error('getUnreadCount Error:', error.code, error.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.markRead = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz bildirim id' });

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE, read_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Bildirim bulunamadı' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('markRead Error:', error.code, error.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE, read_at = NOW()
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ updated: result.rowCount });
  } catch (error) {
    console.error('markAllRead Error:', error.code, error.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz bildirim id' });

    const result = await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Bildirim bulunamadı' });
    res.json({ message: 'Bildirim silindi' });
  } catch (error) {
    console.error('deleteNotification Error:', error.code, error.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
