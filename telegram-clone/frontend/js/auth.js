// Обработка авторизации
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const authError = document.getElementById('auth-error');
    
    // Переключение вкладок
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // Активируем кнопку
            document.querySelector('.tab-btn.active').classList.remove('active');
            btn.classList.add('active');
            
            // Показываем форму
            document.querySelector('.auth-form.active').classList.remove('active');
            document.getElementById(`${tab}-form`).classList.add('active');
            
            // Очищаем ошибки
            authError.textContent = '';
        });
    });
    
    // Обработка входа
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData);
        
        try {
            const response = await fetch('http://localhost:3000/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Ошибка входа');
            }
            
            // Сохраняем токен
            localStorage.setItem('token', result.token);
            
            // Сохраняем данные пользователя
            window.currentUser = result.user;
            
            // Переходим к чатам
            showMainScreen();
            initializeApp(result.token);
            
        } catch (error) {
            authError.textContent = error.message;
        }
    });
    
    // Обработка регистрации
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(registerForm);
        const data = Object.fromEntries(formData);
        
        try {
            const response = await fetch('http://localhost:3000/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || result.errors?.[0]?.msg || 'Ошибка регистрации');
            }
            
            // Сохраняем токен
            localStorage.setItem('token', result.token);
            
            // Сохраняем данные пользователя
            window.currentUser = result.user;
            
            // Переходим к чатам
            showMainScreen();
            initializeApp(result.token);
            
        } catch (error) {
            authError.textContent = error.message;
        }
    });
});

// Функции для переключения экранов
function showAuthScreen() {
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('main-screen').classList.remove('active');
}

function showMainScreen() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
}

// Выход из приложения
function logout() {
    localStorage.removeItem('token');
    if (window.socket) {
        window.socket.disconnect();
    }
    location.reload();
}
