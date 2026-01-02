// login-script.js

const API_BASE = "/api";
const API_LOGIN = `${API_BASE}/login`;

/* =========================
   UI HELPERS
========================= */

const showError = (msg) => {
    const el = document.getElementById('loginError');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
        el.focus();
    }
};

const hideError = () => {
    const el = document.getElementById('loginError');
    if (el) {
        el.style.display = 'none';
        el.textContent = '';
    }
};

const setLoading = (loading, btn) => {
    if (!btn) return;

    if (loading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Connexion...';
        btn.disabled = true;
    } else {
        btn.innerHTML =
            btn.dataset.originalText ||
            '<i data-lucide="log-in" class="w-4 h-4"></i> Se connecter';
        btn.disabled = false;
    }
};

const redirectByRole = (role) => {
    const routes = {
        inputter: '/upload',
        authoriser: '/validate'
    };
    window.location.href = routes[role?.toLowerCase()] || '/dashboard';
};

/* =========================
   SAFE FETCH HELPERS
========================= */

const parseErrorResponse = async (res) => {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    // Try JSON first
    if (contentType.includes('application/json')) {
        try {
            const json = JSON.parse(text);
            return json.message || 'Erreur d’authentification.';
        } catch {
            return 'Erreur serveur.';
        }
    }

    // HTML fallback (Quarkus login page, proxy, etc.)
    console.warn('HTML error response received:', text);
    return 'Identifiants incorrects.';
};

/* =========================
   MAIN LOGIC
========================= */

document.addEventListener('DOMContentLoaded', () => {

    const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('error') === 'session_expired') {
            showError('Votre session a expiré. Veuillez vous reconnecter.');
    }

    // Prevent auth loop on login page
    if (window.location.pathname === '/login') {
        sessionStorage.removeItem('role');
        sessionStorage.removeItem('username');
    }

    const form = document.getElementById('loginForm');
    if (!form) return;

    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.dataset.originalText = btn.innerHTML;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username')?.value.trim();
        const password = document.getElementById('password')?.value.trim();

        if (!username || !password) {
            showError('Remplissez tous les champs.');
            return;
        }

        hideError();
        setLoading(true, btn);

        try {
            const res = await fetch(API_LOGIN, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            if (!res.ok) {
                const message = await parseErrorResponse(res);
                throw new Error(message);
            }

            // Success MUST be JSON
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                throw new Error('Réponse serveur invalide.');
            }

            const data = await res.json();
            sessionStorage.setItem('role', data.role);
            sessionStorage.setItem('username', data.username);

            redirectByRole(data.role);

        } catch (err) {
            console.error('Login error:', err);
            showError(err.message || 'Erreur de connexion.');
        } finally {
            setLoading(false, btn);
        }
    });

    // Auto-redirect if already logged in
    const role = sessionStorage.getItem('role');
    if (role && window.location.pathname !== '/login') {
        redirectByRole(role);
    }
});
