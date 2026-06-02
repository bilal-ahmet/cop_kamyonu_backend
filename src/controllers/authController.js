const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur' });
        }

        const userResult = await pool.query('SELECT * FROM users WHERE username = $1 AND is_active = TRUE', [username]);
        if (userResult.rowCount === 0) {
            return res.status(401).json({ error: 'Kullanıcı bulunamadı veya pasif' });
        }

        const user = userResult.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: 'Hatalı şifre' });
        }

        // Token oluşturma
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Son giriş zamanı güncelleme
        await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

        res.json({
            message: 'Giriş başarılı',
            token,
            user: { id: user.id, username: user.username, full_name: user.full_name }
        });
    } catch (error) {
        console.error('[Auth Error]', error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};
