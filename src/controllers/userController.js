const pool = require('../db');
const bcrypt = require('bcrypt');

const getMe = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, email, full_name, is_active, created_at, last_login FROM users WHERE id = $1',
            [req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('getMe hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const updateMe = async (req, res) => {
    try {
        const { email, full_name, password } = req.body;
        const fields = [];
        const values = [];
        let idx = 1;

        if (email !== undefined) {
            const dup = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
            if (dup.rowCount > 0) return res.status(409).json({ error: 'Bu e-posta zaten kullanımda' });
            fields.push(`email = $${idx++}`); values.push(email);
        }
        if (full_name !== undefined) { fields.push(`full_name = $${idx++}`); values.push(full_name); }
        if (password !== undefined) {
            const hash = await bcrypt.hash(password, 10);
            fields.push(`password_hash = $${idx++}`); values.push(hash);
        }

        if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });

        values.push(req.user.id);
        const result = await pool.query(
            `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, username, email, full_name, is_active, created_at, last_login`,
            values
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateMe hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const getUsers = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, email, full_name, is_active, created_at, last_login FROM users ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('getUsers hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

const createUser = async (req, res) => {
    try {
        const { username, email, password, full_name } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ error: 'username, email ve password zorunludur' });

        const dupUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (dupUser.rowCount > 0) return res.status(409).json({ error: 'Bu kullanıcı adı zaten kullanımda' });

        const dupEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (dupEmail.rowCount > 0) return res.status(409).json({ error: 'Bu e-posta zaten kullanımda' });

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash, full_name) VALUES ($1, $2, $3, $4) RETURNING id, username, email, full_name, is_active, created_at',
            [username, email, hash, full_name || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createUser hatası:', err);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
};

module.exports = { getMe, updateMe, getUsers, createUser };
