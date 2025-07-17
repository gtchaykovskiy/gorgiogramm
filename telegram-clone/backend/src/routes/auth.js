const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Регистрация
router.post('/register', [
  body('username').isLength({ min: 3 }).trim(),
  body('password').isLength({ min: 6 }),
  body('displayName').isLength({ min: 2 }).trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { username, password, displayName } = req.body;
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (username, password, displayName) VALUES (?, ?, ?)',
      [username, hashedPassword, displayName],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
          }
          return res.status(500).json({ error: 'Ошибка сервера' });
        }
        
        const token = jwt.sign({ userId: this.lastID }, JWT_SECRET);
        res.json({ 
          token, 
          user: { id: this.lastID, username, displayName } 
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Вход
router.post('/login', [
  body('username').notEmpty(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  
  const { username, password } = req.body;
  
  db.get(
    'SELECT * FROM users WHERE username = ?',
    [username],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Неверные учетные данные' });
      }
      
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: 'Неверные учетные данные' });
      }
      
      const token = jwt.sign({ userId: user.id }, JWT_SECRET);
      res.json({ 
        token, 
        user: { 
          id: user.id, 
          username: user.username, 
          displayName: user.displayName,
          avatar: user.avatar 
        } 
      });
    }
  );
});

module.exports = router;
