const express = require('express');
const db = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// Получить все чаты пользователя
router.get('/', auth, (req, res) => {
  const query = `
    SELECT 
      c.*,
      (SELECT content FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as lastMessage,
      (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as lastMessageTime,
      (SELECT COUNT(*) FROM messages m 
       WHERE m.chat_id = c.id 
       AND m.id > COALESCE((SELECT last_read_message_id FROM chat_members WHERE chat_id = c.id AND user_id = ?), 0)
      ) as unreadCount
    FROM chats c
    JOIN chat_members cm ON c.id = cm.chat_id
    WHERE cm.user_id = ?
    ORDER BY lastMessageTime DESC
  `;
  
  db.all(query, [req.userId, req.userId], (err, chats) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(chats);
  });
});

// Создать приватный чат
router.post('/private', auth, (req, res) => {
  const { targetUserId } = req.body;
  
  // Проверяем, существует ли уже чат
  const checkQuery = `
    SELECT c.* FROM chats c
    JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = ?
    JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = ?
    WHERE c.type = 'private'
  `;
  
  db.get(checkQuery, [req.userId, targetUserId], (err, existingChat) => {
    if (existingChat) {
      return res.json(existingChat);
    }
    
    // Создаем новый чат
    db.run('INSERT INTO chats (type) VALUES (?)', ['private'], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      const chatId = this.lastID;
      
      // Добавляем участников
      db.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?), (?, ?)',
        [chatId, req.userId, chatId, targetUserId],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: chatId, type: 'private' });
        }
      );
    });
  });
});

// Создать группу
router.post('/group', auth, (req, res) => {
  const { name, memberIds } = req.body;
  
  db.run('INSERT INTO chats (type, name, created_by) VALUES (?, ?, ?)',
    ['group', name, req.userId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      const chatId = this.lastID;
      const members = [req.userId, ...memberIds];
      const placeholders = members.map(() => '(?, ?)').join(', ');
      const values = members.flatMap(id => [chatId, id]);
      
      db.run(`INSERT INTO chat_members (chat_id, user_id) VALUES ${placeholders}`,
        values,
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: chatId, type: 'group', name });
        }
      );
    }
  );
});

// Получить сообщения чата
router.get('/:chatId/messages', auth, (req, res) => {
  const { chatId } = req.params;
  const { limit = 50, before } = req.query;
  
  let query = `
    SELECT m.*, u.username, u.displayName, u.avatar,
           r.content as replyContent, r.user_id as replyUserId
    FROM messages m
    JOIN users u ON m.user_id = u.id
    LEFT JOIN messages r ON m.reply_to_id = r.id
    WHERE m.chat_id = ?
  `;
  
  const params = [chatId];
  
  if (before) {
    query += ' AND m.id < ?';
    params.push(before);
  }
  
  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);
  
  db.all(query, params, (err, messages) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(messages.reverse());
  });
});

module.exports = router;
