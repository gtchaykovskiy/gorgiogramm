const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const userSockets = new Map(); // userId -> Set of socket ids

module.exports = (io) => {
  // Middleware для аутентификации сокетов
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });
  
  io.on('connection', (socket) => {
    console.log('User connected:', socket.userId);
    
    // Добавляем сокет в map
    if (!userSockets.has(socket.userId)) {
      userSockets.set(socket.userId, new Set());
    }
    userSockets.get(socket.userId).add(socket.id);
    
    // Обновляем статус онлайн
    db.run('UPDATE users SET isOnline = 1, lastSeen = CURRENT_TIMESTAMP WHERE id = ?', 
      [socket.userId]);
    
    // Подключаем к чатам пользователя
    db.all(
      'SELECT chat_id FROM chat_members WHERE user_id = ?',
      [socket.userId],
      (err, chats) => {
        if (!err) {
          chats.forEach(chat => {
            socket.join(`chat_${chat.chat_id}`);
          });
        }
      }
    );
    
    // Обработка отправки сообщения
    socket.on('send_message', (data) => {
      const { chatId, content, type = 'text', replyToId } = data;
      
      // Проверяем, что пользователь участник чата
      db.get(
        'SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?',
        [chatId, socket.userId],
        (err, member) => {
          if (err || !member) {
            return socket.emit('error', 'Нет доступа к чату');
          }
          
          // Сохраняем сообщение
          db.run(
            'INSERT INTO messages (chat_id, user_id, content, type, reply_to_id) VALUES (?, ?, ?, ?, ?)',
            [chatId, socket.userId, content, type, replyToId],
            function(err) {
              if (err) {
                return socket.emit('error', 'Ошибка отправки сообщения');
              }
              
              const messageId = this.lastID;
              
              // Получаем полную информацию о сообщении
              db.get(
                `SELECT m.*, u.username, u.displayName, u.avatar
                 FROM messages m
                 JOIN users u ON m.user_id = u.id
                 WHERE m.id = ?`,
                [messageId],
                (err, message) => {
                  if (!err && message) {
                    // Отправляем всем участникам чата
                    io.to(`chat_${chatId}`).emit('new_message', {
                      chatId,
                      message
                    });
                    
                    // Отправляем уведомления offline пользователям
                    notifyOfflineUsers(chatId, socket.userId, message);
                  }
                }
              );
            }
          );
        }
      );
    });
    
    // Индикатор набора текста
    socket.on('typing', ({ chatId, isTyping }) => {
      socket.to(`chat_${chatId}`).emit('user_typing', {
        chatId,
        userId: socket.userId,
        isTyping
      });
    });
    
    // Отметка о прочтении
    socket.on('mark_read', ({ chatId, messageId }) => {
      db.run(
        'UPDATE chat_members SET last_read_message_id = ? WHERE chat_id = ? AND user_id = ?',
        [messageId, chatId, socket.userId]
      );
      
      // Уведомляем отправителя о прочтении
      db.get(
        'SELECT user_id FROM messages WHERE id = ?',
        [messageId],
        (err, message) => {
          if (!err && message) {
            const senderSockets = userSockets.get(message.user_id);
            if (senderSockets) {
              senderSockets.forEach(socketId => {
                io.to(socketId).emit('message_read', {
                  messageId,
                  userId: socket.userId
                });
              });
            }
          }
        }
      );
    });
    
    // Отключение
    socket.on('disconnect', () => {
      const userSocketSet = userSockets.get(socket.userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        
        // Если это был последний сокет пользователя
        if (userSocketSet.size === 0) {
          userSockets.delete(socket.userId);
          
          // Обновляем статус offline
          db.run(
            'UPDATE users SET isOnline = 0, lastSeen = CURRENT_TIMESTAMP WHERE id = ?',
            [socket.userId]
          );
          
          // Уведомляем контакты
          notifyUserStatusChange(socket.userId, false);
        }
      }
    });
  });
  
  // Вспомогательные функции
  function notifyOfflineUsers(chatId, senderId, message) {
    db.all(
      `SELECT cm.user_id FROM chat_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.chat_id = ? AND cm.user_id != ? AND u.isOnline = 0`,
      [chatId, senderId],
      (err, users) => {
        if (!err) {
          users.forEach(user => {
            // Здесь можно отправить push-уведомление
            console.log(`Notify offline user ${user.user_id} about new message`);
          });
        }
      }
    );
  }
  
  function notifyUserStatusChange(userId, isOnline) {
    // Получаем всех контактов пользователя
    db.all(
      `SELECT DISTINCT cm2.user_id 
       FROM chat_members cm1
       JOIN chat_members cm2 ON cm1.chat_id = cm2.chat_id
       WHERE cm1.user_id = ? AND cm2.user_id != ?`,
      [userId, userId],
      (err, contacts) => {
        if (!err) {
          contacts.forEach(contact => {
            const contactSockets = userSockets.get(contact.user_id);
            if (contactSockets) {
              contactSockets.forEach(socketId => {
                io.to(socketId).emit('user_status_change', {
                  userId,
                  isOnline
                });
              });
            }
          });
        }
      }
    );
  }
};
