const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./telegram.db');

// Инициализация таблиц
db.serialize(() => {
  // Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    displayName TEXT NOT NULL,
    avatar TEXT,
    lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP,
    isOnline BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Чаты (личные и групповые)
  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT CHECK(type IN ('private', 'group')) NOT NULL,
    name TEXT,
    avatar TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  // Участники чатов
  db.run(`CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER,
    user_id INTEGER,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_read_message_id INTEGER,
    PRIMARY KEY (chat_id, user_id),
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Сообщения
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT CHECK(type IN ('text', 'image', 'voice')) DEFAULT 'text',
    content TEXT,
    file_url TEXT,
    reply_to_id INTEGER,
    is_edited BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (reply_to_id) REFERENCES messages(id)
  )`);

  // Статусы прочтения
  db.run(`CREATE TABLE IF NOT EXISTS message_reads (
    message_id INTEGER,
    user_id INTEGER,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES messages(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

module.exports = db;
