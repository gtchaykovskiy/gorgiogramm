const API_BASE = window.location.origin; // Вместо протокол + хост
// Глобальные переменные
let socket = null;
let currentUser = null;
let currentChatId = null;
let chats = new Map();
let messages = new Map();
let currentTheme = 'light';
let editingMessageId = null;

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('App starting...');
    
    // Загружаем тему
    currentTheme = localStorage.getItem('theme') || 'light';
    document.body.setAttribute('data-theme', currentTheme);
    
    // Проверяем токен
    const token = localStorage.getItem('token');
    if (token) {
        initializeApp(token);
    } else {
        showAuthScreen();
    }
    
    // Обработчики
    setupAuthHandlers();
    setupUIHandlers();
});

function setupAuthHandlers() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const authError = document.getElementById('auth-error');
    
    // Переключение вкладок
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelector('.tab-btn.active').classList.remove('active');
            btn.classList.add('active');
            document.querySelector('.auth-form.active').classList.remove('active');
            document.getElementById(`${tab}-form`).classList.add('active');
            authError.textContent = '';
        });
    });
    
    // Вход
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData);
        
        console.log('Attempting login...'); // Для отладки
        
        try {
            const response = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(data),
                credentials: 'same-origin' // Важно для мобильных
            });
            
            console.log('Login response status:', response.status); // Отладка
            
            const result = await response.json();
            console.log('Login result:', result); // Отладка
            
            if (!response.ok) {
                throw new Error(result.error || 'Ошибка входа');
            }
            
            // Сохраняем токен
            localStorage.setItem('token', result.token);
            currentUser = result.user;
            window.currentUser = currentUser;
            
            console.log('Login successful, showing main screen...'); // Отладка
            
            // Показываем главный экран
            showMainScreen();
            
            // Инициализируем приложение
            await initializeApp(result.token);
            
        } catch (error) {
            console.error('Login error:', error); // Отладка
            authError.textContent = error.message;
        }
    });
        
    // Регистрация
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(registerForm);
        const data = Object.fromEntries(formData);
        
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Ошибка регистрации');
            
            localStorage.setItem('token', result.token);
            currentUser = result.user;
            window.currentUser = currentUser;
            
            showMainScreen();
            initializeApp(result.token);
            
        } catch (error) {
            authError.textContent = error.message;
        }
    });
}

// ===== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====
async function initializeApp(token) {
    try {
        // Проверяем токен
        const response = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Invalid token');
        
        currentUser = await response.json();
        window.currentUser = currentUser;
        
        // Применяем тему пользователя
        if (currentUser.theme) {
            currentTheme = currentUser.theme;
            document.body.setAttribute('data-theme', currentTheme);
            localStorage.setItem('theme', currentTheme);
        }
        
        console.log('User loaded:', currentUser);
        
        // Подключаемся к сокету
        connectSocket(token);
        
        // Загружаем чаты
        await loadChats();
        
        // Показываем главный экран
        showMainScreen();
        
        // Обновляем UI
        updateUserInterface();
        
    } catch (error) {
        console.error('Failed to initialize:', error);
        localStorage.removeItem('token');
        showAuthScreen();
    }
}

function connectSocket(token) {
    // Определяем базовый URL для сокетов
    const socketURL = window.location.origin;
    
    socket = io(socketURL, {
        auth: { token },
        transports: ['websocket', 'polling'], // Важно для мобильных
        upgrade: true,
        rememberUpgrade: true,
        timeout: 20000,
        forceNew: true
    });
    
    window.socket = socket;
    
    socket.on('connect', () => {
        console.log('Socket connected');
    });
    
    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        // Fallback на polling
        socket.io.opts.transports = ['polling'];
    });
    
    socket.on('disconnect', () => console.log('Socket disconnected'));
    socket.on('new_message', handleNewMessage);
    socket.on('user_typing', handleUserTyping);
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('message_edited', handleMessageEdited);
    socket.on('reactions_updated', handleReactionsUpdated);
}

// ===== UI ФУНКЦИИ =====
function setupUIHandlers() {
    // Кнопка меню
    const menuBtn = document.getElementById('menu-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');
    
    if (menuBtn && dropdownMenu) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('active');
            updateMenuUserInfo();
        });
        
        // Закрытие при клике вне меню
        document.addEventListener('click', (e) => {
            if (!dropdownMenu.contains(e.target)) {
                dropdownMenu.classList.remove('active');
            }
        });
    }
    
    // Новый чат
    const newChatBtn = document.getElementById('new-chat-btn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            document.getElementById('new-chat-modal').classList.add('active');
            loadUsers();
        });
    }
    
    // Закрытие модального окна
    const closeModalBtn = document.querySelector('.close-modal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            document.getElementById('new-chat-modal').classList.remove('active');
        });
    }
    
    // Отправка сообщения
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (editingMessageId) {
                    saveEditedMessage();
                } else {
                    sendMessage();
                }
            }
        });
        
        // Отмена редактирования по Escape
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && editingMessageId) {
                cancelEdit();
            }
        });
    }
    
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            if (editingMessageId) {
                saveEditedMessage();
            } else {
                sendMessage();
            }
        });
    }
    
    // Загрузка файлов
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                uploadFile(file);
                fileInput.value = '';
            }
        });
    }
    
    // Вставка изображений через Ctrl+V
    document.addEventListener('paste', handlePaste);
    
    // Эмодзи
    const emojiBtn = document.getElementById('emoji-btn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', showEmojiPicker);
    }
}

// ===== ОБРАБОТКА ВСТАВКИ ФАЙЛОВ =====
function handlePaste(e) {
    const messageInput = document.getElementById('message-input');
    if (document.activeElement !== messageInput) return;
    
    const items = e.clipboardData.items;
    for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const blob = item.getAsFile();
            uploadFile(blob);
        }
    }
}

// ===== ЗАГРУЗКА ФАЙЛОВ =====
async function uploadFile(file) {
    if (!currentChatId) {
        alert('Выберите чат для отправки файла');
        return;
    }
    
    const messageInput = document.getElementById('message-input');
    const originalPlaceholder = messageInput.placeholder;
    messageInput.placeholder = 'Загрузка файла...';
    messageInput.disabled = true;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        if (!response.ok) throw new Error('Upload failed');
        
        const result = await response.json();
        
        // Отправляем сообщение с файлом
        socket.emit('send_message', {
            chatId: currentChatId,
            content: file.name,
            type: result.type,
            file_url: result.url
        });
        
    } catch (error) {
        console.error('Failed to upload file:', error);
        alert('Ошибка загрузки файла');
    } finally {
        messageInput.placeholder = originalPlaceholder;
        messageInput.disabled = false;
        messageInput.focus();
    }
}

// ===== ЭМОДЗИ =====
function showEmojiPicker() {
    const emojis = ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'];
    
    // Проверяем, не открыт ли уже picker
    const existingPicker = document.querySelector('.emoji-picker');
    if (existingPicker) {
        existingPicker.remove();
        return;
    }
    
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.style.cssText = `
        position: absolute;
        bottom: 60px;
        right: 10px;
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 10px;
        width: 300px;
        max-height: 200px;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 5px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 1000;
    `;
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.textContent = emoji;
        btn.style.cssText = `
            border: none;
            background: none;
            font-size: 20px;
            cursor: pointer;
            padding: 5px;
            border-radius: 4px;
            transition: background 0.2s;
        `;
        btn.onmouseover = () => btn.style.background = '#f0f0f0';
        btn.onmouseout = () => btn.style.background = 'none';
        btn.onclick = () => {
            insertEmoji(emoji);
            // Не закрываем picker, чтобы можно было выбрать несколько эмодзи
        };
        picker.appendChild(btn);
    });
    
    // Закрытие при клике вне
    setTimeout(() => {
        document.addEventListener('click', function closeEmoji(e) {
            if (!picker.contains(e.target) && e.target.id !== 'emoji-btn') {
                picker.remove();
                document.removeEventListener('click', closeEmoji);
            }
        });
    }, 100);
    
    document.querySelector('.chat-footer').appendChild(picker);
}

function insertEmoji(emoji) {
    const input = document.getElementById('message-input');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;
    input.value = text.substring(0, start) + emoji + text.substring(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
}

function updateUserInterface() {
    updateMenuUserInfo();
    renderChatsList();
}

function updateMenuUserInfo() {
    if (!currentUser) return;
    
    const avatar = document.querySelector('.menu-avatar');
    const displayName = document.querySelector('.menu-display-name');
    const username = document.querySelector('.menu-username');
    
    if (avatar) avatar.src = currentUser.avatar || getAvatarUrl(currentUser);
    if (displayName) displayName.textContent = currentUser.displayName;
    if (username) username.textContent = '@' + currentUser.username;
}

function showAuthScreen() {
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('main-screen').classList.remove('active');
}

function showMainScreen() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
}

// ===== ЧАТЫ =====
async function loadChats() {
    try {
        const response = await fetch('/api/chats', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const chatsList = await response.json();
        chats.clear();
        chatsList.forEach(chat => chats.set(chat.id, chat));
        
        renderChatsList();
    } catch (error) {
        console.error('Failed to load chats:', error);
    }
}

function renderChatsList() {
    const chatsList = document.getElementById('chats-list');
    if (!chatsList) return;
    
    if (chats.size === 0) {
        chatsList.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #666;">
                <p>Нет активных чатов</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">
                    Нажмите на карандаш, чтобы начать новый чат
                </p>
            </div>
        `;
        return;
    }
    
    chatsList.innerHTML = '';
    const sortedChats = Array.from(chats.values()).sort((a, b) => 
        new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0)
    );
    
    sortedChats.forEach(chat => {
        const chatEl = document.createElement('div');
        chatEl.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
        chatEl.onclick = () => openChat(chat.id);
        
        chatEl.innerHTML = `
            <img class="avatar" src="${chat.avatar || getAvatarUrl(chat)}" alt="">
            <div class="chat-item-info">
                <div class="chat-item-header">
                    <span class="chat-name">${chat.name || 'Чат'}</span>
                    <span class="chat-time">${formatTime(chat.lastMessageTime)}</span>
                </div>
                <div class="chat-last-message">
                    ${chat.lastMessage || 'Нет сообщений'}
                    ${chat.unreadCount ? `<span class="unread-badge">${chat.unreadCount}</span>` : ''}
                </div>
            </div>
        `;
        
        chatsList.appendChild(chatEl);
    });
}

async function openChat(chatId) {
    currentChatId = chatId;
    
    // Обновляем активный чат в списке
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Находим и активируем текущий чат
    const chatElements = document.querySelectorAll('.chat-item');
    chatElements.forEach(el => {
        if (chats.get(chatId) && el.querySelector('.chat-name').textContent === (chats.get(chatId).name || 'Чат')) {
            el.classList.add('active');
        }
    });
    
    await loadChatMessages(chatId);
}

async function loadChatMessages(chatId) {
    try {
        const response = await fetch(`/api/chats/${chatId}/messages`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const messagesList = await response.json();
        messages.set(chatId, messagesList);
        displayChat(chatId);
        
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

function displayChat(chatId) {
    const chat = chats.get(chatId);
    if (!chat) return;
    
    document.getElementById('no-chat-selected').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
    
    document.getElementById('chat-name').textContent = chat.name || 'Чат';
    document.getElementById('chat-avatar').src = chat.avatar || getAvatarUrl(chat);
    
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.innerHTML = '';
    
    const chatMessages = messages.get(chatId) || [];
    chatMessages.forEach(msg => renderMessage(msg));
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Сбрасываем счетчик непрочитанных
    chat.unreadCount = 0;
    renderChatsList();
}

function renderMessage(message, animate = false) {
    const container = document.getElementById('messages-container');
    const isOwn = message.user_id === currentUser.id;
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isOwn ? 'own' : ''}`;
    messageEl.dataset.messageId = message.id;
    
    if (animate) {
        messageEl.style.opacity = '0';
        messageEl.style.transform = 'translateY(20px)';
    }
    
    let content = '';
    
    if (message.is_deleted) {
        content = `<div class="message-text deleted">Сообщение удалено</div>`;
    } else if (message.type === 'text') {
        content = `<div class="message-text">${escapeHtml(message.content)}</div>`;
    } else if (message.type === 'image') {
        content = `
            <img class="message-image" src="http://localhost:3000${message.file_url}" 
                 onclick="openImageModal('http://localhost:3000${message.file_url}')"
                 style="max-width: 300px; max-height: 400px; border-radius: 8px; cursor: pointer;">
            <div class="message-text">${escapeHtml(message.content)}</div>
        `;
    }
    
    // Меню действий для своих сообщений
    const actions = isOwn && !message.is_deleted ? `
        <div class="message-actions">
            <button onclick="editMessage(${message.id})" title="Редактировать">✏️</button>
            <button onclick="deleteMessage(${message.id})" title="Удалить">🗑️</button>
        </div>
    ` : '';
    
    messageEl.innerHTML = `
        <div class="message-content">
            ${!isOwn && chats.get(currentChatId)?.type === 'group' ? `<div class="message-sender">${message.displayName}</div>` : ''}
            ${content}
            <div class="message-info">
                <span class="message-time">${formatTime(message.created_at)}</span>
                ${message.is_edited ? '<span class="edited">(изменено)</span>' : ''}
                ${isOwn ? '<span class="message-status">✓✓</span>' : ''}
            </div>
            ${actions}
        </div>
    `;
    
    // Добавляем реакции
    const reactionsEl = document.createElement('div');
    reactionsEl.className = 'message-reactions';
    if (message.reactions) {
        renderReactions(reactionsEl, message.reactions, message.id);
    }
    messageEl.appendChild(reactionsEl);
    
    // Контекстное меню для реакций
    messageEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!message.is_deleted) {
            showReactionPicker(e, message.id);
        }
    });
    
    container.appendChild(messageEl);
    
    if (animate) {
        setTimeout(() => {
            messageEl.style.transition = 'all 0.3s ease';
            messageEl.style.opacity = '1';
            messageEl.style.transform = 'translateY(0)';
        }, 10);
    }
    
    // Прокручиваем вниз
    container.scrollTop = container.scrollHeight;
}

function renderReactions(container, reactions, messageId) {
    container.innerHTML = '';
    
    Object.entries(reactions).forEach(([reaction, data]) => {
        const reactionEl = document.createElement('span');
        reactionEl.className = 'reaction';
        reactionEl.textContent = `${reaction} ${data.count}`;
        reactionEl.style.cssText = `
            display: inline-block;
            background: #f0f0f0;
            padding: 2px 8px;
            border-radius: 12px;
            margin: 2px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
        `;
        
        // Подсветка, если пользователь поставил эту реакцию
        if (data.users && data.users.includes(currentUser.id)) {
            reactionEl.style.background = '#e3f2fd';
            reactionEl.style.border = '1px solid #2196f3';
        }
        
        reactionEl.onclick = () => toggleReaction(messageId, reaction);
        reactionEl.onmouseover = () => reactionEl.style.transform = 'scale(1.1)';
        reactionEl.onmouseout = () => reactionEl.style.transform = 'scale(1)';
        
        container.appendChild(reactionEl);
    });
}

// ===== РЕАКЦИИ =====
function showReactionPicker(event, messageId) {
    const reactions = ['👍', '❤️', '😂', '😮', '😢', '😡'];
    
    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.style.cssText = `
        position: fixed;
        left: ${event.clientX}px;
        top: ${event.clientY}px;
        background: white;
        border: 1px solid #ddd;
        border-radius: 20px;
        padding: 5px 10px;
        display: flex;
        gap: 5px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        z-index: 1000;
    `;
    
    reactions.forEach(reaction => {
        const btn = document.createElement('button');
        btn.textContent = reaction;
        btn.style.cssText = `
            border: none;
            background: none;
            font-size: 20px;
            cursor: pointer;
            padding: 5px;
            border-radius: 50%;
            transition: all 0.2s;
        `;
        btn.onmouseover = () => {
            btn.style.background = '#f0f0f0';
            btn.style.transform = 'scale(1.2)';
        };
        btn.onmouseout = () => {
            btn.style.background = 'none';
            btn.style.transform = 'scale(1)';
        };
        btn.onclick = () => {
            toggleReaction(messageId, reaction);
            picker.remove();
        };
        picker.appendChild(btn);
    });
    
    document.body.appendChild(picker);
    
    // Закрытие при клике вне
    setTimeout(() => {
        document.addEventListener('click', function closePicker() {
            picker.remove();
            document.removeEventListener('click', closePicker);
        });
    }, 100);
}

async function toggleReaction(messageId, reaction) {
    try {
        const response = await fetch(`/api/messages/${messageId}/reactions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reaction })
        });
        
        if (!response.ok) throw new Error('Failed to toggle reaction');
        
    } catch (error) {
        console.error('Failed to toggle reaction:', error);
    }
}

// ===== РЕДАКТИРОВАНИЕ И УДАЛЕНИЕ =====
window.editMessage = function(messageId) {
    const chatMessages = messages.get(currentChatId) || [];
    const message = chatMessages.find(m => m.id === messageId);
    if (!message) return;
    
    editingMessageId = messageId;
    const input = document.getElementById('message-input');
    input.value = message.content;
    input.focus();
    
    // Изменяем кнопку отправки
    const sendBtn = document.getElementById('send-btn');
    sendBtn.innerHTML = '<i class="material-icons">check</i>';
    
    // Показываем индикатор редактирования
    showEditingIndicator(message.content);
};

function showEditingIndicator(originalText) {
    const indicator = document.createElement('div');
    indicator.id = 'editing-indicator';
    indicator.style.cssText = `
        padding: 8px 16px;
        background: #e3f2fd;
        border-left: 3px solid #2196f3;
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    indicator.innerHTML = `
        <div>
            <div style="font-size: 12px; color: #666;">Редактирование сообщения</div>
            <div style="font-size: 14px; margin-top: 2px;">${escapeHtml(originalText.substring(0, 50))}${originalText.length > 50 ? '...' : ''}</div>
        </div>
        <button onclick="cancelEdit()" style="border: none; background: none; cursor: pointer; padding: 4px;">✕</button>
    `;
    
    const footer = document.querySelector('.chat-footer');
    footer.insertBefore(indicator, footer.firstChild);
}

window.cancelEdit = function() {
    editingMessageId = null;
    document.getElementById('message-input').value = '';
    document.getElementById('send-btn').innerHTML = '<i class="material-icons">send</i>';
    const indicator = document.getElementById('editing-indicator');
    if (indicator) indicator.remove();
};

async function saveEditedMessage() {
    if (!editingMessageId) return;
    
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content) return;
    
    try {
        const response = await fetch(`/api/messages/${editingMessageId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        });
        
        if (!response.ok) throw new Error('Failed to edit message');
        
        cancelEdit();
        
    } catch (error) {
        console.error('Failed to edit message:', error);
        alert('Не удалось отредактировать сообщение');
    }
}

window.deleteMessage = async function(messageId) {
    if (!confirm('Удалить сообщение?')) return;
    
    try {
        const response = await fetch(`/api/messages/${messageId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to delete message');
        
    } catch (error) {
        console.error('Failed to delete message:', error);
        alert('Не удалось удалить сообщение');
    }
};

// ===== ОБРАБОТЧИКИ СОКЕТОВ =====
function handleMessageDeleted(data) {
    const { messageId, chatId } = data;
    if (chatId !== currentChatId) return;
    
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
        const contentEl = messageEl.querySelector('.message-text');
        if (contentEl) {
            contentEl.textContent = 'Сообщение удалено';
            contentEl.classList.add('deleted');
        }
        const actionsEl = messageEl.querySelector('.message-actions');
        if (actionsEl) actionsEl.remove();
    }
    
    // Обновляем в кеше
    const chatMessages = messages.get(chatId) || [];
    const message = chatMessages.find(m => m.id === messageId);
    if (message) {
        message.is_deleted = true;
        message.content = 'Сообщение удалено';
    }
}

function handleMessageEdited(data) {
    const { chatId, message } = data;
    if (chatId !== currentChatId) return;
    
    const messageEl = document.querySelector(`[data-message-id="${message.id}"]`);
    if (messageEl) {
        const contentEl = messageEl.querySelector('.message-text');
        if (contentEl) {
            contentEl.textContent = message.content;
        }
        
        // Добавляем метку "изменено"
        const infoEl = messageEl.querySelector('.message-info');
        if (infoEl && !infoEl.querySelector('.edited')) {
            const editedSpan = document.createElement('span');
            editedSpan.className = 'edited';
            editedSpan.textContent = '(изменено)';
            editedSpan.style.cssText = 'font-size: 0.75rem; color: #666; margin-left: 4px;';
            infoEl.insertBefore(editedSpan, infoEl.querySelector('.message-status'));
        }
    }
    
    // Обновляем в кеше
    const chatMessages = messages.get(chatId) || [];
    const index = chatMessages.findIndex(m => m.id === message.id);
    if (index !== -1) {
        chatMessages[index] = message;
    }
}

function handleReactionsUpdated(data) {
    const { messageId, reactions } = data;
    
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
        const reactionsEl = messageEl.querySelector('.message-reactions');
        if (reactionsEl) {
            const reactionsMap = {};
            reactions.forEach(r => {
                reactionsMap[r.reaction] = {
                    count: r.count,
                    users: r.users ? r.users.split(',').map(id => parseInt(id)) : []
                };
            });
            renderReactions(reactionsEl, reactionsMap, messageId);
        }
    }
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !currentChatId) return;
    
    socket.emit('send_message', {
        chatId: currentChatId,
        content,
        type: 'text'
    });
    
    input.value = '';
}

function handleNewMessage(data) {
    const { chatId, message } = data;
    
    if (!messages.has(chatId)) {
        messages.set(chatId, []);
    }
    messages.get(chatId).push(message);
    
    if (currentChatId === chatId) {
        renderMessage(message, true);
    } else {
        // Увеличиваем счетчик непрочитанных
        const chat = chats.get(chatId);
        if (chat && message.user_id !== currentUser.id) {
            chat.unreadCount = (chat.unreadCount || 0) + 1;
        }
    }
    
    // Обновляем список чатов
    const chat = chats.get(chatId);
    if (chat) {
        chat.lastMessage = message.is_deleted ? 'Сообщение удалено' : message.content;
        chat.lastMessageTime = message.created_at;
        renderChatsList();
    }
}

function handleUserTyping(data) {
    const { chatId, userId, isTyping } = data;
    
    if (chatId !== currentChatId) return;
    
    const indicator = document.getElementById('typing-indicator');
    if (isTyping) {
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

// ===== ПОЛЬЗОВАТЕЛИ =====
async function loadUsers() {
    try {
        const response = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        
        const users = await response.json();
        const usersList = document.getElementById('users-list');
        
        usersList.innerHTML = '';
        users.forEach(user => {
            const userEl = document.createElement('div');
            userEl.className = 'user-item';
            userEl.style.cssText = 'display: flex; align-items: center; padding: 1rem; cursor: pointer;';
            userEl.onmouseover = () => userEl.style.background = '#f0f0f0';
            userEl.onmouseout = () => userEl.style.background = 'none';
            
            userEl.innerHTML = `
                <img src="${user.avatar || getAvatarUrl(user)}" style="width: 40px; height: 40px; border-radius: 50%; margin-right: 1rem;">
                <div style="flex: 1;">
                    <div style="font-weight: 500;">${user.displayName}</div>
                    <div style="font-size: 0.9rem; color: #666;">@${user.username}</div>
                </div>
                ${user.isOnline ? '<span style="color: #4CAF50;">● онлайн</span>' : ''}
            `;
            
            userEl.onclick = () => createPrivateChat(user.id);
            usersList.appendChild(userEl);
        });
        
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

async function createPrivateChat(targetUserId) {
    try {
        const response = await fetch('/api/chats/private', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUserId })
        });
        
        const chat = await response.json();
        document.getElementById('new-chat-modal').classList.remove('active');
        
        await loadChats();
        
        // Открываем созданный чат
        setTimeout(() => {
            const chatItems = document.querySelectorAll('.chat-item');
            if (chatItems.length > 0) {
                chatItems[0].click();
            }
        }, 100);
        
    } catch (error) {
        console.error('Failed to create chat:', error);
    }
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function getAvatarUrl(user) {
    if (user.avatar) return user.avatar.startsWith('http') ? user.avatar : `http://localhost:3000${user.avatar}`;
    const name = user.displayName || user.name || '?';
    const color = user.id ? ['4CAF50', '2196F3', 'FF9800', '9C27B0'][user.id % 4] : '999999';
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23${color}'/%3E%3Ctext x='20' y='25' text-anchor='middle' fill='white' font-size='18'%3E${name[0].toUpperCase()}%3C/text%3E%3C/svg%3E`;
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== МОДАЛЬНОЕ ОКНО ДЛЯ ИЗОБРАЖЕНИЙ =====
window.openImageModal = function(src) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        cursor: zoom-out;
    `;
    
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
    `;
    
    modal.appendChild(img);
    modal.onclick = () => modal.remove();
    
    document.body.appendChild(modal);
};

// ===== НАСТРОЙКИ =====
window.showSettings = function() {
    document.getElementById('dropdown-menu').classList.remove('active');
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>Настройки</h2>
            
            <div style="margin-bottom: 20px;">
                <h3>Профиль</h3>
                <div style="display: flex; align-items: center; gap: 20px; margin-top: 10px;">
                    <img id="settings-avatar" src="${currentUser.avatar || getAvatarUrl(currentUser)}" 
                         style="width: 80px; height: 80px; border-radius: 50%; cursor: pointer;"
                         onclick="document.getElementById('avatar-input').click()">
                    <input type="file" id="avatar-input" style="display: none;" accept="image/*">
                    <div>
                        <div>Нажмите на фото для изменения</div>
                        <input type="text" id="display-name-input" value="${currentUser.displayName}" 
                               style="margin-top: 10px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3>Тема оформления</h3>
                <div style="margin-top: 10px;">
                    <label style="margin-right: 20px;">
                        <input type="radio" name="theme" value="light" ${currentTheme === 'light' ? 'checked' : ''}>
                        Светлая
                    </label>
                    <label>
                        <input type="radio" name="theme" value="dark" ${currentTheme === 'dark' ? 'checked' : ''}>
                        Темная
                    </label>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button onclick="this.closest('.modal').remove()" 
                        style="padding: 8px 16px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer;">
                    Отмена
                </button>
                <button onclick="saveSettings()" 
                        style="padding: 8px 16px; border: none; background: #2e7d32; color: white; border-radius: 4px; cursor: pointer;">
                    Сохранить
                </button>
            </div>
            
            <button class="close-modal" onclick="this.closest('.modal').remove()">&times;</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Обработчик загрузки аватара
    const avatarInput = modal.querySelector('#avatar-input');
    avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                modal.querySelector('#settings-avatar').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Обработчик изменения темы
    modal.querySelectorAll('input[name="theme"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.body.setAttribute('data-theme', theme);
        });
    });
};

window.saveSettings = async function() {
    const modal = document.querySelector('.modal');
    const displayName = modal.querySelector('#display-name-input').value;
    const theme = modal.querySelector('input[name="theme"]:checked').value;
    const avatarFile = modal.querySelector('#avatar-input').files[0];
    
    const formData = new FormData();
    formData.append('displayName', displayName);
    formData.append('theme', theme);
    if (avatarFile) {
        formData.append('avatar', avatarFile);
    }
    
    try {
        const response = await fetch('/api/users/profile', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        if (!response.ok) throw new Error('Failed to update profile');
        
        const updatedUser = await response.json();
        currentUser = updatedUser;
        window.currentUser = updatedUser;
        
        // Сохраняем тему
        currentTheme = theme;
        localStorage.setItem('theme', theme);
        document.body.setAttribute('data-theme', theme);
        
        // Обновляем UI
        updateMenuUserInfo();
        
        modal.remove();
        alert('Настройки сохранены');
        
    } catch (error) {
        console.error('Failed to save settings:', error);
        alert('Ошибка сохранения настроек');
    }
};

// ===== ГЛОБАЛЬНЫЕ ФУНКЦИИ =====
window.logout = function() {
    if (confirm('Выйти из аккаунта?')) {
        localStorage.removeItem('token');
        if (socket) socket.disconnect();
        location.reload();
    }
};

console.log('Georgiogramm loaded successfully!');

// Отладка для мобильных устройств
if (/Mobi|Android/i.test(navigator.userAgent)) {
    console.log('Mobile device detected');
    
    // Показываем ошибки на экране для мобильных
    window.addEventListener('error', (e) => {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: red;
            color: white;
            padding: 10px;
            z-index: 9999;
            font-size: 12px;
        `;
        errorDiv.textContent = `Error: ${e.message} at ${e.filename}:${e.lineno}`;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => errorDiv.remove(), 5000);
    });
    
    // Логирование для мобильных
    const originalLog = console.log;
    console.log = function(...args) {
        originalLog.apply(console, args);
        
        // Показываем логи на экране (опционально)
        if (window.location.search.includes('debug=1')) {
            const logDiv = document.createElement('div');
            logDiv.style.cssText = `
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 5px;
                font-size: 10px;
                max-height: 100px;
                overflow-y: auto;
            `;
            logDiv.textContent = args.join(' ');
            document.body.appendChild(logDiv);
            
            setTimeout(() => logDiv.remove(), 3000);
        }
    };
}

// Проверка поддержки localStorage на мобильных
try {
    localStorage.setItem('test', 'test');
    localStorage.removeItem('test');
} catch (e) {
    console.error('LocalStorage not supported');
    alert('Ваш браузер не поддерживает localStorage. Попробуйте другой браузер.');
}

// Проверка WebSocket поддержки
if (!window.WebSocket) {
    console.error('WebSocket not supported');
    alert('Ваш браузер не поддерживает WebSocket. Обновите браузер.');
}
