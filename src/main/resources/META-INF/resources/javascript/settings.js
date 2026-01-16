// settings.js

// --- HELPERS ---

// Get Full Name and Flag from ISO Code (e.g., "SN" -> "Sénégal", "🇸🇳")
const getCountryData = (code) => {
    try {
        const regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
        const name = regionNames.of(code.toUpperCase());
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

// --- COUNTRY MANAGEMENT (JSON Based) ---

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

// --- USER MANAGEMENT (Form Data / @RestForm Based) ---

document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const country = document.getElementById('userCountry').value;

    // Local validation
    if (!username || !password || !role || !country) {
        showSnackbar("Tous les champs sont requis", "error");
        return;
    }

    // IMPORTANT: Use URLSearchParams for @RestForm compatibility
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    params.append('role', role);
    params.append('country', country);

    const btn = document.getElementById('createUserBtn');

    try {
        btn.disabled = true;
        btn.textContent = "Chargement...";

        const res = await secureFetch(`/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString() // Sends as: username=val&password=val...
        });

        const message = await res.text();

        if (res.ok) {
            showSnackbar(message || "Utilisateur créé !", "success");
            e.target.reset();
        } else {
            showSnackbar(message || "Erreur lors de la création", "error");
        }
    } catch (err) {
        showSnackbar("Erreur réseau", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Créer l’utilisateur";
    }
});

// --- LOAD DATA ---

async function loadCountries() {
    const select = document.getElementById('userCountry');
    const countryList = document.getElementById('countryList');

    try {
        const res = await secureFetch(`/api/country/list`);
        if (!res.ok) return;
        const countries = await res.json();

        // Populate Select Dropdown
        select.innerHTML = countries.map(c => {
            const { name } = getCountryData(c.code);
            return `<option value="${c.code}">${name} (${c.companyId})</option>`;
        }).join('');

        // Also update country list in the UI
        const countryList = document.getElementById('countryList');
if (countryList) {
    countryList.innerHTML = countries.map(c => {
        // Generate dynamic data
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
    `}).join('');

            if (window.lucide) lucide.createIcons();
        }
    } catch (err) {
        console.error("Load failed:", err);
    }
}

async function loadUsersList() {
    // 1. Check if the container exists in your HTML
    const container = document.getElementById('userList'); // Reusing your list container or specific one
    if (!container) return;

    try {
        // 2. Use the exact path defined in Java
        const response = await secureFetch(`/api/users/list`);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Status: ${response.status}`);
        }

        const users = await response.json();

        // 3. Render the list
        container.innerHTML = users.map(user => {
            // Using your existing flag helper
            const { flag } = getCountryData(user.countryCode);

            return `
            <li class="flex items-center justify-between p-3 mb-2 bg-white border border-gray-200 rounded-lg hover:shadow-sm">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 flex items-center justify-center text-xl bg-gray-50 rounded-full border border-gray-100">
                        ${flag}
                    </div>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-gray-900">${user.username}</span>
                        <span class="text-[10px] font-semibold text-gray-400 uppercase">${user.countryCode}</span>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                        ${user.role}
                    </span>
                </div>
            </li>`;
        }).join('');

        // 4. Refresh icons
        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error("GET Users Failed:", err);
        showSnackbar("Erreur lors de la récupération des utilisateurs", "error");
    }
}

// Ensure this runs when the page loads
document.addEventListener('DOMContentLoaded', loadUsersList);

document.addEventListener('DOMContentLoaded', loadCountries);