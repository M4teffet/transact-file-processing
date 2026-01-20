// settings.js
const getCountryData = (code) => {
    try {
        const regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
        const name = regionNames.of(code.toUpperCase()) || code.toUpperCase();
        const flag = code.toUpperCase().replace(/./g, char =>
            String.fromCodePoint(char.charCodeAt(0) + 127397)
        );
        return { name, flag };
    } catch (e) {
        return { name: code, flag: '🌐' };
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

// ---------- USERS ----------
function renderUserItem(user) {
    const { flag } = getCountryData(user.countryCode);
    return `
        <li class="group flex items-center justify-between p-4 mb-3 bg-white border border-gray-100 rounded-xl transition-all hover:border-gray-200">
            <div class="flex items-center gap-4">

                <div class="w-11 h-11 flex items-center justify-center text-lg bg-gray-50 rounded-full border border-gray-200 group-hover:bg-gray-100 transition">
                    ${flag}
                </div>

                <div class="flex flex-col leading-tight">
                    <span class="text-sm font-semibold text-gray-900">
                        ${user.username}
                    </span>
                    <span class="text-[11px] font-medium tracking-wide text-gray-400 uppercase">
                        ${user.countryCode}
                    </span>
                </div>

            </div>
            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                ${user.role}
            </span>
        </li>
    `;
}

// ---------- COUNTRIES ----------
document.getElementById('countryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');

    const payload = {
        code: document.getElementById('countryCode').value.trim().toUpperCase(),
        companyId: document.getElementById('companyId').value.trim()
    };

    try {
        btn.disabled = true;
        const res = await secureFetch(`/api/country`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showSnackbar("Pays créé avec succès !", "success");
            e.target.reset();
            await loadCountries();
        } else {
            const text = await res.text();
            showSnackbar(text || "Erreur lors de l'ajout du pays", "error");
        }
    } catch (err) {
        showSnackbar("Erreur de connexion", "error");
    } finally {
        btn.disabled = false;
    }
});

// ---------- USERS ----------
document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const country = document.getElementById('userCountry').value;
    const department  = document.getElementById('department').value;

    if (!username || !password || !role || !country || !department) {
        showSnackbar("Tous les champs sont requis", "error");
        return;
    }

    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    params.append('role', role);
    params.append('country', country);
    params.append('department', department);

    const btn = document.getElementById('createUserBtn');

    try {
        btn.disabled = true;
        btn.textContent = "Chargement...";

        const res = await secureFetch(`/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (res.ok) {
            const createdUser = await res.json(); // <-- IMPORTANT: backend must return JSON of the created user
            showSnackbar("Utilisateur créé avec succès !", "success");

            // Append the new user immediately
            const container = document.getElementById('userList');
            if (container) {
                container.insertAdjacentHTML('afterbegin', renderUserItem(createdUser));
                if (window.lucide) lucide.createIcons();
            }

            e.target.reset();
        } else {
            const message = await res.text();
            showSnackbar(message || "Erreur lors de la création", "error");
        }
    } catch (err) {
        showSnackbar("Erreur réseau", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Créer l’utilisateur";
    }
});

// ---------- LOADERS ----------
async function loadCountries() {
    const select = document.getElementById('userCountry');
    const countryListEl = document.getElementById('countryList');

    try {
        const res = await secureFetch(`/api/country/list`);
        if (!res.ok) return;
        const countries = await res.json();

        // Populate select dropdown
        if (select) {
            select.innerHTML = countries.map(c => {
                const { name } = getCountryData(c.code);
                return `<option value="${c.code}">${name} (${c.companyId})</option>`;
            }).join('');
        }

        // Populate country list
        if (countryListEl) {
            countryListEl.innerHTML = countries.map(c => {
                const { name, flag } = getCountryData(c.code);
                return `
                <li class="group flex items-center justify-between p-3 mb-2 bg-white border border-gray-200 rounded-lg hover:shadow-md hover:border-brand-primary transition-all duration-200">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 flex items-center justify-center text-2xl bg-gray-50 rounded-full shadow-sm border border-gray-100 group-hover:scale-110 transition-transform">
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
                        <button class="text-gray-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-full transition-all opacity-0 group-hover:opacity-100">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </li>
                `;
            }).join('');

            if (window.lucide) lucide.createIcons();
        }
    } catch (err) {
        console.error("Load failed:", err);
    }
}

async function loadUsersList() {
    const container = document.getElementById('userList');
    if (!container) return;

    try {
        const response = await secureFetch(`/api/users/list`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Status: ${response.status}`);
        }

        const users = await response.json();

        container.innerHTML = users.map(user => renderUserItem(user)).join('');
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        console.error("GET Users Failed:", err);
        showSnackbar("Erreur lors de la récupération des utilisateurs", "error");
    }
}

// ---------- APPLICATIONS ----------
function renderAppItem(app) {
    return `
        <li data-app="${app.code}" data-desc="${app.label || ''}"
            class="cursor-pointer p-3 hover:bg-gray-50 flex justify-between">
            <span>${app.code}</span>
            <span class="text-xs text-gray-400">${app.label || ''}</span>
        </li>
    `;
}

async function loadApplications() {
    const res = await secureFetch('/api/applications');
    if (!res.ok) return;

    const apps = await res.json();
    const container = document.getElementById('appList');
    container.innerHTML = apps.map(renderAppItem).join('');

    container.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
            selectApplication(li.dataset.app, li.dataset.desc);
        });
    });
}

// ---------- APPLICATION SCHEMA ----------
async function selectApplication(appName, description) {
    document.getElementById('appNameDisplay').value = appName;
    document.getElementById('appDescription').value = description || '';

    const res = await secureFetch(`/api/applications/${appName}/fields`);
    if (!res.ok) {
        showSnackbar("Erreur chargement schéma", "error");
        return;
    }

    const data = await res.json();
    renderApplicationSchema(data);
}

function renderApplicationSchema(data) {
    let container = document.getElementById('schemaContainer');

    if (!container) {
        container = document.createElement('div');
        container.id = 'schemaContainer';
        container.className = 'mt-6 space-y-6';
        document.getElementById('appDescription').parentElement.appendChild(container);
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
                    ${fields.map(f => `
                        <tr class="border-t">
                            <td class="px-4 py-2 font-mono">${f.fieldName}</td>
                            <td class="px-4 py-2">${f.dataType}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ---------- DEPARTMENTS (NEW) ----------
document.getElementById('departmentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');

    // Retrieve values from the new Department Form inputs
    const payload = {
        code: parseInt(document.getElementById('deptCode').value), // Ensure Integer for backend
        description: document.getElementById('deptDesc').value.trim()
    };

    try {
        btn.disabled = true;
        // Assumption: Endpoint /api/departments exists
        const res = await secureFetch(`/api/departments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showSnackbar("Département créé avec succès !", "success");
            e.target.reset();
            await loadDepartments(); // Refresh list
        } else {
            const text = await res.text();
            showSnackbar(text || "Erreur création département", "error");
        }
    } catch (err) {
        console.error(err);
        showSnackbar("Erreur de connexion", "error");
    } finally {
        btn.disabled = false;
    }
});

async function loadDepartments() {
    const listEl = document.getElementById('departmentList');
    const selectEl = document.getElementById('department');

    try {
        const res = await secureFetch(`/api/departments/list`);
        if (!res.ok) return;

        const departments = await res.json();

        // --- Populate SELECT for user creation ---
        if (selectEl) {
            selectEl.innerHTML = `
                <option value="">-- Sélectionner un département --</option>
                ${departments.map(d => `
                    <option value="${d.code}">
                        ${d.code} - ${d.description}
                    </option>
                `).join('')}
            `;
        }

        // --- Populate department LIST (admin view) ---
        if (listEl) {
            listEl.innerHTML = departments.map(d => `
                <li class="flex items-center justify-between p-3 mb-2 bg-white border rounded-lg">
                    <div>
                        <div class="text-sm font-bold">${d.description}</div>
                        <div class="text-[10px] font-mono text-gray-500">Code: ${d.code}</div>
                    </div>
                </li>
            `).join('');
        }

        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error("Load Departments failed:", err);
    }
}

// ---------- INIT ----------
document.addEventListener('DOMContentLoaded', () => {
    loadCountries();
    loadDepartments();
    loadUsersList();
    loadApplications();
});
