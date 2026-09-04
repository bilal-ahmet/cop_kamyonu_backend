const pool = require('../db');

/**
 * "Bu istek hangi kullanıcı adına yapılıyor" sorusunu cevaplar.
 *
 * Normal kullanıcı için cevap her zaman kendisidir. Admin ise bir müşterinin
 * hesabına girip onun adına kayıt açabilir; hedef kullanıcı sırasıyla
 * `X-Acting-User-Id` başlığından, `?user_id=` sorgusundan veya gövdedeki
 * `user_id` alanından okunur. Hedef verilmezse admin kendi adına işlem yapar.
 *
 *   req.isAdmin      → rol admin mi (erişim kontrollerinde sahiplik filtresi düşer)
 *   req.actingUserId → yeni kayıtların sahibi olacak kullanıcı
 *   req.scopeUserId  → liste sorgularının sahiplik filtresi; admin hedef
 *                      seçmediyse null olur ve "tüm kullanıcılar" demektir
 *
 * authMiddleware'den SONRA takılmalıdır (req.user'a ihtiyaç duyar).
 */
const actingUser = async (req, res, next) => {
    try {
        req.isAdmin = req.user?.role === 'admin';

        if (!req.isAdmin) {
            req.actingUserId = req.user.id;
            req.scopeUserId = req.user.id;
            return next();
        }

        const raw = req.get('x-acting-user-id') ?? req.query.user_id ?? req.body?.user_id;
        if (raw === undefined || raw === null || raw === '') {
            req.actingUserId = req.user.id;
            req.scopeUserId = null;
            return next();
        }

        const targetId = parseInt(raw, 10);
        if (!Number.isInteger(targetId) || targetId <= 0)
            return res.status(400).json({ error: 'Geçersiz user_id' });

        const target = await pool.query('SELECT id FROM users WHERE id = $1', [targetId]);
        if (target.rowCount === 0)
            return res.status(404).json({ error: 'Hedef kullanıcı bulunamadı' });

        req.actingUserId = targetId;
        req.scopeUserId = targetId;
        next();
    } catch (err) {
        console.error('actingUser hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = actingUser;
