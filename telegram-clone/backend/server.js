const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const fs = require('fs');

// Создаем необходимые директории
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');

[uploadsDir, dataDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

// Настройки
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// База данных
const db = new sqlite3.Database(path.join(dataDir, 'georgiogramm.db'));

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Инициализация БД
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        displayName TEXT NOT NULL,
        avatar TEXT,
        lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP,
        isOnline BOOLEAN DEFAULT 0,
        theme TEXT DEFAULT 'light',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT CHECK(type IN ('private', 'group')) NOT NULL,
        name TEXT,
        avatar TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS chat_members (
        chat_id INTEGER,
        user_id INTEGER,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_read_message_id INTEGER DEFAULT 0,
        PRIMARY KEY (chat_id, user_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        type TEXT CHECK(type IN ('text', 'image', 'voice')) DEFAULT 'text',
        content TEXT,
        file_url TEXT,
        reply_to_id INTEGER,
        is_edited BOOLEAN DEFAULT 0,
        is_deleted BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chats(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (reply_to_id) REFERENCES messages(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INTEGER,
        user_id INTEGER,
        reaction TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id, reaction),
        FOREIGN KEY (message_id) REFERENCES messages(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Добавляем общий чат, если его нет
    db.get('SELECT id FROM chats WHERE type = "group" AND name = "Общий чат"', (err, row) => {
        if (!row) {
            db.run('INSERT INTO chats (type, name) VALUES ("group", "Общий чат")', function(err) {
                if (!err) {
                    console.log('Создан общий чат с ID:', this.lastID);
                }
            });
        }
    });
});

// Middleware для проверки токена
const authMiddleware = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Неверный токен' });
    }
};

// ===== AUTH ROUTES =====

// Регистрация
app.post('/api/auth/register', [
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
                
                const userId = this.lastID;
                
                // Добавляем пользователя в общий чат
                db.run(
                    'INSERT INTO chat_members (chat_id, user_id) SELECT id, ? FROM chats WHERE name = "Общий чат"',
                    [userId],
                    (err) => {
                        if (err) console.error('Ошибка добавления в общий чат:', err);
                    }
                );
                
                const token = jwt.sign({ userId }, JWT_SECRET);
                res.json({ 
                    token, 
                    user: { id: userId, username, displayName, theme: 'light' } 
                });
            }
        );
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/auth/login', [
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
                    avatar: user.avatar,
                    theme: user.theme || 'light'
                } 
            });
        }
    );
});

// Проверка токена
app.get('/api/auth/me', authMiddleware, (req, res) => {
    db.get(
        'SELECT id, username, displayName, avatar, theme FROM users WHERE id = ?',
        [req.userId],
        (err, user) => {
            if (err || !user) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }
            res.json(user);
        }
    );
});

// ===== USER ROUTES =====

// Получить всех пользователей
app.get('/api/users', authMiddleware, (req, res) => {
    db.all(
        'SELECT id, username, displayName, avatar, isOnline FROM users WHERE id != ?',
        [req.userId],
        (err, users) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(users);
        }
    );
});

// Обновить профиль пользователя
app.put('/api/users/profile', authMiddleware, upload.single('avatar'), async (req, res) => {
    const { displayName, theme } = req.body;
    const updates = [];
    const params = [];
    
    if (displayName) {
        updates.push('displayName = ?');
        params.push(displayName);
    }
    
    if (req.file) {
        updates.push('avatar = ?');
        params.push(`/uploads/${req.file.filename}`);
    }
    
    if (theme) {
        updates.push('theme = ?');
        params.push(theme);
    }
    
    if (updates.length === 0) {
        return res.status(400).json({ error: 'Нет данных для обновления' });
    }
    
    params.push(req.userId);
    
    db.run(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        params,
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            db.get(
                'SELECT id, username, displayName, avatar, theme FROM users WHERE id = ?',
                [req.userId],
                (err, user) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json(user);
                }
            );
        }
    );
});

// ===== CHAT ROUTES =====

// Получить чаты пользователя
app.get('/api/chats', authMiddleware, (req, res) => {
    const query = `
        SELECT 
            c.*,
            CASE 
                WHEN c.type = 'private' THEN (
                    SELECT u.displayName 
                    FROM chat_members cm2 
                    JOIN users u ON cm2.user_id = u.id 
                    WHERE cm2.chat_id = c.id AND cm2.user_id != ?
                )
                ELSE c.name
            END as name,
            CASE 
                WHEN c.type = 'private' THEN (
                    SELECT u.avatar 
                    FROM chat_members cm2 
                    JOIN users u ON cm2.user_id = u.id 
                    WHERE cm2.chat_id = c.id AND cm2.user_id != ?
                )
                ELSE c.avatar
            END as avatar,
            (SELECT content FROM messages WHERE chat_id = c.id AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1) as lastMessage,
            (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as lastMessageTime,
            (SELECT COUNT(*) FROM messages m 
             WHERE m.chat_id = c.id 
             AND m.id > COALESCE((SELECT last_read_message_id FROM chat_members WHERE chat_id = c.id AND user_id = ?), 0)
             AND m.user_id != ?
            ) as unreadCount
        FROM chats c
        JOIN chat_members cm ON c.id = cm.chat_id
        WHERE cm.user_id = ?
        ORDER BY lastMessageTime DESC
    `;
    
    db.all(query, [req.userId, req.userId, req.userId, req.userId, req.userId], (err, chats) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(chats);
    });
});

// Создать приватный чат
app.post('/api/chats/private', authMiddleware, (req, res) => {
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

// Получить сообщения чата
app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;
    
    let query = `
        SELECT m.*, u.username, u.displayName, u.avatar
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.chat_id = ?
    `;
    
    const params = [chatId];
    
    if (before) {
        query += ' AND m.id < ?';
        params.push(before);
    }
    
    query += ' ORDER BY m.created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    db.all(query, params, (err, messages) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Получаем реакции для каждого сообщения
        const messageIds = messages.map(m => m.id);
        if (messageIds.length === 0) {
            return res.json([]);
        }
        
        const reactionsQuery = `
            SELECT message_id, reaction, COUNT(*) as count, GROUP_CONCAT(user_id) as users
            FROM message_reactions 
            WHERE message_id IN (${messageIds.map(() => '?').join(',')})
            GROUP BY message_id, reaction
        `;
        
        db.all(reactionsQuery, messageIds, (err, reactions) => {
            if (err) {
                console.error('Reactions query error:', err);
                return res.json(messages.reverse().map(msg => ({...msg, reactions: {}})));
            }
            
            // Группируем реакции по сообщениям
            const reactionsMap = {};
            reactions.forEach(r => {
                if (!reactionsMap[r.message_id]) {
                    reactionsMap[r.message_id] = {};
                }
                reactionsMap[r.message_id][r.reaction] = {
                    count: r.count,
                    users: r.users ? r.users.split(',').map(id => parseInt(id)) : []
                };
            });
            
            // Добавляем реакции к сообщениям
            const messagesWithReactions = messages.map(msg => ({
                ...msg,
                reactions: reactionsMap[msg.id] || {}
            }));
            
            res.json(messagesWithReactions.reverse());
        });
    });
});

// Отметить сообщения как прочитанные
app.post('/api/chats/:chatId/read', authMiddleware, (req, res) => {
    const { chatId } = req.params;
    const { messageId } = req.body;
    
    db.run(
        'UPDATE chat_members SET last_read_message_id = ? WHERE chat_id = ? AND user_id = ?',
        [messageId, chatId, req.userId],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ===== MESSAGE ROUTES =====

// Удалить сообщение
app.delete('/api/messages/:messageId', authMiddleware, (req, res) => {
    const { messageId } = req.params;
    
    db.get(
        'SELECT * FROM messages WHERE id = ? AND user_id = ?',
        [messageId, req.userId],
        (err, message) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!message) return res.status(403).json({ error: 'Нет доступа' });
            
            db.run(
                'UPDATE messages SET content = ?, is_deleted = 1 WHERE id = ?',
                ['Сообщение удалено', messageId],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    io.to(`chat_${message.chat_id}`).emit('message_deleted', {
                        messageId,
                        chatId: message.chat_id
                    });
                    
                    res.json({ success: true });
                }
            );
        }
    );
});

// Редактировать сообщение
app.put('/api/messages/:messageId', authMiddleware, (req, res) => {
    const { messageId } = req.params;
    const { content } = req.body;
    
    if (!content) {
        return res.status(400).json({ error: 'Контент обязателен' });
    }
    
    db.get(
        'SELECT * FROM messages WHERE id = ? AND user_id = ?',
        [messageId, req.userId],
        (err, message) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!message) return res.status(403).json({ error: 'Нет доступа' });
            
            db.run(
                'UPDATE messages SET content = ?, is_edited = 1 WHERE id = ?',
                [content, messageId],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    db.get(
                        `SELECT m.*, u.username, u.displayName, u.avatar
                         FROM messages m
                         JOIN users u ON m.user_id = u.id
                         WHERE m.id = ?`,
                        [messageId],
                        (err, updatedMessage) => {
                            if (err) return res.status(500).json({ error: err.message });
                            
                            io.to(`chat_${message.chat_id}`).emit('message_edited', {
                                chatId: message.chat_id,
                                message: updatedMessage
                            });
                            
                            res.json(updatedMessage);
                        }
                    );
                }
            );
        }
    );
});

// Добавить реакцию
app.post('/api/messages/:messageId/reactions', authMiddleware, (req, res) => {
    const { messageId } = req.params;
    const { reaction } = req.body;
    
    db.get(
        'SELECT * FROM message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?',
        [messageId, req.userId, reaction],
        (err, existing) => {
            if (existing) {
                // Удаляем реакцию
                db.run(
                    'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?',
                    [messageId, req.userId, reaction],
                    (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        emitReactionUpdate(messageId);
                        res.json({ removed: true });
                    }
                );
            } else {
                // Добавляем реакцию
                db.run(
                    'INSERT INTO message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)',
                    [messageId, req.userId, reaction],
                    (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        emitReactionUpdate(messageId);
                        res.json({ added: true });
                    }
                );
            }
        }
    );
});

// Функция для отправки обновлений реакций
function emitReactionUpdate(messageId) {
    db.get(
        'SELECT chat_id FROM messages WHERE id = ?',
        [messageId],
        (err, message) => {
            if (err || !message) return;
            
            db.all(
                `SELECT reaction, COUNT(*) as count, GROUP_CONCAT(user_id) as users
                 FROM message_reactions 
                 WHERE message_id = ? 
                 GROUP BY reaction`,
                [messageId],
                (err, reactions) => {
                    if (err) return;
                    
                    io.to(`chat_${message.chat_id}`).emit('reactions_updated', {
                        messageId,
                        reactions
                    });
                }
            );
        }
    );
}

// Загрузка файлов
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    res.json({
        url: `/uploads/${req.file.filename}`,
        type: req.file.mimetype.startsWith('image/') ? 'image' : 'voice'
    });
});

// ===== SOCKET.IO =====
const userSockets = new Map();

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
        return next(new Error('No token provided'));
    }
    
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
    
    // Получаем имя пользователя
    db.get('SELECT displayName FROM users WHERE id = ?', [socket.userId], (err, user) => {
        if (!err && user) {
            socket.displayName = user.displayName;
        }
    });
    
    // Добавляем сокет
    if (!userSockets.has(socket.userId)) {
        userSockets.set(socket.userId, new Set());
    }
    userSockets.get(socket.userId).add(socket.id);
    
    // Обновляем статус
    db.run('UPDATE users SET isOnline = 1, lastSeen = CURRENT_TIMESTAMP WHERE id = ?', 
        [socket.userId]);
    
    // Подключаем к чатам
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
    
    // Отправка сообщения
    socket.on('send_message', (data) => {
        const { chatId, content, type = 'text', file_url, replyToId } = data;
        
        // Если нет chatId, используем общий чат
        if (!chatId || chatId === 'general') {
            // Находим ID общего чата
            db.get('SELECT id FROM chats WHERE name = "Общий чат"', (err, generalChat) => {
                if (err || !generalChat) {
                    return socket.emit('error', 'Общий чат не найден');
                }
                
                const generalChatId = generalChat.id;
                
                // Сохраняем сообщение в БД
                db.run(
                    'INSERT INTO messages (chat_id, user_id, content, type, file_url, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)',
                    [generalChatId, socket.userId, content, type, file_url, replyToId],
                    function(err) {
                        if (err) {
                            console.error('Message insert error:', err);
                            return socket.emit('error', 'Ошибка отправки сообщения');
                        }
                        
                        const messageId = this.lastID;
                        
                        // Создаем сообщение для отправки
                        const message = {
                            id: messageId,
                            user_id: socket.userId,
                            displayName: socket.displayName || 'Пользователь',
                            content,
                            type,
                            file_url,
                            created_at: new Date().toISOString(),
                            reactions: {}
                        };
                        
                        // Отправляем всем участникам общего чата
                        io.to(`chat_${generalChatId}`).emit('new_message', {
                            chatId: generalChatId,
                            message
                        });
                    }
                );
            });
            
            return;
        }
        
        // Приватные чаты
        db.get(
            'SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?',
            [chatId, socket.userId],
            (err, member) => {
                if (err || !member) {
                    return socket.emit('error', 'Нет доступа к чату');
                }
                
                db.run(
                    'INSERT INTO messages (chat_id, user_id, content, type, file_url, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)',
                    [chatId, socket.userId, content, type, file_url, replyToId],
                    function(err) {
                        if (err) {
                            console.error('Message insert error:', err);
                            return socket.emit('error', 'Ошибка отправки сообщения');
                        }
                        
                        const messageId = this.lastID;
                        
                        db.get(
                            `SELECT m.*, u.username, u.displayName, u.avatar
                             FROM messages m
                             JOIN users u ON m.user_id = u.id
                             WHERE m.id = ?`,
                            [messageId],
                            (err, message) => {
                                if (!err && message) {
                                    message.reactions = {};
                                    
                                    io.to(`chat_${chatId}`).emit('new_message', {
                                        chatId,
                                        message
                                    });
                                }
                            }
                        );
                    }
                );
            }
        );
    });
    
    // Печатает
    socket.on('typing', ({ chatId, isTyping }) => {
        socket.to(`chat_${chatId}`).emit('user_typing', {
            chatId,
            userId: socket.userId,
            username: socket.displayName,
            isTyping
        });
    });
    
    // Отметка о прочтении
    socket.on('mark_read', ({ chatId, messageId }) => {
        db.run(
            'UPDATE chat_members SET last_read_message_id = ? WHERE chat_id = ? AND user_id = ?',
            [messageId, chatId, socket.userId],
            (err) => {
                if (!err) {
                    // Уведомляем других участников
                    socket.to(`chat_${chatId}`).emit('messages_read', {
                        chatId,
                        userId: socket.userId,
                        messageId
                    });
                }
            }
        );
    });
    
    // Отключение
    socket.on('disconnect', () => {
        const userSocketSet = userSockets.get(socket.userId);
        if (userSocketSet) {
            userSocketSet.delete(socket.id);
            
            if (userSocketSet.size === 0) {
                userSockets.delete(socket.userId);
                db.run(
                    'UPDATE users SET isOnline = 0, lastSeen = CURRENT_TIMESTAMP WHERE id = ?',
                    [socket.userId]
                );
            }
        }
    });
});

// Тестовый роут
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', app: 'Georgiogramm' });
});

server.listen(PORT, () => {
    console.log(`Georgiogramm server running on port ${PORT}`);
});
