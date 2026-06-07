const API = '/api/auth';
const SPECIAL = '!@#$%^&*()_+-=[]{}|;\':",.<>?';
let policy = { minLength: 10, requireDigit: true, requireUppercase: true, requireSpecial: true };

fetch(API + '/password-policy').then(r => r.json()).then(p => { policy = p; }).catch(() => {});

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

document.getElementById('changeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPwd = document.getElementById('currentPwd').value;
    const newPwd     = document.getElementById('newPwd').value;
    const confirmPwd = document.getElementById('confirmPwd').value;
    const btn        = document.getElementById('submitBtn');

    document.getElementById('errBox').classList.remove('show');
    document.getElementById('okBox').classList.remove('show');

    if (newPwd !== confirmPwd) { showErr('Les mots de passe ne correspondent pas.'); return; }

    btn.disabled = true;
    btn.querySelector('span').textContent = 'Enregistrement...';

    try {
        const res = await fetch(API + '/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('okMsg').textContent = data.message || 'Mot de passe changé avec succès !';
            document.getElementById('okBox').classList.add('show');
            setTimeout(() => { window.location.href = '/dashboard'; }, 1800);
        } else {
            showErr(data.message || 'Erreur lors du changement.');
            btn.disabled = false;
            btn.querySelector('span').textContent = 'Enregistrer';
        }
    } catch {
        showErr('Erreur réseau.');
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Enregistrer';
    }
});

function showErr(msg) {
    document.getElementById('errMsg').textContent = msg;
    document.getElementById('errBox').classList.add('show');
}
