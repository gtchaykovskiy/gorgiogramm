// Главный файл приложения
let socket = null;
let currentUser = null;
let currentChatId = null;
let chats = new Map();
let messages = new Map();

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    
    if (token) {
        // Пытаемся восстановить сессию
        initializeApp(token);
    } else {
        showAuthScreen();
    }
    
    // Инициализация UI обработчиков
    initializeUIHandlers();
});

async function initializeApp(token) {
    try {
        // Проверяем токен
        const response = await fetch('http://localhost:3000/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) throw new Error('Invalid token');
        
        currentUser = await response.json();
        window.currentUser = currentUser;
        
        // Подключаемся к сокету
        connectSocket(token);
        
        // Загружаем чаты
        await loadChats();
        
        // Показываем главный экран
        showMainScreen();
        
        // Запрашиваем разрешение на уведомления
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        localStorage.removeItem('token');
        showAuthScreen();
    }
}

function connectSocket(token) {
    socket = io('http://localhost:3000', {
        auth: { token }
    });
    
    window.socket = socket;
    
    // Обработчики событий сокета
    socket.on('new_message', handleNewMessage);
    socket.on('user_typing', handleUserTyping);
    socket.on('user_status_change', handleUserStatusChange);
    socket.on('message_read', handleMessageRead);
    
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
    });
    
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
}

async function loadChats() {
    try {
        const response = await fetch('http://localhost:3000/api/chats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const chatsList = await response.json();
        
        chats.clear();
        chatsList.forEach(chat => {
            chats.set(chat.id, chat);
        });
        
        renderChatsList();
        
    } catch (error) {
        console.error('Failed to load chats:', error);
    }
}

function handleNewMessage(data) {
    const { chatId, message } = data;
    
    // Добавляем сообщение в кеш
    if (!messages.has(chatId)) {
        messages.set(chatId, []);
    }
    messages.get(chatId).push(message);
    
    // Обновляем UI
    if (currentChatId === chatId) {
        renderMessage(message);
        markAsRead(message.id);
    } else {
        // Обновляем счетчик непрочитанных
        const chat = chats.get(chatId);
        if (chat) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
            renderChatsList();
        }
        
        // Показываем уведомление
        if (message.user_id !== currentUser.id) {
            showNotification(message);
        }
    }
    
    // Обновляем последнее сообщение в списке чатов
    const chat = chats.get(chatId);
    if (chat) {
        chat.lastMessage = message.content;
        chat.lastMessageTime = message.created_at;
        renderChatsList();
    }
}

function showNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(message.displayName || 'Новое сообщение', {
            body: message.content,
            icon: message.avatar || '/assets/default-avatar.png',
            tag: `message-${message.id}`
        });
        
        notification.onclick = () => {
            window.focus();
            openChat(message.chat_id);
            notification.close();
        };
        
        setTimeout(() => notification.close(), 5000);
    }
}

function handleUserTyping(data) {
    // Реализовано в chat.js
    if (window.handleUserTypingInChat) {
        window.handleUserTypingInChat(data);
    }
}

function handleUserStatusChange(data) {
    // Обновляем статус пользователя в UI
    console.log('User status changed:', data);
}

function handleMessageRead(data) {
    // Обновляем статус прочтения
    console.log('Message read:', data);
}

// Экспорт функций для использования в других модулях
window.app = {
    socket,
    currentUser,
    currentChatId,
    chats,
    messages,
    loadChats,
    openChat: (chatId) => {
        currentChatId = chatId;
        window.currentChatId = chatId;
        loadChatMessages(chatId);
    }
};
