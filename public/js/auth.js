// Registration
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const business_name = document.getElementById('business_name').value;
        const email = document.getElementById('email').value;
        const phone = document.getElementById('phone').value;
        const password = document.getElementById('password').value;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ business_name, email, phone, password })
            });
            const data = await res.json();
            if (res.ok) {
                alert('Registration successful! Please login.');
                window.location.href = 'login.html';
            } else {
                alert(data.message || 'Registration failed');
            }
        } catch (err) {
            console.error(err);
            alert('An error occurred');
        }
    });
}

// Login
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (res.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                window.location.href = 'dashboard.html';
            } else {
                alert(data.message || 'Login failed');
            }
        } catch (err) {
            console.error(err);
            alert('An error occurred');
        }
    });
}
