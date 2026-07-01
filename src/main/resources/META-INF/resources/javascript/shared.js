// Use relative URL so the app works in any environment (dev, staging, prod)
const API_BASE = "/api/v1";

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
 * CACHED FETCH
 *
 * Wraps secureFetch with sessionStorage caching. Returns parsed JSON directly
 * (not a Response object) so callers don't need to call .json() themselves.
 *
 * Used for static reference data that rarely changes: application list,
 * country list, department list.  Each entry is keyed by URL and expires
 * after ttlMs milliseconds.
 *
 * When data changes on the server (admin adds/deletes a country etc.), call
 * bustCache(url) before the next fetchCached call so fresh data is fetched.
 *
 * @param {string} url    — absolute or relative URL
 * @param {number} ttlMs  — cache lifetime in milliseconds (default 10 min)
 * @returns {Promise<any|null>} parsed JSON or null on error
 */
const fetchCached = async (url, ttlMs = 10 * 60 * 1000) => {
    const key = 'fc:' + url;
    const now = Date.now();

    // Cache read — skip silently if sessionStorage is unavailable
    try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
            const {data, exp} = JSON.parse(raw);
            if (now < exp) return data;   // fresh hit
            sessionStorage.removeItem(key); // stale — remove before re-fetch
        }
    } catch (_) { /* storage unavailable or corrupt — fall through to network */
    }

    // Network fetch
    const res = await secureFetch(url);
    if (!res || !res.ok) return null;
    const data = await res.json();

    // Cache write — tolerate storage-full errors
    try {
        sessionStorage.setItem(key, JSON.stringify({data, exp: now + ttlMs}));
    } catch (_) { /* storage full — response still returned, just not cached */
    }

    return data;
};

/**
 * Removes a fetchCached entry so the next call fetches fresh data.
 * Call this immediately after any mutation (POST/DELETE) that changes
 * the cached resource.
 *
 * @param {string} url — the same URL passed to fetchCached
 */
const bustCache = (url) => {
    try {
        sessionStorage.removeItem('fc:' + url);
    } catch (_) {
    }
};


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
 * Intercepts 401 (session expired) to force a clean logout and login redirect.
 * 403 (wrong role) is intentionally NOT intercepted here — the server's
 * SecurityRedirectFilter already handles it by redirecting the user to their
 * own home page.  Clearing the session on 403 would log the user out just
 * because they navigated to a page they don't have permission for.
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

        // Detect authentication issues or unwanted redirects.
        // 401 = no valid session → force logout.
        // 403 = authenticated but wrong role → let the server's SecurityRedirectFilter
        //       redirect the user to their own home page; do NOT clear the session here
        //       or the user gets logged out just for navigating to a page they can't see.
        // 302 + redirected to /login = server cleared the cookie and sent us back.
        if (
            response.status === 401 ||
            (response.redirected && response.url.includes('/login'))
        ) {
            console.warn("Session expirée — nettoyage et redirection vers login...");

            // Clear client-side storage
            localStorage.clear();
            sessionStorage.clear();

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
// ─────────────────────────────────────────────────────────────────────────────
// BADGE SYSTEM — unified across the whole application
//
// Three tiers, all share the same base shape:
//   4px radius · font-size 10px · font-weight 500 · letter-spacing .05em · uppercase
//   0.5px border matching the tint (gives definition on white without heavy fill)
//
// Tier 1 — Workflow status  (batch processing state, has a Lucide icon)
// Tier 2 — Category label   (FT / FTR — no icon, technical code style)
// Tier 3 — Property label   (REQUIS / ACTIF / INACTIF — no icon, used inline)
//
// Semantic colour tokens used consistently:
//   gray  = neutral / not yet started
//   blue  = in-progress / validated
//   green = success / done
//   amber = partial / warning
//   red   = failure / error
// ─────────────────────────────────────────────────────────────────────────────

const _badge = (bg, color, border) =>
    `display:inline-flex;align-items:center;gap:4px;padding:2px 8px;` +
    `border-radius:4px;font-size:10px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;` +
    `background:${bg};color:${color};border:0.5px solid ${border};white-space:nowrap`;

const _BADGE_TOKENS = {
    gray: {bg: '#f8fafc', color: '#475569', border: 'rgba(71,85,105,.25)'},
    blue: {bg: '#eff6ff', color: '#1d4ed8', border: 'rgba(29,78,216,.25)'},
    green: {bg: '#f0fdf4', color: '#166534', border: 'rgba(22,101,52,.25)'},
    amber: {bg: '#fffbeb', color: '#92400e', border: 'rgba(146,64,14,.25)'},
    red: {bg: '#fef2f2', color: '#991b1b', border: 'rgba(153,27,27,.25)'},
    orange: {bg: '#fff7ed', color: '#c2410c', border: 'rgba(194,65,12,.25)'},
};

// Tier 1 — workflow status badges (with icon)
const getStatusBadge = (status) => {
    const map = {
        UPLOADED: {t: 'gray', icon: 'clock', label: 'Importé', spin: false},
        VALIDATED: {t: 'blue', icon: 'user-check', label: 'Validé', spin: false},
        PROCESSING: {t: 'blue', icon: 'refresh-cw', label: 'En cours', spin: true},
        PROCESSED: {t: 'green', icon: 'check-circle', label: 'Traité', spin: false},
        PROCESSED_WITH_ERROR: {t: 'amber', icon: 'alert-triangle', label: 'Partiel', spin: false},
        UPLOADED_FAILED: {t: 'red', icon: 'alert-circle', label: 'Échec import', spin: false},
        VALIDATED_FAILED: {t: 'red', icon: 'x-circle', label: 'Échec sig.', spin: false},
        PROCESSED_FAILED: {t: 'red', icon: 'x-circle', label: 'Échec', spin: false},
    };
    const d = map[status] || {t: 'gray', icon: 'help-circle', label: status?.replace(/_/g, ' ') || '—', spin: false};
    const c = _BADGE_TOKENS[d.t];
    return `<span style="${_badge(c.bg, c.color, c.border)}">
        <i data-lucide="${d.icon}" style="width:11px;height:11px;flex-shrink:0${d.spin ? ';animation:spin 1s linear infinite' : ''}"></i>
        ${d.label}
    </span>`;
};

// Tier 2 — category labels (application type codes, no icon)
const appBadgeHTML = (application) => {
    const map = {
        FUNDS_TRANSFER: {t: 'orange', label: 'FT'},
        FUNDS_TRANSFER_REVERSAL: {t: 'blue', label: 'FTR'},
    };
    const d = map[application] || {t: 'gray', label: (application || 'N/A').slice(0, 5)};
    const c = _BADGE_TOKENS[d.t];
    return `<span style="${_badge(c.bg, c.color, c.border)}" title="${application || ''}">${d.label}</span>`;
};

// Tier 3 — property labels (REQUIS, ACTIF, INACTIF — exported for reuse)
const propertyBadge = (label, tone) => {
    const c = _BADGE_TOKENS[tone] || _BADGE_TOKENS.gray;
    return `<span style="${_badge(c.bg, c.color, c.border)}">${label}</span>`;
};
window.propertyBadge = propertyBadge;

const formatDateParts = (iso) => {
    if (!iso) return {date: '—', time: ''};
    const d = new Date(iso);
    return {
        date: d.toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit', year: 'numeric'}),
        time: d.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})
    };
};

window.getStatusBadge = getStatusBadge;
window.appBadgeHTML = appBadgeHTML;

const tableSkeleton = (rows = 5, cols = 4) => {
    if (!document.getElementById('sk-style')) {
        const s = document.createElement('style');
        s.id = 'sk-style';
        s.textContent = `@keyframes sk-pulse{0%{opacity:.5}100%{opacity:1}}`;
        document.head.appendChild(s);
    }
    const bar = (w) => `<div style="height:10px;width:${w}%;background:var(--line-soft,#e9eaec);border-radius:2px;animation:sk-pulse 1.2s ease-in-out infinite alternate"></div>`;
    const widths = [[70, 35, 25, 20], [80, 40, 28, 22], [65, 30, 20, 18], [75, 38, 22, 20], [68, 33, 24, 19]];
    return `<table style="min-width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:0.5px solid var(--line-soft,#e9eaec)">${
        Array(cols).fill('').map(() => `<th style="padding:10px 16px;text-align:left">${bar(50)}</th>`).join('')
    }</tr></thead>
        <tbody>${Array(rows).fill('').map((_, ri) => `<tr style="border-bottom:0.5px solid var(--line-soft,#e9eaec)">${
        (widths[ri] || widths[0]).slice(0, cols).map(w => `<td style="padding:13px 16px">${bar(w)}</td>`).join('')
    }</tr>`).join('')}</tbody>
    </table>`;
};


// -----------------------------
// VIEW BATCH DETAILS
// -----------------------------
const viewBatchDetails = async (batchId, modalId = "batchDetailsModal", contentId = "batchDetailsContent") => {
    const content = document.getElementById(contentId);
    if (!content) return;

    // Show skeleton the instant the modal opens — no blank flash
    content.innerHTML = `<div style="overflow-x:auto">${tableSkeleton(6, 5)}</div>`;
    openModal(modalId);

    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res || !res.ok) throw new Error("Erreur API");

        const batch = await res.json();
        const details = Array.isArray(batch.details) ? batch.details : [];
        const total = batch.totalRecords || details.length;
        const success = batch.successCount ?? details.filter(r => r.status === 'SUCCESS').length;
        const failed = batch.failureCount ?? details.filter(r => r.status === 'FAILED').length;

        if (!details.length) {
            content.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--ink-3)">Aucune donnée disponible.</div>`;
            return;
        }

        const allKeys = [...new Set(details.flatMap(r => Object.keys(r.data || {})))];
        const nonNullKeys = allKeys.filter(k => details.some(r => r.data[k] != null && r.data[k] !== ''));

        const headerCells = nonNullKeys.map(k =>
            `<th style="padding:8px 12px;white-space:nowrap;font-size:10px;font-weight:500;
                color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;
                text-align:left;border-bottom:0.5px solid var(--line-soft);
                position:sticky;top:0;background:var(--canvas)">${k}</th>`
        ).join('');

        const bodyRows = details.map((r, idx) => {
            const isOdd = idx % 2 === 1;
            const isFailed = r.status === 'FAILED';
            const rowBg = isFailed ? '#fff8f8' : isOdd ? '#fafafa' : '#ffffff';
            const dataCells = nonNullKeys.map(k =>
                `<td style="padding:7px 12px;font-size:11px;color:var(--ink-2);
                    border-bottom:0.5px solid var(--line-soft);white-space:nowrap;
                    max-width:180px;overflow:hidden;text-overflow:ellipsis"
                    title="${String(r.data?.[k] ?? '')}">${r.data?.[k] ?? ''}</td>`
            ).join('');
            const statusCell = `<td style="padding:7px 12px;border-bottom:0.5px solid var(--line-soft)">${getStatusBadge(r.status)}</td>`;
            const refCell = `<td style="padding:7px 12px;font-size:10px;color:var(--ink-3);
                font-family:monospace;border-bottom:0.5px solid var(--line-soft)">${r.t24Reference || '—'}</td>`;
            return `<tr style="background:${rowBg}">${dataCells}${refCell}${statusCell}</tr>`;
        }).join('');

        content.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
                <div style="display:flex;gap:16px;font-size:12px">
                    <span style="color:var(--ink-3)">${total} lignes</span>
                    ${success > 0 ? `<span style="color:#137333">✓ ${success} succès</span>` : ''}
                    ${failed > 0 ? `<span style="color:#c5221f">✗ ${failed} échecs</span>` : ''}
                </div>
                <button onclick="downloadBatchNonNull('${batchId}')"
                        style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;
                               font-size:11px;font-weight:500;background:var(--orange);color:#fff;border:none;cursor:pointer">
                    <i data-lucide="download" style="width:13px;height:13px"></i>CSV complet
                </button>
            </div>
            <div style="overflow:auto;max-height:460px;border:0.5px solid var(--line)">
                <table style="min-width:100%;border-collapse:collapse">
                    <thead>
                        <tr>
                            ${headerCells}
                            <th style="padding:8px 12px;font-size:10px;font-weight:500;color:var(--ink-3);
                                text-transform:uppercase;letter-spacing:.06em;text-align:left;
                                border-bottom:0.5px solid var(--line-soft);position:sticky;top:0;
                                background:var(--canvas);white-space:nowrap">Réf. T24</th>
                            <th style="padding:8px 12px;font-size:10px;font-weight:500;color:var(--ink-3);
                                text-transform:uppercase;letter-spacing:.06em;text-align:left;
                                border-bottom:0.5px solid var(--line-soft);position:sticky;top:0;
                                background:var(--canvas)">Statut</th>
                        </tr>
                    </thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>`;
        createIcons(content);
    } catch (err) {
        content.innerHTML = `<div style="padding:2rem;text-align:center;color:#c5221f;font-size:13px">${err.message}</div>`;
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
    let inflight = false; // guard: never fire a new request while the previous is pending

    const tick = async () => {
        if (!active) return;
        if (inflight) {
            // Previous request still in flight — reschedule without stacking
            timer = setTimeout(tick, intervalSeconds * 1000);
            return;
        }
        inflight = true;
        try {
            await loadStats(mapping);
        } catch (_) {
            // swallow — network errors are transient, polling continues
        } finally {
            inflight = false;
        }
        if (active) timer = setTimeout(tick, intervalSeconds * 1000);
    };

    // Pause when the tab is hidden, resume on visibility — no wasted requests
    const onVisibility = () => {
        if (document.hidden) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        } else {
            tick();
        }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const stop = () => {
        active = false;
        if (timer) { clearTimeout(timer); timer = null; }
        document.removeEventListener('visibilitychange', onVisibility);
    };

    window.addEventListener('beforeunload', stop);
    tick(); // fire immediately on page load
    return stop;
};

// ─────────────────────────────────────────────────────────────────────────────
// OPERATING WINDOW STATUS BADGE
// Polls /api/admin/operating-window/status every 60 s and updates the topbar
// badge so INPUTTER and AUTHORISER always know if the system is open.
// ─────────────────────────────────────────────────────────────────────────────
const pollWindowStatus = () => {
    const badge = document.getElementById('op-window-badge');
    const dot = document.getElementById('op-window-dot');
    const label = document.getElementById('op-window-label');
    if (!badge) return; // layout element not present (e.g. login page)

    const refresh = async () => {
        try {
            const res = await secureFetch(`${API_BASE}/admin/operating-window/status`);
            if (!res || !res.ok) return;
            const d = await res.json();

            badge.style.display = 'inline-flex';

            if (d.openNow) {
                dot.style.background = '#34a853';
                badge.style.borderColor = 'rgba(52,168,83,.35)';
                badge.style.background = 'rgba(52,168,83,.12)';
                label.style.color = '#5db870';
                label.textContent = 'Système ouvert';
            } else {
                dot.style.background = '#ea4335';
                badge.style.borderColor = 'rgba(234,67,53,.35)';
                badge.style.background = 'rgba(234,67,53,.12)';
                label.style.color = '#e57368';
                label.textContent = d.enabled
                    ? `Fermé — ouvre à ${String(d.openHour).padStart(2, '0')}h00`
                    : 'Système fermé';
            }
        } catch (_) { /* silent — badge just stays hidden */
        }
    };

    refresh();
    setInterval(refresh, 60_000); // re-check every minute
};

window.pollWindowStatus = pollWindowStatus;

window.startStatsPolling = startStatsPolling;
window.getStatusBadge = getStatusBadge;
window.formatDateParts = formatDateParts;
window.appBadgeHTML = appBadgeHTML;
window.tableSkeleton = tableSkeleton;
window.viewBatchDetails = viewBatchDetails;
window.downloadBatchNonNull = downloadBatchNonNull;
window.openModal = openModal;
window.closeModal = closeModal;
window.logoutUser = logoutUser;

// ─────────────────────────────────────────────────────────────────────────────
// BATCH SUMMARY — shared so it works on both /batches (INPUTTER) and /validated
// ─────────────────────────────────────────────────────────────────────────────

let _summaryPoller = null;
let _summaryBatchId = null;

const _stopSummaryPoller = () => {
    if (_summaryPoller) {
        clearInterval(_summaryPoller);
        _summaryPoller = null;
    }
    _summaryBatchId = null;
};

/** Fetch the batch and re-render the summary modal content in place */
const _refreshSummaryContent = async (batchId) => {
    if (_summaryBatchId !== batchId) return null; // stale if user closed and reopened
    const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
    if (!res || !res.ok) {
        _stopSummaryPoller();
        return null;
    }
    const batch = await res.json();

    // During PROCESSING, BatchStatistics counts are 0 (only written at finalization).
    // Supplement with the /progress endpoint which reads BatchData rows in real time.
    if (batch.status === 'PROCESSING') {
        const pRes = await secureFetch(`${API_BASE}/batches/${batchId}/progress`);
        if (pRes && pRes.ok) {
            const prog = await pRes.json();
            batch.successCount = prog.successCount ?? 0;
            batch.failureCount = prog.failureCount ?? 0;
        }
    }

    _renderSummaryHTML(batch, batchId);
    if (batch.status !== 'PROCESSING') _stopSummaryPoller();
    return batch;
};

/** Build and inject the summary modal HTML */
const _renderSummaryHTML = (batch, batchId) => {
    const {
        application, totalRecords, originalFilename, details,
        successCount, failureCount, status
    } = batch;

    const success = successCount ?? 0;
    const failure = failureCount ?? 0;
    const isProcessing = status === 'PROCESSING';

    let totalAmount = 0;
    if (application === 'FUNDS_TRANSFER' && details) {
        totalAmount = details.reduce((sum, item) => {
            const amt = parseFloat(item.data?.['DEBIT.AMOUNT'] || item.data?.['CREDIT.AMOUNT']) || 0;
            return sum + amt;
        }, 0);
    }

    let errorRowsHtml = '';
    if (failure > 0 && details) {
        errorRowsHtml = details
            .filter(r => r.status === 'FAILED')
            .map(r => {
                let cleanError = r.errorMessage || '—';
                try {
                    const parsed = JSON.parse(r.errorMessage);
                    if (parsed.error?.errorDetails?.length > 0)
                        cleanError = parsed.error.errorDetails[0].message;
                } catch (e) {
                }
                return `
                    <div class="flex items-start gap-3 p-3 bg-red-50 border-l-4 border-red-500 mb-2">
                        <i data-lucide="alert-circle" class="w-4 h-4 text-red-600 mt-0.5 shrink-0"></i>
                        <div class="text-xs">
                            <p class="font-bold text-red-800 uppercase text-[10px]">Ligne ${r.lineNumber}</p>
                            <p class="text-red-700 font-medium">${cleanError}</p>
                        </div>
                    </div>`;
            }).join('');
    }

    // Status section — correct message per state
    let statusSection;
    if (isProcessing && success === 0 && failure === 0) {
        // Batch just started — no results yet
        statusSection = '<p class="text-xs text-gray-400 italic text-center py-4">Traitement en cours, les résultats apparaîtront ici.</p>';
    } else if (failure > 0) {
        statusSection = errorRowsHtml;
    } else if (!isProcessing && success > 0) {
        // Fully done, all rows succeeded
        statusSection = '<p class="text-xs text-gray-500 italic text-center py-4">Toutes les transactions ont été traitées avec succès.</p>';
    } else if (isProcessing) {
        // Processing with some results already in
        statusSection = `<p class="text-xs text-gray-400 italic text-center py-4">${success.toLocaleString('fr-FR')} ligne${success > 1 ? 's' : ''} traitée${success > 1 ? 's' : ''} avec succès — en cours…</p>`;
    } else {
        statusSection = '<p class="text-xs text-gray-400 italic text-center py-4">Aucun résultat disponible.</p>';
    }

    const dashboardHtml = `
        <div class="space-y-4">
            <div class="grid grid-cols-3 gap-3">
                <div class="p-3 bg-gray-50 border border-gray-100 text-center">
                    <p class="text-[10px] uppercase font-bold text-gray-400">Total</p>
                    <p class="text-xl font-black text-gray-800">${(totalRecords || 0).toLocaleString('fr-FR')}</p>
                </div>
                <div class="p-3 bg-green-50 border border-green-100 text-center">
                    <p class="text-[10px] uppercase font-bold text-green-500">Succès</p>
                    <p class="text-xl font-black text-green-700">${success.toLocaleString('fr-FR')}</p>
                </div>
                <div class="p-3 bg-red-50 border border-red-100 text-center">
                    <p class="text-[10px] uppercase font-bold text-red-500">Échecs</p>
                    <p class="text-xl font-black text-red-700">${failure.toLocaleString('fr-FR')}</p>
                </div>
            </div>

            ${totalAmount > 0 ? `
            <div class="bg-indigo-600 p-5 text-white relative overflow-hidden">
                <div class="relative z-10">
                    <p class="text-indigo-100 text-xs font-bold uppercase tracking-widest mb-1">Volume Financier</p>
                    <p class="text-3xl font-black tracking-tight">
                        ${totalAmount.toLocaleString('fr-FR', {style: 'currency', currency: 'XOF'})}
                    </p>
                </div>
                <i data-lucide="banknote" class="absolute -right-1 -bottom-4 w-36 h-36 text-white/30 rotate-12"></i>
            </div>` : ''}

            <div>
                <h4 class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                    ${failure > 0
        ? '<i data-lucide="alert-triangle" class="w-4 h-4 text-orange-500"></i> Journal des anomalies'
        : '<i data-lucide="check-circle" class="w-4 h-4 text-green-500"></i> Statut technique'}
                </h4>
                <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                    ${statusSection}
                </div>
            </div>

            <div class="flex gap-3 pt-2">
                <button onclick="downloadExecutionReport('${batchId}')"
                        class="flex-1 inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">
                    <i data-lucide="printer" class="w-4 h-4"></i>Exporter / Imprimer
                </button>
                <button onclick="closeSummaryModal()"
                        class="px-6 py-2.5 bg-gray-900 text-white text-sm font-bold hover:bg-black transition">
                    Fermer
                </button>
            </div>
        </div>`;

    const contentEl = document.getElementById('batchSummaryContent');
    const titleEl = document.getElementById('batchSummaryTitle');
    if (contentEl) contentEl.innerHTML = dashboardHtml;
    // Title = full filename, fallback to short ID
    if (titleEl) titleEl.innerText = `Résumé : ${originalFilename || batchId.slice(-10)}`;
    if (contentEl && window.lucide) createIcons(contentEl);
};

const viewBatchSummary = async (batchId) => {
    _stopSummaryPoller();
    _summaryBatchId = batchId;
    try {
        const batch = await _refreshSummaryContent(batchId);
        openModal('batchSummaryModal');

        // Start 3-second polling while the batch is still PROCESSING
        if (batch && batch.status === 'PROCESSING') {
            _summaryPoller = setInterval(async () => {
                if (_summaryBatchId !== batchId) {
                    _stopSummaryPoller();
                    return;
                }
                await _refreshSummaryContent(batchId);
            }, 3000);
        }
    } catch (err) {
        console.error('View Summary Error:', err);
        if (window.showSnackbar) showSnackbar(err.message, 'error');
    }
};

const downloadExecutionReport = async (batchId) => {
    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) return;
        if (!res.ok) throw new Error("Impossible de récupérer les données du lot.");
        const batch = await res.json();
        const records = batch.details || [];

        const success = batch.successCount ?? records.filter(r => r.status === 'SUCCESS').length;
        const failure = batch.failureCount ?? records.filter(r => r.status === 'FAILED').length;
        const total = batch.totalRecords || records.length;
        const now = new Date().toLocaleString('fr-FR');

        // ── Financial volume ───────────────────────────────────────────────────
        let volSection = '';
        if (batch.application === 'FUNDS_TRANSFER') {
            const vol = records.reduce((s, r) => {
                return s + (parseFloat(r.data?.['DEBIT.AMOUNT'] || r.data?.['CREDIT.AMOUNT']) || 0);
            }, 0);
            if (vol > 0) {
                volSection = `
                <div class="vol-block">
                    <div class="vol-label">VOLUME FINANCIER</div>
                    <div class="vol-amount">${vol.toLocaleString('fr-FR', {style: 'currency', currency: 'XOF'})}</div>
                </div>`;
            }
        }

        // ── Anomaly journal ────────────────────────────────────────────────────
        const failed = records.filter(r => r.status === 'FAILED');
        let journalSection = '';
        if (!failed.length && !records.length) {
            journalSection = `<div class="empty-msg">Aucun résultat disponible.</div>`;
        } else if (!failed.length) {
            journalSection = `<div class="success-msg">✓ Toutes les transactions ont été traitées avec succès.</div>`;
        } else {
            const rows = failed.map(r => {
                let err = r.errorMessage || '—';
                try {
                    const p = JSON.parse(err);
                    if (p.error?.errorDetails?.[0]?.message) err = p.error.errorDetails[0].message;
                } catch (_) {
                }
                return `<tr><td class="err-line">${r.lineNumber}</td>
                            <td class="err-ref">${escXml(r.t24Reference || 'N/A')}</td>
                            <td class="err-msg">${escXml(err)}</td></tr>`;
            }).join('');
            journalSection = `
                <table class="err-table">
                    <thead><tr>
                        <th>Ligne</th><th>Réf. T24</th><th>Message d'erreur</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
        }

        // ── All rows table ─────────────────────────────────────────────────────
        const fieldSet = new Set();
        records.forEach(r => r.data && Object.keys(r.data).forEach(k => fieldSet.add(k)));
        const dynFields = Array.from(fieldSet).sort();

        const allRowsHtml = records.length ? `
            <h2 class="section-title" style="margin-top:28px">Détail des transactions</h2>
            <table class="data-table">
                <thead><tr>
                    <th>#</th><th>Statut</th><th>Réf. T24</th>
                    ${dynFields.map(f => `<th>${escXml(f)}</th>`).join('')}
                </tr></thead>
                <tbody>
                ${records.map(r => {
            let err = r.errorMessage || '';
            try {
                const p = JSON.parse(err);
                err = p.error?.errorDetails?.[0]?.message || err;
            } catch (_) {
            }
            const cls = r.status === 'SUCCESS' ? 'row-ok' : r.status === 'FAILED' ? 'row-err' : '';
            return `<tr class="${cls}">
                        <td class="td-center">${r.lineNumber}</td>
                        <td class="td-status td-status-${r.status === 'SUCCESS' ? 'ok' : r.status === 'FAILED' ? 'err' : 'pend'}">
                            ${r.status === 'SUCCESS' ? '✓ Succès' : r.status === 'FAILED' ? '✗ Échec' : r.status}
                        </td>
                        <td>${escXml(r.t24Reference || '')}</td>
                        ${dynFields.map(f => `<td>${escXml(String(r.data?.[f] ?? ''))}</td>`).join('')}
                    </tr>`;
        }).join('')}
                </tbody>
            </table>` : '';

        // ── Build full HTML page ───────────────────────────────────────────────
        const filename = batch.originalFilename || batchId;
        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport — ${escXml(filename)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; font-size: 11pt;
       color: #1e293b; background: #fff; padding: 0; }

/* ── Print-only controls ── */
.no-print { display: flex; gap: 10px; padding: 12px 24px; background: #f1f5f9;
            border-bottom: 1px solid #e2e8f0; }
.btn-print { padding: 8px 20px; background: #1a73e8; color: #fff; border: none;
             font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.btn-print:hover { background: #1557b0; }
.btn-close { padding: 8px 20px; background: #fff; color: #64748b;
             border: 1px solid #cbd5e1; font-size: 13px; cursor: pointer; font-family: inherit; }
@media print { .no-print { display: none; } }

/* ── Page ── */
.page { max-width: 900px; margin: 0 auto; padding: 28px 32px; }

/* ── Header ── */
.report-header { background: #0f172a; color: #fff; padding: 20px 28px;
                 margin: 0 0 20px; }
.report-title  { font-size: 16pt; font-weight: 700; }
.report-sub    { font-size: 10pt; color: #94a3b8; margin-top: 4px; }

/* ── Metadata ── */
.meta-grid { display: grid; grid-template-columns: 140px 1fr; gap: 0;
             border: 1px solid #e2e8f0; margin-bottom: 20px; font-size: 10.5pt; }
.meta-label { background: #f8fafc; font-weight: 600; color: #475569;
              padding: 7px 12px; border-bottom: 1px solid #e2e8f0; }
.meta-value { padding: 7px 12px; border-bottom: 1px solid #e2e8f0; color: #1e293b; }
.meta-mono  { font-family: monospace; font-size: 10pt; }

/* ── KPI cards ── */
.kpi-row   { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.kpi-card  { padding: 16px 20px; border: 1px solid #e2e8f0; }
.kpi-label { font-size: 9pt; font-weight: 700; text-transform: uppercase;
             letter-spacing: .08em; color: #64748b; margin-bottom: 6px; }
.kpi-val   { font-size: 26pt; font-weight: 800; line-height: 1; }
.kpi-total { background: #f8fafc; }
.kpi-total .kpi-val { color: #1e293b; }
.kpi-ok    { background: #f0fdf4; border-color: #bbf7d0; }
.kpi-ok    .kpi-label { color: #166534; }
.kpi-ok    .kpi-val   { color: #15803d; }
.kpi-err   { background: #fef2f2; border-color: #fecaca; }
.kpi-err   .kpi-label { color: #991b1b; }
.kpi-err   .kpi-val   { color: #dc2626; }

/* ── Volume ── */
.vol-block  { background: #312e81; color: #fff; padding: 20px 24px; margin-bottom: 20px; }
.vol-label  { font-size: 9pt; font-weight: 700; text-transform: uppercase;
              letter-spacing: .1em; color: #c7d2fe; margin-bottom: 6px; }
.vol-amount { font-size: 22pt; font-weight: 800; }

/* ── Section titles ── */
.section-title { font-size: 11pt; font-weight: 700; color: #334155;
                 margin-bottom: 10px; padding-bottom: 6px;
                 border-bottom: 2px solid #e2e8f0; }

/* ── Anomaly journal / success ── */
.success-msg { background: #f0fdf4; color: #166534; padding: 14px 18px;
               border-left: 4px solid #22c55e; font-style: italic; font-size: 10.5pt; }
.empty-msg   { color: #94a3b8; font-style: italic; padding: 12px 0; }
.err-table   { width: 100%; border-collapse: collapse; font-size: 10pt; }
.err-table th { background: #fef2f2; color: #991b1b; font-weight: 700;
                padding: 8px 12px; text-align: left; border: 1px solid #fecaca; }
.err-table td { padding: 7px 12px; border: 1px solid #fee2e2; vertical-align: top; }
.err-line  { font-weight: 700; color: #dc2626; white-space: nowrap; width: 60px; }
.err-ref   { font-family: monospace; font-size: 9.5pt; width: 130px; }
.err-msg   { color: #7f1d1d; }

/* ── All rows table ── */
.data-table   { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 4px; }
.data-table th { background: #1a73e8; color: #fff; font-weight: 700; padding: 7px 10px;
                 text-align: left; border: 1px solid #1557b0; white-space: nowrap; }
.data-table td { padding: 5px 8px; border: 1px solid #e2e8f0; }
.td-center     { text-align: center; }
.row-ok        { background: #f0fdf4; }
.row-err       { background: #fef2f2; }
.td-status     { font-weight: 600; text-align: center; white-space: nowrap; }
.td-status-ok  { color: #166534; }
.td-status-err { color: #dc2626; }
.td-status-pend{ color: #92400e; }

/* ── Print ── */
@media print {
    @page { margin: 14mm 12mm; size: A4; }
    .page { padding: 0; max-width: 100%; }
    .report-header { margin: 0 0 14px; }
    .data-table { font-size: 8pt; }
    .data-table th, .data-table td { padding: 4px 6px; }
    .err-table th, .err-table td { padding: 5px 8px; }
}
</style>
</head>
<body>
<!-- Print controls (hidden on print) -->
<div class="no-print">
    <button class="btn-print" onclick="window.print()">🖨 Imprimer / Enregistrer en PDF</button>
    <button class="btn-close" onclick="window.close()">Fermer</button>
</div>

<div class="page">
    <!-- Header -->
    <div class="report-header">
        <div class="report-title">Rapport d'exécution FLUX</div>
        <div class="report-sub">Orange Bank · Exporté le ${now}</div>
    </div>

    <!-- Metadata -->
    <div class="meta-grid">
        <div class="meta-label">Fichier</div>
        <div class="meta-value">${escXml(filename)}</div>
        <div class="meta-label">Application</div>
        <div class="meta-value">${escXml(batch.application || '—')}</div>
        <div class="meta-label">Lot ID</div>
        <div class="meta-value meta-mono">${escXml(batchId)}</div>
        <div class="meta-label">Statut</div>
        <div class="meta-value">${escXml(batch.status || '—')}</div>
    </div>

    <!-- KPI -->
    <div class="kpi-row">
        <div class="kpi-card kpi-total">
            <div class="kpi-label">Total lignes</div>
            <div class="kpi-val">${total.toLocaleString('fr-FR')}</div>
        </div>
        <div class="kpi-card kpi-ok">
            <div class="kpi-label">Succès</div>
            <div class="kpi-val">${success.toLocaleString('fr-FR')}</div>
        </div>
        <div class="kpi-card kpi-err">
            <div class="kpi-label">Échecs</div>
            <div class="kpi-val">${failure.toLocaleString('fr-FR')}</div>
        </div>
    </div>

    <!-- Volume financier -->
    ${volSection}

    <!-- Anomaly journal -->
    <h2 class="section-title">Statut technique</h2>
    ${journalSection}

    <!-- Full rows -->
    ${allRowsHtml}
</div>
</body>
</html>`;

        // Open in new tab → user prints or saves as PDF
        const win = window.open('', '_blank');
        if (!win) {
            showSnackbar("Autorisez les popups pour ce site afin d'exporter.", 'error');
            return;
        }
        win.document.write(html);
        win.document.close();
    } catch (err) {
        console.error('Export Error:', err);
        showSnackbar('Erreur export : ' + err.message, 'error');
    }
};

window.viewBatchSummary = viewBatchSummary;
window.downloadExecutionReport = downloadExecutionReport;
window._stopSummaryPoller = _stopSummaryPoller;

/** Escape special XML/HTML characters — used by both batch export and reports export */
function escXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.escXml = escXml;

/** Named helper used by layout.html onclick — avoids {;} syntax that breaks Qute */
const closeSummaryModal = () => {
    _stopSummaryPoller();
    closeModal('batchSummaryModal');
};
window.closeSummaryModal = closeSummaryModal;
// ─────────────────────────────────────────────────────────────────────────────
// SCOPED LUCIDE HELPER
// Use createIcons(el) after any dynamic render to scan only the updated
// subtree instead of the whole DOM.  Omit el for one-time full-page inits.
// ─────────────────────────────────────────────────────────────────────────────
const createIcons = (el) => {
    if (!window.lucide) return;
    lucide.createIcons(el ? {nodes: Array.isArray(el) ? el : [el]} : undefined);
};
window.createIcons = createIcons;

window.secureFetch = secureFetch;
window.fetchCached = fetchCached;
window.bustCache = bustCache;

// ─────────────────────────────────────────────────────────────────────────────
// INLINE PROGRESS BAR — shared between INPUTTER (/batches) and AUTHORISER (/validated)
// buildProgressRowHTML, inject/update/remove helpers, and keyframe injection
// live here so both pages get the same bar without duplicating code.
// ─────────────────────────────────────────────────────────────────────────────

function buildProgressRowHTML(d) {
    const total = d.total || 0;
    const successCount = d.successCount || 0;
    const failureCount = d.failureCount || 0;
    const done = successCount + failureCount;
    const pending = Math.max(0, total - done);
    const pct = total > 0 ? Math.min(100, Math.round(done * 100 / total)) : 0;
    const sp = total > 0 ? (successCount / total * 100).toFixed(3) : 0;
    const fp = total > 0 ? (failureCount / total * 100).toFixed(3) : 0;
    const isDone = pct >= 100;
    const hasFailure = failureCount > 0;
    const accent = isDone ? (hasFailure ? '#ea4335' : '#34a853') : '#1a73e8';

    const label = isDone
        ? (hasFailure
            ? `<span style="color:#c5221f">✗ Terminé — ${failureCount.toLocaleString('fr-FR')} ligne${failureCount > 1 ? 's' : ''} échouée${failureCount > 1 ? 's' : ''}</span>`
            : `<span style="color:#188038">✓ Traitement terminé</span>`)
        : `<span style="color:#1a73e8">En cours de traitement...</span>`;

    const pendingSegment = pending > 0
        ? `<div style="flex:1;background:#e8eaed;position:relative;overflow:hidden">
               <div style="position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(26,115,232,.18),transparent);animation:g-shimmer 1.6s ease-in-out infinite"></div>
           </div>`
        : '';

    return `<td colspan="4" style="padding:0 0 6px;background:#f8f9fa;border-top:none">
        <div style="margin:0 4px;border-left:3px solid ${accent};background:#fff;
                    box-shadow:0 1px 2px rgba(0,0,0,.06);padding:9px 16px 9px 12px;
                    transition:border-color .4s ease">
            <div style="display:flex;justify-content:space-between;align-items:center;
                        margin-bottom:8px;font-size:12px;font-weight:500">
                ${label}
                <span style="color:var(--ink-2,#111);font-size:13px;font-weight:500;
                             font-variant-numeric:tabular-nums">
                    ${pct}<span style="font-size:10px;font-weight:400;color:var(--ink-3,#80868b);margin-left:1px">%</span>
                </span>
            </div>
            <div style="height:6px;overflow:hidden;display:flex;background:#e8eaed;margin-bottom:9px">
                <div style="width:${sp}%;background:#34a853;transition:width .5s ease;
                            min-width:${successCount > 0 ? '3px' : '0'}"></div>
                <div style="width:${fp}%;background:#ea4335;transition:width .5s ease;
                            min-width:${failureCount > 0 ? '3px' : '0'}"></div>
                ${pendingSegment}
            </div>
            <div style="display:flex;align-items:center;flex-wrap:wrap;row-gap:4px">
                <div style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 6px;
                            background:#e6f4ea;border-radius:99px;margin-right:7px">
                    <span style="width:6px;height:6px;border-radius:50%;background:#34a853;flex-shrink:0"></span>
                    <span style="font-size:10px;font-weight:500;color:#188038">
                        ${successCount.toLocaleString('fr-FR')} réussie${successCount !== 1 ? 's' : ''}
                    </span>
                </div>
                <div style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 6px;
                            background:${failureCount > 0 ? '#fce8e6' : '#f1f3f4'};border-radius:99px;margin-right:7px">
                    <span style="width:6px;height:6px;border-radius:50%;background:${failureCount > 0 ? '#ea4335' : '#bdc1c6'};flex-shrink:0"></span>
                    <span style="font-size:10px;font-weight:500;color:${failureCount > 0 ? '#c5221f' : '#80868b'}">
                        ${failureCount.toLocaleString('fr-FR')} échouée${failureCount !== 1 ? 's' : ''}
                    </span>
                </div>
                ${pending > 0 ? `
                <div style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 6px;
                            background:#e8f0fe;border-radius:99px">
                    <span style="width:6px;height:6px;border-radius:50%;background:#4285f4;flex-shrink:0;
                                 animation:g-pulse 1.2s ease-in-out infinite"></span>
                    <span style="font-size:10px;font-weight:500;color:#1967d2">
                        ${pending.toLocaleString('fr-FR')} en attente
                    </span>
                </div>` : ''}
                <span style="margin-left:auto;font-size:10px;color:#80868b;white-space:nowrap;
                             font-variant-numeric:tabular-nums">
                    ${done.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} lignes
                </span>
            </div>
        </div>
    </td>`;
}

const _progressRowId = (batchId) => `progress-row-${batchId}`;

function injectProgressRow(batchId, data) {
    const batchRow = document.querySelector(`tr[data-batch-id="${batchId}"]`);
    if (!batchRow) return;
    document.getElementById(_progressRowId(batchId))?.remove();
    const tr = document.createElement('tr');
    tr.id = _progressRowId(batchId);
    tr.innerHTML = buildProgressRowHTML(data);
    batchRow.insertAdjacentElement('afterend', tr);
}

function updateProgressRow(batchId, data) {
    const row = document.getElementById(_progressRowId(batchId));
    if (!row) {
        injectProgressRow(batchId, data);
        return;
    }
    row.innerHTML = buildProgressRowHTML(data);
}

function removeProgressRow(batchId) {
    document.getElementById(_progressRowId(batchId))?.remove();
}

// Inject animation keyframes once for all pages
if (!document.getElementById('progress-pulse-style')) {
    const s = document.createElement('style');
    s.id = 'progress-pulse-style';
    s.textContent = `
        @keyframes g-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        @keyframes g-pulse{0%,100%{opacity:1}50%{opacity:.35}}
    `;
    document.head.appendChild(s);
}

window.buildProgressRowHTML = buildProgressRowHTML;
window.injectProgressRow = injectProgressRow;
window.updateProgressRow = updateProgressRow;
window.removeProgressRow = removeProgressRow;