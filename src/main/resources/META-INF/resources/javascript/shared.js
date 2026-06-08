// Use relative URL so the app works in any environment (dev, staging, prod)
const API_BASE = "/api";

/**
// DECODE JWT
 */
const Auth = {
    getPayload() {
        // 1. Try LocalStorage first
        let token = localStorage.getItem('AuthToken');

        // 2. If not found, try Cookies
        if (!token) {
            const name = "AuthToken=";
            const decodedCookie = decodeURIComponent(document.cookie);
            const ca = decodedCookie.split(';');
            for(let i = 0; i < ca.length; i++) {
                let c = ca[i].trim();
                if (c.indexOf(name) == 0) {
                    token = c.substring(name.length, c.length);
                }
            }
        }
        if (!token) return null;

        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(window.atob(base64));
        } catch (e) {
            return null;
        }
    },

    getUsername() {
        const payload = this.getPayload();
        return payload ? (payload.upn || payload.sub) : "Invité";
    }
};


// ========================================
// COUNTRY FLAG UTILITIES - NO 404 ERRORS
// ========================================

/**
 * Get country flag using flagcdn.com images
 * Works on ALL browsers - no 404 errors
 */
function getCountryFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) {
        return '';
    }

    const code = countryCode.toLowerCase();

    // ✅ Use flagcdn.com images - works everywhere, no local files needed
    return `<img src="https://flagcdn.com/16x12/${code}.png"
                 srcset="https://flagcdn.com/32x24/${code}.png 2x"
                 width="16"
                 height="12"
                 alt="${code.toUpperCase()}"
                 style="display: inline-block; vertical-align: middle; margin: 0 4px;">`;
}

/**
 * Get country name in French
 */
function getCountryName(countryCode) {
    if (!countryCode || countryCode.length !== 2) {
        return 'Pays inconnu';
    }

    try {
        const regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
        return regionNames.of(countryCode.toUpperCase()) || countryCode;
    } catch (e) {
        return countryCode;
    }
}

/**
 * Add country flag to footer
 */
function addCountryFlagToFooter() {
    const countryCode = sessionStorage.getItem('country')?.trim().toUpperCase();

    if (!countryCode || countryCode.length !== 2) {
        return; // silent exit — no flag shown if missing
    }

    const flagEl = document.getElementById('country-flag');
    if (!flagEl) return;

    const flag = getCountryFlag(countryCode);
    const name = getCountryName(countryCode);

    // Use innerHTML to render the flag image
    flagEl.innerHTML = flag;
    flagEl.title = name || countryCode;

    console.log(`✅ Drapeau affiché : ${name} (${countryCode})`);
}


/**
// SNACKBAR (UPDATED)
 */
const showSnackbar = (msg, type = "info", actionLabel, actionFn) => {
    const container = document.getElementById("snackbar-container");
    if (!container) return;

    // Material Design: max 3 stacked, dismiss oldest
    while (container.children.length >= 3) {
        container.lastElementChild?.remove();
    }

    // Duration per Material spec: 4s default, longer for errors
    const duration = type === "error" ? 10000 : 4000;

    const item = document.createElement("div");
    item.className = "snackbar-item";
    item.style.position = "relative";

    // Action label: "Fermer" for errors, custom or none otherwise
    const label = actionLabel || (type === "error" ? "Fermer" : "OK");
    const action = actionFn || (() => dismiss());

    item.innerHTML =
        '<span class="snackbar-msg">' + msg + '</span>' +
        '<button class="snackbar-action" type="button">' + label + '</button>' +
        '<div class="snackbar-progress" style="animation-duration:' + duration + 'ms"></div>';

    container.prepend(item);

    // Dismiss logic
    let dismissed = false;
    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        item.classList.remove("snackbar-visible");
        item.classList.add("snackbar-hiding");
        setTimeout(() => item.remove(), 220);
    }

    item.querySelector(".snackbar-action").addEventListener("click", () => {
        action();
        dismiss();
    });

    // Animate in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => item.classList.add("snackbar-visible"));
    });

    // Auto-dismiss
    const timer = setTimeout(dismiss, duration);

    // Pause timer on hover (Material behaviour)
    item.addEventListener("mouseenter", () => {
        const bar = item.querySelector(".snackbar-progress");
        if (bar) bar.style.animationPlayState = "paused";
        clearTimeout(timer);
    });
    item.addEventListener("mouseleave", () => {
        const bar = item.querySelector(".snackbar-progress");
        if (bar) bar.style.animationPlayState = "running";
        setTimeout(dismiss, 1500);
    });
};


/**
 * GLOBAL SECURITY WRAPPER
 * Intercepts 401/403 errors to redirect to login
 */
const secureFetch = async (url, options = {}) => {
    try {
        const response = await fetch(url, {
            ...options,
            // Always include credentials if you're using sessions/cookies
            credentials: 'same-origin',

            // Add cache-control headers to the REQUEST
            // This tells the server (and any proxies) that we don't want cached responses
            headers: {
                ...options.headers,
                'Cache-Control': 'no-cache, no-store, must-revalidate, private',
                'Pragma': 'no-cache',
                // Not strictly needed, but helps with older proxies
                'Expires': '0',
            },
        });

        // Detect authentication issues or unwanted redirects
        // Detect authentication failures — avoid matching on response.url.includes('/login')
        // which fires on any payload containing the word "login" (false positives)
        if (
            response.status === 401 ||
            response.status === 403 ||
            response.status === 302 ||
            (response.redirected && response.url.includes('/login'))
        ) {
            console.warn("Échec d'authentification détecté. Nettoyage de session et redirection...");

            // Clear client-side storage
            localStorage.clear();
            sessionStorage.clear();
            localStorage.removeItem('auth_valid_until');

            // Force full page navigation to login
            window.location.href = "/login?error=session_expired";

            // Prevent any further processing in promise chain
            return new Promise(() => {});
        }

        return response;
    } catch (error) {
        console.error("Erreur réseau dans secureFetch:", error);
        throw error;
    }
};


/**
 * LOAD STATS
 */
const loadStats = async (mapping) => {
    try {
        const pathname = window.location.pathname;
        const params = new URLSearchParams();

        // Use sessionStorage username (set on login) — Auth.getUsername() reads
        // HttpOnly cookie which is always inaccessible from JS
        if (pathname === '/batches' || pathname === '/upload') {
            const username = sessionStorage.getItem('username');
            if (username && username !== 'Invité') {
                params.set('uploadedById', username);
            }
        }

        const url = params.toString()
            ? `${API_BASE}/batches/counts?${params.toString()}`
            : `${API_BASE}/batches/counts`;

        const res = await secureFetch(url);
        if (!res || !res.ok) return;

        const stats = await res.json();
        const totals = {};

        Object.entries(mapping).forEach(([status, elementId]) => {
            const count = stats[status] || 0;
            if (!totals[elementId]) totals[elementId] = 0;
            totals[elementId] += count;
        });

        Object.entries(totals).forEach(([elementId, finalSum]) => {
            const el = document.getElementById(elementId);
            if (el) {
                const prev = parseInt(el.textContent) || 0;
                if (prev !== finalSum) {
                    el.textContent = finalSum;
                    // Flash animation on change
                    el.style.transition = 'color .3s';
                    el.style.color = '#e86e00';
                    setTimeout(() => { el.style.color = ''; }, 600);
                }
            }
        });
    } catch (err) {
        console.error("Erreur stats:", err);
    }
};


// -----------------------------
// STATUS BADGES
// -----------------------------
const getStatusBadge = (status) => {
    const types = {
        UPLOADED: { color: "bg-gray-100 text-gray-700 border-gray-200", icon: "clock", label: "Importé" },
        VALIDATED: { color: "bg-blue-50 text-blue-700 border-blue-200", icon: "user-check", label: "Validé" },
        PROCESSING: { color: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: "refresh-cw", label: "En cours" },
        PROCESSED: { color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: "check-circle", label: "Terminé" },
        PROCESSED_WITH_ERROR: { color: "bg-orange-100 text-orange-800 border-orange-200", icon: "alert-triangle", label: "Terminé" },
        UPLOADED_FAILED: { color: "bg-red-50 text-red-700 border-red-100", icon: "alert-octagon", label: "Échec Upload" },
        VALIDATED_FAILED: { color: "bg-red-50 text-red-700 border-red-100", icon: "x-octagon", label: "Échec Signature" },
        PROCESSED_FAILED: { color: "bg-red-100 text-red-900 border-red-200", icon: "x-circle", label: "Échec" }
    };

    const def = types[status] || { color: "bg-gray-100 text-gray-700 border-gray-200", icon: "help-circle", label: status.replace(/_/g, ' ') };

    return `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border uppercase tracking-wide ${def.color}">
            <i data-lucide="${def.icon}" class="w-3 h-3 ${status === 'PROCESSING' ? 'animate-spin' : ''}"></i>
            ${def.label}
        </span>
    `;
};


// -----------------------------
// VIEW BATCH DETAILS
// -----------------------------
const viewBatchDetails = async (batchId, modalId = "batchDetailsModal", contentId = "batchDetailsContent") => {
    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) return;
        if (!res.ok) throw new Error("Erreur API");

        const { details, batchId: id, totalRecords } = await res.json();

        const content = document.getElementById(contentId);
        if (!content) return;

        if (!details?.length) {
            content.innerHTML = `<p class="text-gray-500 text-sm">Aucune donnée.</p>`;
            return openModal(modalId);
        }

        const preview = details.slice(0, 10);

        // Get all keys from the first row's data
        const keys = Object.keys(preview[0].data);

        // Filter out keys that are null/empty in all preview rows
        const nonNullKeys = keys.filter(k => preview.some(r => r.data[k] != null && r.data[k] !== ""));

        const table = `
            <div class="overflow-auto max-h-96 border rounded">
                <table class="min-w-full text-xs">
                    <thead class="bg-gray-100 sticky top-0 z-10">
                        <tr>${nonNullKeys.map(k => `<th class="px-3 py-2 border-b">${k}</th>`).join("")}</tr>
                    </thead>
                    <tbody>
                        ${preview.map(r => `
                            <tr class="border-b hover:bg-gray-50">
                                ${nonNullKeys.map(k => `<td class="px-3 py-2 border-r">${r.data[k] ?? ""}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;

        content.innerHTML = `
            <div class="space-y-2 mb-4">
                <p class="text-sm"><strong>ID :</strong> ${id}</p>
                <p class="text-sm"><strong>Total :</strong> ${totalRecords} enregistrements</p>
            </div>
            <p class="text-gray-500 mb-2 text-xs uppercase font-bold">Aperçu des données</p>
            ${table}
            <button
                onclick="downloadBatchNonNull('${batchId}')"
                class="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors">
                <i data-lucide="download" class="w-4 h-4"></i> Télécharger le CSV complet
            </button>
        `;

        openModal(modalId);
        lucide.createIcons();
    } catch (err) {
        showSnackbar(err.message, "error");
    }
};


// -----------------------------
// DOWNLOAD CSV (FIXED ESCAPING)
// -----------------------------
const downloadBatchNonNull = async (batchId) => {
    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}: Erreur API`);

        const { details } = await res.json();

        if (!details?.length) return showSnackbar("Aucune donnée à télécharger", "error");

        const keys = Object.keys(details[0].data);
        const nonNullKeys = keys.filter(k => details.some(r => r.data[k] != null && r.data[k] !== ""));

        const csvLines = [
            nonNullKeys.join(","),
            ...details.map(r => nonNullKeys.map(k => {
                let val = (r.data[k] ?? "").toString();
                if (val.includes('"') || val.includes(',') || val.includes('\n')) {
                    val = '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            }).join(","))
        ].join("\n");

        const blob = new Blob([csvLines], { type: "text/csv;charset=utf-8;" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `batch_${batchId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

        showSnackbar("Téléchargement lancé !", "success");
    } catch (err) {
        showSnackbar("Erreur: " + err.message, "error");
    }
};


// -----------------------------
// MODALS & LOGOUT
// -----------------------------
const openModal = (id) => {
    const m = document.getElementById(id);
    if (m) { m.classList.remove("hidden"); m.classList.add("flex"); }
};

const closeModal = (id) => {
    const m = document.getElementById(id);
    if (m) { m.classList.add("hidden"); m.classList.remove("flex"); }
};

const logoutUser = async () => {
    sessionStorage.clear();
    localStorage.clear();
    try {
        await fetch(`${API_BASE}/logout`, { method: "POST" });
    } finally {
        window.location.href = "/login";
    }
};


// -----------------------------
// INITIALIZATION
// -----------------------------
function initShared() {
    addCountryFlagToFooter();

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    console.log('✅ shared.js initialisé');
}

document.addEventListener("DOMContentLoaded", initShared);


// -----------------------------
// GLOBAL EXPORTS
// -----------------------------
window.Auth = Auth;
window.getCountryFlag = getCountryFlag;
window.getCountryName = getCountryName;
window.addCountryFlagToFooter = addCountryFlagToFooter;
window.showSnackbar = showSnackbar;
window.loadStats = loadStats;

// ─────────────────────────────────────────────────────────────────────────────
// REAL-TIME STATS POLLING
// Starts a polling loop that refreshes stats every N seconds.
// Returns a stop function — call it on page unload to prevent memory leaks.
//
// Usage in any page script:
//   const stopStats = startStatsPolling(mapping, 15);
//   window.addEventListener('beforeunload', stopStats);
// ─────────────────────────────────────────────────────────────────────────────
const startStatsPolling = (mapping, intervalSeconds = 15) => {
    let timer = null;
    let active = true;

    const tick = async () => {
        if (!active) return;
        await loadStats(mapping).catch(() => {});
        if (active) {
            timer = setTimeout(tick, intervalSeconds * 1000);
        }
    };

    // Fire immediately then schedule
    tick();

    const stop = () => {
        active = false;
        if (timer) { clearTimeout(timer); timer = null; }
    };

    window.addEventListener('beforeunload', stop);
    return stop;
};

window.startStatsPolling = startStatsPolling;
window.getStatusBadge = getStatusBadge;
window.viewBatchDetails = viewBatchDetails;
window.downloadBatchNonNull = downloadBatchNonNull;
window.openModal = openModal;
window.closeModal = closeModal;
window.logoutUser = logoutUser;
window.secureFetch = secureFetch;