// settings.js

// ── Helpers ───────────────────────────────────────────────────────────────────

const getCountryData = (code) => {
    try {
        const regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
        const name = regionNames.of(code.toUpperCase()) || code.toUpperCase();
        const codeL = code.toLowerCase();
        const flag = `<img src="https://flagcdn.com/16x12/${codeL}.png"
                           srcset="https://flagcdn.com/32x24/${codeL}.png 2x"
                           width="16" height="12" alt="${code}"
                           style="display:inline-block;vertical-align:middle;">`;
        return { name, flag };
    } catch {
        return { name: code, flag: '' };
    }
};


async function parseErrorResponse(res) {
    const ct = res.headers.get('content-type') || '';
    let msg = `Erreur ${res.status}`;
    try {
        if (ct.includes('application/json')) {
            const d = await res.json();
            if (d.violations?.length) return d.violations.map(v => v.message).join('\n');
            return d.title || d.message || d.error || msg;
        }
        const text = await res.text();
        return text.trim() || msg;
    } catch { return msg; }
}

// ── Tab navigation ────────────────────────────────────────────────────────────

document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.settings-panel').forEach(p => p.classList.add('hidden'));
        tab.classList.add('active');
        const panel = document.getElementById('panel-' + tab.dataset.tab);
        if (panel) panel.classList.remove('hidden');
    });
});

// ── User list rendering ───────────────────────────────────────────────────────

let _allUsers = [];

function renderUserItem(user) {
    const roleLabel = { ADMIN: 'Admin', INPUTTER: 'Initiateur', AUTHORISER: 'Validateur' }[user.role] || user.role;
    const roleCls = { ADMIN: 'bg-purple-50 text-purple-700 border-purple-200', INPUTTER: 'bg-blue-50 text-blue-700 border-blue-200', AUTHORISER: 'bg-green-50 text-green-700 border-green-200' }[user.role] || 'bg-gray-100 text-gray-600 border-gray-200';
    const initials = user.username.slice(0, 2).toUpperCase();
    const isLocked = user.status === 'LOCKED';
    const avatarCls = isLocked ? 'bg-red-50 border-red-200 text-red-600' : 'bg-orange-50 border-orange-200 text-orange-600';
    const dotCls = { ACTIVE: 'bg-green-400', LOCKED: 'bg-red-500', PENDING: 'bg-yellow-400' }[user.status] || 'bg-gray-300';

    const pwdBadge = user.mustChangePassword
        ? `<span class="text-[9px] bg-orange-50 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-full">pwd requis</span>`
        : '';

    const unlockBtn = isLocked
        ? `<button onclick="unlockUser('${user.username}')"
                   class="text-[10px] bg-red-600 hover:bg-red-700 text-white px-2 py-0.5 rounded transition">
               🔓 Déverrouiller
           </button>`
        : '';

    return `
    <li class="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors" data-username="${user.username.toLowerCase()}" data-role="${user.role}" data-status="${user.status}">
        <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 text-xs font-semibold ${avatarCls}">${initials}</div>
            <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-xs font-semibold text-gray-900">${user.username}</span>
                    <span class="text-[10px] font-medium px-1.5 py-0.5 rounded border ${roleCls}">${roleLabel}</span>
                    ${pwdBadge}
                </div>
                <div class="text-[10px] text-gray-400 mt-0.5 truncate">${user.email || user.countryCode}</div>
            </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 ml-2">
            ${unlockBtn}
            <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotCls}" title="${user.status}"></span>
        </div>
    </li>`;
}

function renderUserList(users) {
    const container = document.getElementById('userList');
    const badge = document.getElementById('users-count-badge');
    if (!container) return;
    if (badge) badge.textContent = `${users.length} compte${users.length !== 1 ? 's' : ''}`;
    if (!users.length) {
        container.innerHTML = `<li class="px-3 py-8 text-center text-xs text-gray-400">Aucun utilisateur trouvé</li>`;
        return;
    }
    container.innerHTML = users.map(renderUserItem).join('');
    if (window.lucide) lucide.createIcons();
}

function filterUserList(query) {
    if (!_allUsers.length) return;
    const q = query.trim().toLowerCase();
    const filtered = q
        ? _allUsers.filter(u => u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.role || '').toLowerCase().includes(q))
        : _allUsers;
    renderUserList(filtered);
}

async function loadUsersList() {
    const container = document.getElementById('userList');
    if (!container) return;
    container.innerHTML = `<li class="px-3 py-6 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
        <svg class="animate-spin w-3.5 h-3.5 text-orange-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
        Chargement…</li>`;
    try {
        const res = await secureFetch('/api/users/list');
        if (!res || !res.ok) throw new Error('HTTP ' + (res?.status || '?'));
        _allUsers = await res.json();
        renderUserList(_allUsers);
    } catch (err) {
        console.error('Failed to load users:', err);
        container.innerHTML = `<li class="px-3 py-4 text-center text-xs text-red-500">Erreur de chargement</li>`;
    }
}

async function unlockUser(username) {
    if (!confirm(`Déverrouiller le compte de ${username} ?`)) return;
    try {
        const res = await secureFetch(`/api/auth/unlock/${encodeURIComponent(username)}`, { method: 'POST' });
        if (!res) return;
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showSnackbar(`Compte ${username} déverrouillé`, 'success');
            await loadUsersList();
        } else {
            showSnackbar(data.message || 'Échec du déverrouillage.', 'error');
        }
    } catch { showSnackbar('Erreur réseau.', 'error'); }
}

// ── Country rendering ─────────────────────────────────────────────────────────

function renderCountryItem(c) {
    const { name, flag } = getCountryData(c.code);
    return `
    <li class="group flex items-center justify-between p-2.5 rounded-md hover:bg-gray-50 transition-colors" data-code="${c.code}">
        <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">${flag}</div>
            <div>
                <div class="text-xs font-semibold text-gray-800">${name}</div>
                <div class="text-[10px] text-gray-400 font-mono">${c.code} · ${c.companyId}</div>
            </div>
        </div>
        <button class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 rounded transition-all"
                data-delete-country="${c.code}" aria-label="Supprimer ${c.code}">
            <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
        </button>
    </li>`;
}

async function loadCountries() {
    const select = document.getElementById('userCountry');
    const listEl = document.getElementById('countryList');
    try {
        const res = await secureFetch('/api/country/list');
        if (!res || !res.ok) return;
        const countries = await res.json();

        if (select) {
            select.innerHTML = '<option value="">— Pays —</option>' +
                countries.map(c => {
                    const { name } = getCountryData(c.code);
                    return `<option value="${c.code}">${name} (${c.companyId})</option>`;
                }).join('');
        }
        if (listEl) {
            listEl.innerHTML = countries.length
                ? countries.map(renderCountryItem).join('')
                : '<li class="text-xs text-gray-400 py-3 text-center">Aucun pays configuré</li>';
            if (window.lucide) lucide.createIcons();
        }
    } catch (err) { console.error('Failed to load countries:', err); }
}

// ── Department rendering ──────────────────────────────────────────────────────

function renderDeptItem(d) {
    return `
    <li class="group flex items-center justify-between p-2.5 rounded-md hover:bg-gray-50 transition-colors" data-code="${d.code}">
        <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-md bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0 text-[10px] font-semibold text-gray-500">${d.code}</div>
            <span class="text-xs font-medium text-gray-800">${d.description}</span>
        </div>
        <button class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 rounded transition-all"
                data-delete-dept="${d.code}" aria-label="Supprimer ${d.code}">
            <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i>
        </button>
    </li>`;
}

async function loadDepartments() {
    const listEl  = document.getElementById('departmentList');
    const selectEl = document.getElementById('department');
    try {
        const res = await secureFetch('/api/departments/list');
        if (!res || !res.ok) return;
        const departments = await res.json();

        if (selectEl) {
            selectEl.innerHTML = '<option value="">— Département —</option>' +
                departments.map(d => `<option value="${d.code}">${d.code} - ${d.description}</option>`).join('');
        }
        if (listEl) {
            listEl.innerHTML = departments.length
                ? departments.map(renderDeptItem).join('')
                : '<li class="text-xs text-gray-400 py-3 text-center">Aucun département configuré</li>';
            if (window.lucide) lucide.createIcons();
        }
    } catch (err) { console.error('Failed to load departments:', err); }
}

// ── Applications ──────────────────────────────────────────────────────────────

async function loadApplications() {
    try {
        const res = await secureFetch('/api/applications');
        if (!res || !res.ok) return;
        const apps = await res.json();
        const container = document.getElementById('appList');
        if (!container) return;

        container.innerHTML = apps.map(app => `
            <li data-app="${app.code}" data-desc="${app.label || ''}"
                class="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors text-xs text-gray-700 border-l-2 border-transparent app-list-item">
                <span class="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"></span>
                ${app.code}
            </li>`).join('');

        container.querySelectorAll('.app-list-item').forEach(li => {
            li.addEventListener('click', () => {
                container.querySelectorAll('.app-list-item').forEach(i => {
                    i.classList.remove('bg-orange-50', 'text-orange-700', 'border-orange-500', 'font-medium');
                    i.classList.add('border-transparent');
                });
                li.classList.add('bg-orange-50', 'text-orange-700', 'border-orange-500', 'font-medium');
                li.classList.remove('border-transparent');
                selectApplication(li.dataset.app, li.dataset.desc);
            });
        });

        // Auto-select first
        if (apps.length) {
            const first = container.querySelector('.app-list-item');
            if (first) first.click();
        }
    } catch (err) { console.error('Failed to load applications:', err); }
}

async function selectApplication(appName, description) {
    document.getElementById('appNameDisplay').value = appName;
    document.getElementById('appDescription').value = description || '';
    const container = document.getElementById('schemaContainer');
    if (!container) return;
    container.innerHTML = `<div class="flex items-center gap-2 text-xs text-gray-400 py-4"><svg class="animate-spin w-3.5 h-3.5 text-orange-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Chargement du schéma…</div>`;
    try {
        const res = await secureFetch(`/api/applications/${appName}/fields`);
        if (!res || !res.ok) throw new Error('HTTP ' + res?.status);
        const data = await res.json();
        renderApplicationSchema(data);
    } catch (err) {
        container.innerHTML = `<p class="text-xs text-red-500 py-3">Erreur chargement schéma</p>`;
    }
}

function renderApplicationSchema(data) {
    const container = document.getElementById('schemaContainer');
    if (!container) return;

    const mandatory = data.mandatory || [];
    const optional  = data.optional  || [];

    if (!mandatory.length && !optional.length) {
        container.innerHTML = `<p class="text-xs text-gray-400 py-4 text-center">Aucun champ défini</p>`;
        return;
    }

    const tag = (f, req) => `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] m-0.5 ${req ? 'bg-orange-50 border-orange-200 text-orange-800' : 'bg-gray-50 border-gray-200 text-gray-600'}">
            ${req ? '<span style="width:5px;height:5px;border-radius:50%;background:#e86e00;display:inline-block;flex-shrink:0;"></span>' : ''}
            ${f.fieldName}
        </span>`;

    container.innerHTML = `
        <div>
            <div class="flex items-center gap-2 mb-2">
                <p class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Schéma des champs</p>
                <span class="text-[9px] text-gray-400">${mandatory.length} requis · ${optional.length} optionnels</span>
            </div>
            <div class="flex flex-wrap">
                ${mandatory.map(f => tag(f, true)).join('')}
                ${optional.map(f => tag(f, false)).join('')}
            </div>
            <div class="mt-3 flex items-center gap-4 text-[10px] text-gray-400">
                <span class="flex items-center gap-1"><span style="width:5px;height:5px;border-radius:50%;background:#e86e00;display:inline-block;"></span> Obligatoire</span>
                <span class="flex items-center gap-1"><span style="width:5px;height:5px;border-radius:50%;background:#d1d5db;display:inline-block;"></span> Optionnel</span>
            </div>
        </div>`;
}

// ── Form submissions ──────────────────────────────────────────────────────────



// Username availability check
let _usernameTimer = null;
document.getElementById('username')?.addEventListener('input', e => {
    const val = e.target.value.trim().toUpperCase();
    const hint = document.getElementById('usernameHint');
    if (!hint) return;
    if (val.length < 3) { hint.textContent = ''; return; }
    clearTimeout(_usernameTimer);
    hint.textContent = '…'; hint.style.color = '#9ca3af';
    _usernameTimer = setTimeout(async () => {
        try {
            const res = await secureFetch(`/api/users/exists?username=${encodeURIComponent(val)}`);
            if (!res || !res.ok) return;
            const data = await res.json();
            hint.textContent = data.taken ? '✗ Identifiant déjà pris' : '✓ Disponible';
            hint.style.color  = data.taken ? '#dc2626' : '#16a34a';
        } catch { hint.textContent = ''; }
    }, 450);
});


// Email required toggle
function updateEmailRequirement() {
    const role = document.getElementById('role')?.value;
    const emailInput = document.getElementById('userEmail');
    const req = document.getElementById('emailRequiredMark');
    const opt = document.getElementById('emailOptionalNote');
    const hint = document.getElementById('emailHint');
    if (!emailInput) return;
    const isAdmin = role === 'ADMIN';
    emailInput.required = !isAdmin;
    if (req)  req.classList.toggle('hidden', isAdmin);
    if (opt)  opt.classList.toggle('hidden', !isAdmin);
    if (hint) hint.textContent = isAdmin ? 'Optionnel pour le rôle ADMIN' : 'Requis pour MFA et réinitialisation du mot de passe';
}

// User form
document.getElementById('userForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const username   = document.getElementById('username')?.value.trim().toUpperCase();
    const role       = document.getElementById('role')?.value;
    const country    = document.getElementById('userCountry')?.value;
    const department = parseInt(document.getElementById('department')?.value);
    const email      = document.getElementById('userEmail')?.value.trim();

    if (!username || !role || !country || !department) {
        showSnackbar('Tous les champs obligatoires sont requis', 'error');
        return;
    }

    const btn = document.getElementById('createUserBtn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> Création…';

    try {
        const res = await secureFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, role, country, department, email: email || null }),
        });
        if (res && res.ok) {
            showSnackbar('Utilisateur créé avec succès !', 'success');
            e.target.reset();
            document.getElementById('usernameHint').textContent = '';
            updateEmailRequirement();
            await loadUsersList();
        } else {
            showSnackbar(await parseErrorResponse(res), 'error');
        }
    } catch { showSnackbar('Erreur réseau', 'error'); }
    finally {
        btn.disabled = false;
        btn.innerHTML = orig;
        if (window.lucide) lucide.createIcons();
    }
});

// Country form
document.getElementById('countryForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const code      = document.getElementById('countryCode')?.value.trim().toUpperCase();
    const companyId = document.getElementById('companyId')?.value.trim();
    if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) { showSnackbar('Code pays: 2 lettres majuscules', 'error'); return; }
    if (!companyId) { showSnackbar('Company ID requis', 'error'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.innerHTML; btn.disabled = true; btn.textContent = 'Ajout…';
    try {
        const res = await secureFetch('/api/country', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, companyId }),
        });
        if (res && res.ok) { showSnackbar('Pays ajouté !', 'success'); e.target.reset(); await loadCountries(); }
        else showSnackbar(await parseErrorResponse(res), 'error');
    } catch { showSnackbar('Erreur réseau', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = orig; if (window.lucide) lucide.createIcons(); }
});

// Department form
document.getElementById('departmentForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const code = parseInt(document.getElementById('deptCode')?.value.trim(), 10);
    const description = document.getElementById('deptDesc')?.value.trim();
    if (!code || code <= 0) { showSnackbar('Code département: nombre positif', 'error'); return; }
    if (!description) { showSnackbar('Description requise', 'error'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.innerHTML; btn.disabled = true; btn.textContent = 'Création…';
    try {
        const res = await secureFetch('/api/departments', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, description }),
        });
        if (res && res.ok) { showSnackbar('Département créé !', 'success'); e.target.reset(); await loadDepartments(); }
        else showSnackbar(await parseErrorResponse(res), 'error');
    } catch { showSnackbar('Erreur réseau', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = orig; if (window.lucide) lucide.createIcons(); }
});

// ── Delete delegation ─────────────────────────────────────────────────────────

document.addEventListener('click', async e => {
    const countryBtn = e.target.closest('[data-delete-country]');
    const deptBtn    = e.target.closest('[data-delete-dept]');
    if (!countryBtn && !deptBtn) return;

    if (countryBtn) {
        const code = countryBtn.dataset.deleteCountry;
        if (!confirm(`Supprimer le pays ${code} ?`)) return;
        try {
            const res = await secureFetch(`/api/country/${code}`, { method: 'DELETE' });
            if (res && res.ok) { showSnackbar(`Pays ${code} supprimé`, 'success'); await loadCountries(); }
            else showSnackbar(await parseErrorResponse(res), 'error');
        } catch { showSnackbar('Erreur réseau', 'error'); }
        return;
    }

    if (deptBtn) {
        const code = deptBtn.dataset.deleteDept;
        if (!confirm(`Supprimer le département ${code} ?`)) return;
        try {
            const res = await secureFetch(`/api/departments/${code}`, { method: 'DELETE' });
            if (res && res.ok) { showSnackbar(`Département ${code} supprimé`, 'success'); await loadDepartments(); }
            else showSnackbar(await parseErrorResponse(res), 'error');
        } catch { showSnackbar('Erreur réseau', 'error'); }
    }
});

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('role')?.addEventListener('change', updateEmailRequirement);
    updateEmailRequirement();
    loadCountries();
    loadDepartments();
    loadUsersList();
    loadApplications();
    loadPasswordPolicy();
    loadSecurityUserList();
});

// ── Security tab — Password Policy ───────────────────────────────────────────

async function loadPasswordPolicy() {
    try {
        const res = await secureFetch('/api/admin/policy');
        if (!res || !res.ok) return;
        const p = await res.json();
        const ml = document.getElementById('pol-minLength');
        const d  = document.getElementById('pol-digit');
        const u  = document.getElementById('pol-upper');
        const s  = document.getElementById('pol-special');
        if (ml) ml.value = p.minLength || 10;
        if (d)  d.checked = p.requireDigit !== false;
        if (u)  u.checked = p.requireUppercase !== false;
        if (s)  s.checked = p.requireSpecial !== false;
        updatePolicyPreview();
    } catch(e) { console.error('Policy load error', e); }
}

function updatePolicyPreview() {
    const len   = document.getElementById('pol-minLength')?.value || 10;
    const digit = document.getElementById('pol-digit')?.checked;
    const upper = document.getElementById('pol-upper')?.checked;
    const spec  = document.getElementById('pol-special')?.checked;
    const rules = [`Min. ${len} caractères`];
    if (digit) rules.push('chiffre requis');
    if (upper) rules.push('majuscule requise');
    if (spec)  rules.push('caractère spécial requis');
    const prev = document.getElementById('pol-preview');
    if (prev) prev.textContent = rules.join(' · ');
}

['pol-minLength','pol-digit','pol-upper','pol-special'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updatePolicyPreview);
    document.getElementById(id)?.addEventListener('input', updatePolicyPreview);
});

document.getElementById('savePolicyBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('savePolicyBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.textContent = 'Enregistrement…';
    try {
        const res = await secureFetch('/api/admin/policy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                minLength:        parseInt(document.getElementById('pol-minLength')?.value) || 10,
                requireDigit:     document.getElementById('pol-digit')?.checked   || false,
                requireUppercase: document.getElementById('pol-upper')?.checked   || false,
                requireSpecial:   document.getElementById('pol-special')?.checked || false,
            })
        });
        if (res && res.ok) {
            showSnackbar('Politique de mot de passe enregistrée', 'success');
            const ok = document.getElementById('pol-success');
            if (ok) { ok.classList.remove('hidden'); setTimeout(() => ok.classList.add('hidden'), 4000); }
        } else {
            const d = await res?.json().catch(()=>({}));
            showSnackbar(d.message || 'Erreur lors de la sauvegarde', 'error');
        }
    } catch(e) { showSnackbar('Erreur réseau', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = orig; if(window.lucide) lucide.createIcons(); }
});

// ── Security tab — Lock/Unlock users ─────────────────────────────────────────

let _secUsers = [];

async function loadSecurityUserList() {
    const list = document.getElementById('sec-user-list');
    if (!list) return;
    list.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Chargement…</p>';
    try {
        const res = await secureFetch('/api/users/list');
        if (!res || !res.ok) throw new Error();
        _secUsers = await res.json();
        renderSecurityList(_secUsers);
    } catch(e) {
        list.innerHTML = '<p class="text-xs text-red-500 py-2 text-center">Erreur de chargement</p>';
    }
}

function filterSecurityList(q) {
    const query = q.trim().toLowerCase();
    renderSecurityList(query ? _secUsers.filter(u =>
        u.username.toLowerCase().includes(query) || (u.role||'').toLowerCase().includes(query)
    ) : _secUsers);
}

function renderSecurityList(users) {
    const list = document.getElementById('sec-user-list');
    if (!list) return;
    if (!users.length) { list.innerHTML = '<p class="text-xs text-gray-400 py-2 text-center">Aucun utilisateur</p>'; return; }

    const roleLabel = { ADMIN: 'Admin', INPUTTER: 'Initiateur', AUTHORISER: 'Validateur' };
    const statusDot = { ACTIVE: 'bg-green-400', LOCKED: 'bg-red-500', PENDING: 'bg-yellow-400' };
    const currentUser = sessionStorage.getItem('username') || '';

    list.innerHTML = users.map(u => {
        const isLocked  = u.status === 'LOCKED';
        const isSelf    = u.username === currentUser;
        const dotCls    = statusDot[u.status] || 'bg-gray-300';
        const initials  = u.username.slice(0,2).toUpperCase();
        const avatarCls = isLocked ? 'bg-red-50 border-red-200 text-red-600' : 'bg-orange-50 border-orange-200 text-orange-600';
        const actionBtn = isSelf ? '' : isLocked
            ? `<button onclick="secToggleLock('${u.username}', false)"
                       class="text-[10px] bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded transition font-medium">
                   🔓 Déverrouiller
               </button>`
            : `<button onclick="secToggleLock('${u.username}', true)"
                       class="text-[10px] bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded transition font-medium">
                   🔒 Verrouiller
               </button>`;

        return `<div class="flex items-center justify-between p-2 rounded-md hover:bg-gray-50 transition">
            <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-full border flex items-center justify-center text-[10px] font-semibold flex-shrink-0 ${avatarCls}">${initials}</div>
                <div>
                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-semibold text-gray-900">${u.username}</span>
                        <span class="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">${roleLabel[u.role]||u.role}</span>
                    </div>
                    <div class="flex items-center gap-1 mt-0.5">
                        <span class="w-1.5 h-1.5 rounded-full ${dotCls}"></span>
                        <span class="text-[10px] text-gray-400">${u.status}</span>
                        ${u.failedLoginCount > 0 ? `<span class="text-[9px] text-red-500">(${u.failedLoginCount} tentatives)</span>` : ''}
                    </div>
                </div>
            </div>
            ${actionBtn}
        </div>`;
    }).join('');
}

async function secToggleLock(username, lock) {
    const action = lock ? 'verrouiller' : 'déverrouiller';
    if (!confirm(`${lock ? 'Verrouiller' : 'Déverrouiller'} le compte de ${username} ?`)) return;
    try {
        const endpoint = lock ? 'lock' : 'unlock';
        const res = await secureFetch(`/api/auth/${endpoint}/${encodeURIComponent(username)}`, { method: 'POST' });
        if (!res) return;
        const data = await res.json().catch(()=>({}));
        if (res.ok) {
            showSnackbar(`Compte ${username} ${lock ? 'verrouillé' : 'déverrouillé'}`, 'success');
            await loadSecurityUserList();
            await loadUsersList(); // Refresh main user list too
        } else {
            showSnackbar(data.message || `Impossible de ${action} ce compte`, 'error');
        }
    } catch(e) { showSnackbar('Erreur réseau', 'error'); }
}