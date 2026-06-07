// settings.js - COMPLETE VERSION WITH FLAG FIX

/**
 * Get country data with flagcdn.com images
 * Works on ALL browsers - no 404 errors
 */
const getCountryData = (code) => {
    try {
        const regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
        const name = regionNames.of(code.toUpperCase()) || code.toUpperCase();

        // ✅ Use flagcdn.com images - no local files needed
        const codeL = code.toLowerCase();
        const flag = `<img src="https://flagcdn.com/16x12/${codeL}.png"
                           srcset="https://flagcdn.com/32x24/${codeL}.png 2x"
                           width="16"
                           height="12"
                           alt="${code}"
                           style="display: inline-block; vertical-align: middle;">`;

        return { name, flag };
    } catch {
        return {
            name: code,
            flag: ''
        };
    }
};

function togglePasswordVisibility() {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');
    if (!passwordInput || !eyeIcon) return;

    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    eyeIcon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');

    if (window.lucide) lucide.createIcons();
}

// ────────────────────────────────────────────────
// Centralized error parser
// ────────────────────────────────────────────────

/**
 * Parse error response and extract user-friendly message
 * Handles:
 *  1. Bean Validation errors (violations array)
 *  2. Structured errors with code/message/title
 *  3. Plain text fallback
 */
async function parseErrorResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    let errorMessage = `Erreur ${res.status}`;

    try {
        if (contentType.includes('application/json')) {
            const errorData = await res.json();

            // Bean Validation style
            if (errorData.violations && Array.isArray(errorData.violations)) {
                const messages = errorData.violations
                    .map((v) => v.message)
                    .filter(Boolean);
                if (messages.length > 0) return messages.join('\n');
            }

            // Structured error
            return (
                errorData.title ||
                errorData.message ||
                errorData.error ||
                errorMessage
            );
        }

        const text = await res.text();
        return text.trim() || errorMessage;
    } catch (err) {
        console.error('Failed to parse error response:', err);
        return errorMessage;
    }
}

// ────────────────────────────────────────────────
// UI Helpers
// ────────────────────────────────────────────────

function renderUserItem(user) {
    const { flag } = getCountryData(user.countryCode);

    const statusColor = {
        ACTIVE:  'bg-green-100 text-green-800',
        PENDING: 'bg-yellow-100 text-yellow-800',
        LOCKED:  'bg-red-100 text-red-800',
    }[user.status] || 'bg-gray-100 text-gray-600';

    const pwdBadge = user.mustChangePassword
        ? '<span class="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">Pwd à changer</span>'
        : '';

    const unlockBtn = user.status === 'LOCKED'
        ? `<button onclick="unlockUser('${user.username}')"
                  class="text-[10px] bg-red-600 hover:bg-red-700 text-white px-2 py-0.5 rounded font-medium transition flex items-center gap-1">
               🔓 Déverrouiller
           </button>`
        : '';

    return `
    <li class="group flex items-center justify-between p-3 mb-2 bg-white border border-gray-200 rounded-lg hover:shadow-sm hover:border-orange-400 transition-all duration-200">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-full shadow-xs border border-gray-100 group-hover:scale-110 transition-transform">
            ${flag}
        </div>
        <div class="flex flex-col gap-0.5">
            <span class="text-sm font-bold text-gray-900">${user.username}</span>
            <span class="text-xs text-gray-400 font-medium uppercase">${user.countryCode}</span>
            ${user.email ? `<span class="text-[10px] text-gray-400">${user.email}</span>` : ''}
        </div>
    </div>
    <div class="text-right flex flex-col items-end gap-1">
        <span class="text-xs ${statusColor} px-2 py-0.5 rounded-full font-medium">${user.status || 'ACTIVE'}</span>
        <span class="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">${user.role}</span>
        ${pwdBadge}
        ${unlockBtn}
    </div>
</li>`;
}

async function unlockUser(username) {
    if (!confirm(`Déverrouiller le compte de ${username} ?`)) return;
    try {
        const res = await secureFetch(`/api/auth/unlock/${encodeURIComponent(username)}`, { method: 'POST' });
        if (!res) return;
        const data = await res.json();
        if (res.ok) {
            showSnackbar(`Compte ${username} déverrouillé avec succès.`, 'success');
            // Refresh user list
            const container = document.getElementById('userList');
            if (container) {
                const listRes = await secureFetch('/api/users/list');
                if (listRes && listRes.ok) {
                    const users = await listRes.json();
                    container.innerHTML = users.map(renderUserItem).join('');
                    lucide.createIcons();
                }
            }
        } else {
            showSnackbar(data.message || 'Échec du déverrouillage.', 'error');
        }
    } catch (err) {
        showSnackbar('Erreur réseau.', 'error');
    }
}

// ────────────────────────────────────────────────
// Country Management
// ────────────────────────────────────────────────

document.getElementById('countryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (!btn) return;

    const code = document.getElementById('countryCode')?.value.trim().toUpperCase();
    const companyId = document.getElementById('companyId')?.value.trim();

    if (!code || code.length !== 2 || !/^[A-Z]{2}$/.test(code)) {
        showSnackbar("Le code pays doit être exactement 2 lettres majuscules", "error");
        return;
    }
    if (!companyId) {
        showSnackbar("Le Company ID est requis", "error");
        return;
    }

    const payload = { code, companyId };
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = "Création...";

    try {
        const res = await secureFetch(`/api/country`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            showSnackbar("Pays créé avec succès !", "success");
            e.target.reset();
            await loadCountries();
        } else {
            const msg = await parseErrorResponse(res);
            showSnackbar(msg, "error");
        }
    } catch (err) {
        console.error('Country creation failed:', err);
        showSnackbar("Erreur de connexion", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// ────────────────────────────────────────────────
// User Management
// ────────────────────────────────────────────────

// Password strength meter (settings form)
const SPECIAL_CHARS = '!@#$%^&*()_+-=[]{}|;\':\",./<>?';
let _pwdPolicy = { minLength: 10, requireDigit: true, requireUppercase: true, requireSpecial: true };
fetch('/api/auth/password-policy').then(r => r.json()).then(p => { _pwdPolicy = p; }).catch(() => {});

function checkSettingsStrength(val) {
    const p = _pwdPolicy;
    const ok = { length: val.length >= p.minLength,
                 upper: !p.requireUppercase || /[A-Z]/.test(val),
                 digit: !p.requireDigit || /\d/.test(val),
                 special: !p.requireSpecial || SPECIAL_CHARS.split('').some(c => val.includes(c)),
                 space: !val.includes(' ') };
    const score = Object.values(ok).filter(Boolean).length;
    const bar = document.getElementById('settingsMeterBar');
    const label = document.getElementById('settingsMeterLabel');
    if (!bar || !label) return;
    bar.style.width = (score / 5 * 100) + '%';
    const [c, t] = score <= 2 ? ['#ef4444','Trop faible'] : score === 3 ? ['#f59e0b','Moyen'] : score === 4 ? ['#3b82f6','Bon'] : ['#22c55e','Excellent'];
    bar.style.background = c; label.textContent = t; label.style.color = c;
}

document.getElementById('password')?.addEventListener('input', e => checkSettingsStrength(e.target.value));

// Real-time username availability check (debounced)
let _usernameCheckTimer = null;
document.getElementById('username')?.addEventListener('input', (e) => {
    const val = e.target.value.trim().toUpperCase();
    const hint = document.getElementById('usernameHint');
    if (!hint) return;
    if (val.length < 3) { hint.textContent = ''; return; }
    clearTimeout(_usernameCheckTimer);
    hint.textContent = '...';
    hint.style.color = '#6b7280';
    _usernameCheckTimer = setTimeout(async () => {
        try {
            const res = await secureFetch(`/api/users/exists?username=${encodeURIComponent(val)}`);
            if (!res || !res.ok) return;
            const data = await res.json();
            if (data.taken) { hint.textContent = '✗ Nom d\'utilisateur déjà pris'; hint.style.color = '#dc2626'; }
            else { hint.textContent = '✓ Disponible'; hint.style.color = '#16a34a'; }
        } catch { hint.textContent = ''; }
    }, 450);
});

document.getElementById('userForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username   = document.getElementById('username')?.value.trim().toUpperCase();
    const password   = document.getElementById('password')?.value;
    const role       = document.getElementById('role')?.value;
    const country    = document.getElementById('userCountry')?.value;
    const department = parseInt(document.getElementById('department')?.value);
    const email      = document.getElementById('userEmail')?.value.trim();

    if (!username || !password || !role || !country || !department) {
        showSnackbar("Tous les champs obligatoires doivent être remplis", "error");
        return;
    }

    const btn = document.getElementById('createUserBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Création...";

    try {
        const res = await secureFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role, country, department, email: email || null }),
        });

        if (res.ok) {
            const createdUser = await res.json();
            showSnackbar("Utilisateur créé avec succès !", "success");
            const container = document.getElementById('userList');
            if (container) {
                container.insertAdjacentHTML('afterbegin', renderUserItem(createdUser));
                if (window.lucide) lucide.createIcons();
            }
            e.target.reset();
            const hint = document.getElementById('usernameHint');
            if (hint) hint.textContent = '';
            const bar = document.getElementById('settingsMeterBar');
            const label = document.getElementById('settingsMeterLabel');
            if (bar) bar.style.width = '0';
            if (label) label.textContent = '';
        } else {
            const msg = await parseErrorResponse(res);
            showSnackbar(msg, "error");
        }
    } catch (err) {
        console.error('User creation failed:', err);
        showSnackbar("Erreur réseau", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// ────────────────────────────────────────────────
// Department Management
// ────────────────────────────────────────────────

document.getElementById('departmentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (!btn) return;

    const codeInput = document.getElementById('deptCode')?.value.trim();
    const description = document.getElementById('deptDesc')?.value.trim();

    const code = parseInt(codeInput, 10);
    if (!codeInput || isNaN(code) || code <= 0) {
        showSnackbar("Le code département doit être un nombre positif", "error");
        return;
    }
    if (!description) {
        showSnackbar("La description est requise", "error");
        return;
    }

    const payload = { code, description };
    const originalText = btn.textContent;

    btn.disabled = true;
    btn.textContent = "Création...";

    try {
        const res = await secureFetch(`/api/departments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            showSnackbar("Département créé avec succès !", "success");
            e.target.reset();
            await loadDepartments();
        } else {
            const msg = await parseErrorResponse(res);
            showSnackbar(msg, "error");
        }
    } catch (err) {
        console.error('Department creation failed:', err);
        showSnackbar("Erreur de connexion", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// ────────────────────────────────────────────────
// Data Loaders
// ────────────────────────────────────────────────

async function loadCountries() {
    const select = document.getElementById('userCountry');
    const listEl = document.getElementById('countryList');

    try {
        const res = await secureFetch(`/api/country/list`);
        if (!res.ok) return;
        const countries = await res.json();

        // Dropdown
        if (select) {
            select.innerHTML =
                '<option value="">-- Sélectionner un pays --</option>' +
                countries
                    .map((c) => {
                        const { name } = getCountryData(c.code);
                        return `<option value="${c.code}">${name} (${c.companyId})</option>`;
                    })
                    .join('');
        }

        // List with delete buttons
        if (listEl) {
            listEl.innerHTML = countries
                .map((c) => {
                    const { name, flag } = getCountryData(c.code);
                    return `
<li class="group flex items-center justify-between p-3 mb-2 bg-white border border-gray-200 rounded-lg hover:shadow-sm hover:border-orange-400 transition-all duration-200" data-code="${c.code}">
    <div class="flex items-center gap-4">
        <div class="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-full shadow-xs border border-gray-100 group-hover:scale-110 transition-transform">
            ${flag}
        </div>
        <div class="flex flex-col">
            <span class="text-sm font-bold text-gray-900 group-hover:text-brand-primary transition-colors">
                ${name}
            </span>
            <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                ISO: ${c.code}
            </span>
        </div>
    </div>
    <div class="flex items-center gap-3">
        <span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 font-mono border border-gray-200 group-hover:bg-blue-50 group-hover:text-blue-700 group-hover:border-blue-100 transition-colors">
            <i data-lucide="building-2" class="w-3 h-3 mr-1.5 opacity-50"></i>
            ${c.companyId}
        </span>
        <button
            class="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-full transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none"
            data-delete-country="${c.code}"
            title="Supprimer ce pays"
            aria-label="Supprimer le pays ${c.code}">
            <i data-lucide="trash-2" class="w-5 h-5"></i>
        </button>
    </div>
</li>`;
                })
                .join('');

            if (window.lucide) lucide.createIcons();
        }
    } catch (err) {
        console.error("Failed to load countries:", err);
    }
}

async function loadUsersList() {
    const container = document.getElementById('userList');
    if (!container) return;

    try {
        const res = await secureFetch(`/api/users/list`);
        if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

        const users = await res.json();
        container.innerHTML = users.map(renderUserItem).join('');
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error("Failed to load users:", err);
        showSnackbar("Erreur lors de la récupération des utilisateurs", "error");
    }
}

async function loadDepartments() {
    const listEl = document.getElementById('departmentList');
    const selectEl = document.getElementById('department');

    try {
        const res = await secureFetch(`/api/departments/list`);
        if (!res.ok) return;
        const departments = await res.json();

        // Select for user form
        if (selectEl) {
            selectEl.innerHTML = `
<option value="">-- Sélectionner un département --</option>
${departments
    .map((d) => `<option value="${d.code}">${d.code} - ${d.description}</option>`)
    .join('')}
`;
        }

        // Admin list with delete buttons
        if (listEl) {
            listEl.innerHTML = departments
                .map((d) => `
<li class="group flex items-center justify-between p-3 mb-2 bg-white border border-gray-200 rounded-lg hover:shadow-md hover:border-orange-400 transition-all" data-code="${d.code}">
    <div>
        <div class="text-sm font-bold text-gray-900 group-hover:text-brand-primary transition-colors">
            ${d.description}
        </div>
        <div class="text-[10px] font-mono text-gray-500">Code: ${d.code}</div>
    </div>
    <button
        class="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-full transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none"
        data-delete-dept="${d.code}"
        title="Supprimer ce département"
        aria-label="Supprimer le département ${d.code}">
        <i data-lucide="trash-2" class="w-5 h-5"></i>
    </button>
</li>`)
                .join('');
        }

        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error("Failed to load departments:", err);
    }
}

// ────────────────────────────────────────────────
// Delete handling (event delegation)
// ────────────────────────────────────────────────

document.addEventListener('click', async function handleDelete(e) {
    const countryBtn = e.target.closest('[data-delete-country]');
    const deptBtn = e.target.closest('[data-delete-dept]');

    if (!countryBtn && !deptBtn) return;

    // ── Country delete ───────────────────────────────────────
    if (countryBtn) {
        const code = countryBtn.dataset.deleteCountry;
        if (!code) return;

        if (!confirm(`Voulez-vous vraiment supprimer le pays ${code} ?`)) return;

        const li = countryBtn.closest('li');
        const originalHTML = li.innerHTML;
        li.innerHTML = `
<div class="flex justify-center py-4">
    <svg class="animate-spin h-6 w-6 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8h8a8 8 0 01-16 0z"></path>
    </svg>
</div>`;

        try {
            const res = await secureFetch(`/api/country/${code}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json' },
            });

            if (res.ok) {
                showSnackbar(`Pays ${code} supprimé avec succès`, "success");
                li.remove();
                await loadCountries(); // refresh dropdown too
            } else {
                const msg = await parseErrorResponse(res);
                showSnackbar(msg || "Impossible de supprimer ce pays", "error");
                li.innerHTML = originalHTML;
                if (window.lucide) lucide.createIcons();
            }
        } catch (err) {
            console.error("Country delete failed:", err);
            showSnackbar("Erreur lors de la suppression", "error");
            li.innerHTML = originalHTML;
            if (window.lucide) lucide.createIcons();
        }
        return;
    }

    // ── Department delete ────────────────────────────────────
    if (deptBtn) {
        const code = deptBtn.dataset.deleteDept;
        if (!code) return;

        if (!confirm(`Voulez-vous vraiment supprimer le département ${code} ?`)) return;

        const li = deptBtn.closest('li');
        const originalHTML = li.innerHTML;
        li.innerHTML = `
<div class="flex justify-center py-4">
    <svg class="animate-spin h-6 w-6 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8h8a8 8 0 01-16 0z"></path>
    </svg>
</div>`;

        try {
            const res = await secureFetch(`/api/departments/${code}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json' },
            });

            if (res.ok) {
                showSnackbar(`Département ${code} supprimé`, "success");
                li.remove();
                await loadDepartments(); // refresh select too
            } else {
                const msg = await parseErrorResponse(res);
                showSnackbar(msg || "Impossible de supprimer ce département", "error");
                li.innerHTML = originalHTML;
                if (window.lucide) lucide.createIcons();
            }
        } catch (err) {
            console.error("Department delete failed:", err);
            showSnackbar("Erreur lors de la suppression", "error");
            li.innerHTML = originalHTML;
            if (window.lucide) lucide.createIcons();
        }
    }
});

// ────────────────────────────────────────────────
// Applications (unchanged for now)
// ────────────────────────────────────────────────

function renderAppItem(app) {
    return `
<li data-app="${app.code}" data-desc="${app.label || ''}"
    class="cursor-pointer p-3 hover:bg-gray-50 flex justify-between">
    <span>${app.code}</span>
    <span class="text-xs text-gray-400">${app.label || ''}</span>
</li>`;
}

async function loadApplications() {
    try {
        const res = await secureFetch('/api/applications');
        if (!res.ok) return;

        const apps = await res.json();
        const container = document.getElementById('appList');
        if (!container) return;

        container.innerHTML = apps.map(renderAppItem).join('');

        container.querySelectorAll('li').forEach((li) => {
            li.addEventListener('click', () => {
                selectApplication(li.dataset.app, li.dataset.desc);
            });
        });
    } catch (err) {
        console.error("Failed to load applications:", err);
    }
}

async function selectApplication(appName, description) {
    document.getElementById('appNameDisplay').value = appName;
    document.getElementById('appDescription').value = description || '';

    try {
        const res = await secureFetch(`/api/applications/${appName}/fields`);
        if (!res.ok) {
            showSnackbar("Erreur chargement schéma", "error");
            return;
        }
        const data = await res.json();
        renderApplicationSchema(data);
    } catch (err) {
        console.error("Failed to load schema:", err);
        showSnackbar("Erreur chargement schéma", "error");
    }
}

function renderApplicationSchema(data) {
    let container = document.getElementById('schemaContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'schemaContainer';
        container.className = 'mt-6 space-y-6';
        document.getElementById('appDescription')?.parentElement?.appendChild(container);
    }

    container.innerHTML = `
${renderSchemaSection("Champs obligatoires", data.mandatory || [])}
${renderSchemaSection("Champs optionnels", data.optional || [])}
`;
}

function renderSchemaSection(title, fields) {
    if (!fields.length) {
        return `<div class="text-sm text-gray-400">${title} : aucun champ</div>`;
    }

    return `
<div class="border rounded">
    <div class="px-4 py-2 bg-gray-50 font-semibold text-sm">${title}</div>
    <table class="w-full text-sm">
        <tbody>
            ${fields
                .map(
                    (f) => `
<tr class="border-t">
    <td class="px-4 py-2 font-mono">${f.fieldName}</td>
    <td class="px-4 py-2">${f.dataType}</td>
</tr>`
                )
                .join('')}
        </tbody>
    </table>
</div>`;
}

// ────────────────────────────────────────────────
// Initialization
// ────────────────────────────────────────────────

// Toggle email required state based on role selection
function updateEmailRequirement() {
    const role = document.getElementById('role')?.value;
    const emailInput = document.getElementById('userEmail');
    const requiredMark = document.getElementById('emailRequiredMark');
    const optionalNote = document.getElementById('emailOptionalNote');
    const hint = document.getElementById('emailHint');

    if (!emailInput) return;
    const isAdmin = role === 'ADMIN';
    emailInput.required = !isAdmin;
    if (requiredMark) requiredMark.classList.toggle('hidden', isAdmin);
    if (optionalNote) optionalNote.classList.toggle('hidden', !isAdmin);
    if (hint) hint.textContent = isAdmin ? 'Optionnel pour le rôle ADMIN' : 'Requis pour MFA et réinitialisation du mot de passe';
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('role')?.addEventListener('change', updateEmailRequirement);
    updateEmailRequirement(); // run once on load
    loadCountries();
    loadDepartments();
    loadUsersList();
    loadApplications();
});