// Функции для работы с чатом
let typingTimer = null;
let isTyping = false;

async function loadChatMessages(chatId) {
    try {
        const response = await fetch(`http://localhost:3000/api/chats/${chatId}/messages`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const messagesList = await response.json();
        
        // Сохраняем в кеш
        messages.set(chatId, messagesList);
        
        // Отображаем чат
        displayChat(chatId);
        
        // Отмечаем как прочитанные
        if (messagesList.length > 0) {
            markAsRead(messagesList[messagesList.length - 1].id);
        }
        
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

function displayChat(chatId) {
    const chat = chats.get(chatId);
    if (!chat) return;
    
    window.currentChatId = chatId;
    
    // Обновляем заголовок чата
    document.getElementById('chat-name').textContent = chat.name || 'Чат';
    document.getElementById('chat-avatar').src = chat.avatar || '/assets/default-avatar.png';
    
    // Показываем контейнер чата
    document.getElementById('no-chat-selected').style.display = 'none';
    document.getElementById('chat-container').style.display = 'flex';
    
    // Отображаем сообщения
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.innerHTML = '';
    
    const chatMessages = messages.get(chatId) || [];
    chatMessages.forEach(msg => renderMessage(msg));
    
    // Прокручиваем вниз
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Обновляем статус в списке чатов
    chat.unreadCount = 0;
    renderChatsList();
    
    // Фокус на поле ввода
    document.getElementById('message-input').focus();
}

function renderMessage(message) {
    const messagesContainer = document.getElementById('messages-container');
    const isOwn = message.user_id === window.currentUser.id;
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isOwn ? 'own' : ''}`;
    messageEl.dataset.messageId = message.id;
    
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    
    // Контент сообщения
    if (message.type === 'text') {
        const textEl = document.createElement('div');
        textEl.className = 'message-text';
        textEl.textContent = message.content;
        contentEl.appendChild(textEl);
    } else if (message.type === 'image') {
        const imgEl = document.createElement('img');
        imgEl.className = 'message-image';
        imgEl.src = message.file_url;
        contentEl.appendChild(imgEl);
    }
    
    // Время
    const timeEl = document.createElement('div');
    timeEl.className = 'message-time';
    timeEl.textContent = formatTime(message.created_at);
    contentEl.appendChild(timeEl);
    
    messageEl.appendChild(contentEl);
    messagesContainer.appendChild(messageEl);
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    
    if (!content || !window.currentChatId) return;
    
    window.socket.emit('send_message', {
        chatId: window.currentChatId,
        content,
        type: 'text'
    });
    
    input.value = '';
    updateTypingStatus(false);
}

function handleTyping() {
    const input = document.getElementById('message-input');
    
    if (input.value.trim() && !isTyping) {
        isTyping = true;
        updateTypingStatus(true);
    }
    
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        if (isTyping) {
            isTyping = false;
            updateTypingStatus(false);
        }
    }, 1000);
}

function updateTypingStatus(typing) {
    if (window.currentChatId && window.socket) {
        window.socket.emit('typing', {
            chatId: window.currentChatId,
            isTyping: typing
        });
    }
}

window.handleUserTypingInChat = function(data) {
    const { chatId, userId, isTyping } = data;
    
    if (chatId !== window.currentChatId) return;
    
    const indicator = document.getElementById('typing-indicator');
    
    if (isTyping) {
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
};

function markAsRead(messageId) {
    if (window.currentChatId && messageId && window.socket) {
        window.socket.emit('mark_read', {
            chatId: window.currentChatId,
            messageId
        });
    }
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return 'Вчера';
    }
    
    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short'
    });
}

// Загрузка файлов
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('http://localhost:3000/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        if (!response.ok) throw new Error('Upload failed');
        
        const result = await response.json();
        
        window.socket.emit('send_message', {
            chatId: window.currentChatId,
            content: file.name,
            type: result.type,
            file_url: result.url
        });
        
    } catch (error) {
        console.error('Failed to upload file:', error);
        alert('Ошибка загрузки файла');
    }
}
