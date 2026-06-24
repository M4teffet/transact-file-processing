document.getElementById('forgotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const btn = document.getElementById('submitBtn');
    document.getElementById('errBox').classList.remove('show');
    document.getElementById('okBox').classList.remove('show');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Envoi en cours...';
    try {
        await fetch('/api/v1/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        document.getElementById('okBox').classList.add('show');
        document.getElementById('forgotForm').style.display = 'none';
    } catch {
        document.getElementById('errMsg').textContent = 'Erreur réseau. Veuillez réessayer.';
        document.getElementById('errBox').classList.add('show');
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Envoyer le lien';
    }
});
