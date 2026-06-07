(function () {
    'use strict';

    var API = '/api';
    var pendingUsername = null;
    var otpTimer = null;

    function $(id) { return document.getElementById(id); }

    // Safe JSON parse — returns {ok, status, message} even if server returns HTML or empty body
    function safeJson(res) {
        return res.text().then(function(text) {
            try {
                return JSON.parse(text || '{}');
            } catch(e) {
                // Server returned non-JSON (HTML redirect, empty body, etc.)
                return { message: 'Erreur serveur. Réessayez.' };
            }
        }).then(function(data) {
            data._status = res.status;
            data._ok = res.ok;
            return data;
        });
    }

    function showError(boxId, msgId, msg) {
        var box = $(boxId);
        var msgEl = $(msgId);
        if (msgEl) msgEl.textContent = msg;
        if (box) box.classList.add('show');
    }

    function hideError(boxId) {
        var box = $(boxId);
        if (box) box.classList.remove('show');
    }

    function showStep(id) {
        document.querySelectorAll('.step').forEach(function (s) {
            s.classList.remove('active');
        });
        var el = $(id);
        if (el) el.classList.add('active');
    }

    function redirect(role, mustChangePassword) {
        if (mustChangePassword) { window.location.href = '/change-password'; return; }
        var map = { INPUTTER: '/upload', AUTHORISER: '/validate' };
        window.location.href = map[role] || '/dashboard';
    }

    // ── Step 1 ────────────────────────────────────────────────────────────────

    var form1 = $('credentialsForm');
    if (form1) {
        form1.addEventListener('submit', function (e) {
            e.preventDefault();
            hideError('credError');

            var username = $('username').value.trim();
            var password = $('password').value;
            var btn      = $('loginBtn');
            var btnText  = $('loginBtnText');

            if (!username || !password) {
                showError('credError', 'credErrorMsg', 'Remplissez tous les champs.');
                return;
            }

            btn.disabled = true;
            if (btnText) btnText.textContent = 'Connexion…';

            fetch(API + '/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            })
            .then(function (res) {
                return safeJson(res).then(function (data) {
                    if (!data._ok) {
                        showError('credError', 'credErrorMsg', data.message || 'Identifiants invalides.');
                        return;
                    }
                    if (data.requiresOtp) {
                        pendingUsername = data.username || username;
                        var hint = $('otpHintMsg');
                        if (hint) hint.textContent = 'Un code à 6 chiffres a été envoyé à votre adresse e-mail.';
                        showStep('step-otp');
                        startTimer(300);
                        var inp = $('otpCode');
                        if (inp) inp.focus();
                        return;
                    }
                    sessionStorage.setItem('role', data.role || '');
                    sessionStorage.setItem('username', data.username || '');
                    sessionStorage.setItem('country', data.country || '');
                    redirect(data.role, data.mustChangePassword);
                });
            })
            .catch(function (err) {
                console.error('Login fetch error:', err);
                showError('credError', 'credErrorMsg', 'Erreur réseau. Réessayez.');
            })
            .finally(function () {
                btn.disabled = false;
                if (btnText) btnText.textContent = 'Se connecter';
            });
        });
    }

    // ── Step 2 ────────────────────────────────────────────────────────────────

    var form2 = $('otpForm');
    if (form2) {
        form2.addEventListener('submit', function (e) {
            e.preventDefault();
            hideError('otpError');

            var otp = $('otpCode').value.trim();
            var btn = $('otpBtn');

            if (!otp || otp.length !== 6) {
                showError('otpError', 'otpErrorMsg', 'Entrez le code à 6 chiffres.');
                return;
            }

            btn.disabled = true;

            fetch(API + '/auth/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ username: pendingUsername, otp: otp })
            })
            .then(function (res) {
                return safeJson(res).then(function (data) {
                    if (!data._ok) {
                        showError('otpError', 'otpErrorMsg', data.message || 'Code invalide.');
                        return;
                    }
                    clearTimer();
                    sessionStorage.setItem('role', data.role || '');
                    sessionStorage.setItem('username', data.username || '');
                    sessionStorage.setItem('country', data.country || '');
                    redirect(data.role, data.mustChangePassword);
                });
            })
            .catch(function (err) {
                console.error('OTP fetch error:', err);
                showError('otpError', 'otpErrorMsg', 'Erreur réseau. Réessayez.');
            })
            .finally(function () {
                btn.disabled = false;
            });
        });
    }

    var resendBtn = $('resendBtn');
    if (resendBtn) {
        resendBtn.addEventListener('click', function () {
            resendBtn.disabled = true;
            fetch(API + '/auth/resend-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: pendingUsername })
            }).finally(function () {
                resendBtn.disabled = false;
                clearTimer();
                startTimer(300);
                $('otpCode').value = '';
            });
        });
    }

    window.backToCredentials = function () {
        clearTimer();
        pendingUsername = null;
        if ($('otpCode')) $('otpCode').value = '';
        hideError('otpError');
        showStep('step-credentials');
    };

    // ── Timer ─────────────────────────────────────────────────────────────────

    function startTimer(seconds) {
        var el = $('otpTimer');
        var remaining = seconds;
        function tick() {
            if (!el) return;
            if (remaining <= 0) {
                el.textContent = 'Code expiré — cliquez sur Renvoyer.';
                el.style.color = '#dc2626';
                return;
            }
            var m = Math.floor(remaining / 60);
            var s = remaining % 60;
            el.textContent = 'Valide ' + m + ':' + (s < 10 ? '0' : '') + s;
            remaining--;
            otpTimer = setTimeout(tick, 1000);
        }
        tick();
    }

    function clearTimer() {
        if (otpTimer) { clearTimeout(otpTimer); otpTimer = null; }
        var el = $('otpTimer');
        if (el) { el.textContent = ''; el.style.color = ''; }
    }

    // ── Session expired ───────────────────────────────────────────────────────

    if (new URLSearchParams(window.location.search).get('error') === 'session_expired') {
        showError('credError', 'credErrorMsg', 'Session expirée. Reconnectez-vous.');
    }
    sessionStorage.removeItem('role');
    sessionStorage.removeItem('username');

}());