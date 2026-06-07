const SPECIAL = '!@#$%^&*()_+-=[]{}|;\':",.<>?';
let policy = { minLength: 10, requireDigit: true, requireUppercase: true, requireSpecial: true };
const token = new URLSearchParams(window.location.search).get('token');

if (!token) {
    document.getElementById('invalidBox').classList.add('show');
    document.getElementById('resetForm').style.display = 'none';
}

fetch('/api/auth/password-policy').then(r => r.json()).then(p => { policy = p; }).catch(() => {});

function checkStrength(val) {
    const ok = {
        length:  val.length >= policy.minLength,
        upper:   !policy.requireUppercase || /[A-Z]/.test(val),
        digit:   !policy.requireDigit     || /\d/.test(val),
        special: !policy.requireSpecial   || SPECIAL.split('').some(c => val.includes(c)),
        space:   !val.includes(' ')
    };
    ['length', 'upper', 'digit', 'special', 'space'].forEach((k, i) => {
        const el = document.getElementById(['r-length','r-upper','r-digit','r-special','r-space'][i]);
        if (el) el.className = ok[k] ? 'ok' : '';
    });
    const score = Object.values(ok).filter(Boolean).length;
    const bar   = document.getElementById('meterBar');
    const label = document.getElementById('meterLabel');
    bar.style.width = (score / 5 * 100) + '%';
    const [c, t] = score <= 2 ? ['#ef4444','Trop faible']
                 : score === 3 ? ['#f59e0b','Moyen']
                 : score === 4 ? ['#3b82f6','Bon']
                 : ['#22c55e','Excellent'];
    bar.style.background = c;
    label.textContent    = t;
    label.style.color    = c;
    document.getElementById('submitBtn').disabled = (score < 5);
}

document.querySelectorAll('.eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const inp = document.getElementById(btn.dataset.target);
        const ico = btn.querySelector('i');
        inp.type = inp.type === 'password' ? 'text' : 'password';
        ico.setAttribute('data-lucide', inp.type === 'password' ? 'eye-off' : 'eye');
        if (window.lucide) lucide.createIcons();
    });
});

document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPwd     = document.getElementById('newPwd').value;
    const confirmPwd = document.getElementById('confirmPwd').value;
    const btn        = document.getElementById('submitBtn');

    document.getElementById('errBox').classList.remove('show');

    if (newPwd !== confirmPwd) { showErr('Les mots de passe ne correspondent pas.'); return; }

    btn.disabled = true;
    btn.querySelector('span').textContent = 'Enregistrement...';

    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword: newPwd })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('okMsg').textContent = data.message;
            document.getElementById('okBox').classList.add('show');
            document.getElementById('resetForm').style.display = 'none';
            setTimeout(() => { window.location.href = '/login'; }, 2500);
        } else {
            if (res.status === 400 && data.message && data.message.includes('expired')) {
                document.getElementById('resetForm').style.display = 'none';
                document.getElementById('invalidBox').classList.add('show');
            } else {
                showErr(data.message || 'Erreur lors de la réinitialisation.');
            }
            btn.disabled = false;
            btn.querySelector('span').textContent = 'Réinitialiser';
        }
    } catch {
        showErr('Erreur réseau.');
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Réinitialiser';
    }
});

function showErr(msg) {
    document.getElementById('errMsg').textContent = msg;
    document.getElementById('errBox').classList.add('show');
}
