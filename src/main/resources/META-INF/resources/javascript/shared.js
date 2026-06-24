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
const getStatusBadge = (status) => {
    const types = {
        UPLOADED: {bg: '#f1f3f4', color: '#5f6368', icon: 'clock', label: 'Importé'},
        VALIDATED: {bg: '#e8f0fe', color: '#1967d2', icon: 'user-check', label: 'Validé'},
        PROCESSING: {bg: '#e8f0fe', color: '#1967d2', icon: 'refresh-cw', label: 'En cours', spin: true},
        PROCESSED: {bg: '#e6f4ea', color: '#137333', icon: 'check-circle', label: 'Terminé'},
        PROCESSED_WITH_ERROR: {bg: '#fef3e8', color: '#b06000', icon: 'alert-triangle', label: 'Partiel'},
        UPLOADED_FAILED: {bg: '#fce8e6', color: '#c5221f', icon: 'alert-circle', label: 'Échec import'},
        VALIDATED_FAILED: {bg: '#fce8e6', color: '#c5221f', icon: 'x-circle', label: 'Échec sig.'},
        PROCESSED_FAILED: {bg: '#fce8e6', color: '#c5221f', icon: 'x-circle', label: 'Échec'}
    };
    const d = types[status] || {
        bg: '#f1f3f4',
        color: '#80868b',
        icon: 'help-circle',
        label: status?.replace(/_/g, ' ') || '—'
    };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;
                border-radius:99px;font-size:10px;font-weight:500;letter-spacing:.03em;
                background:${d.bg};color:${d.color};">
                <i data-lucide="${d.icon}" style="width:11px;height:11px;${d.spin ? 'animation:spin 1s linear infinite' : ''}"></i>
                ${d.label}
            </span>`;
};

const formatDateParts = (iso) => {
    if (!iso) return {date: '—', time: ''};
    const d = new Date(iso);
    return {
        date: d.toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit', year: 'numeric'}),
        time: d.toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'})
    };
};

const appBadgeHTML = (application) => {
    const map = {
        FUNDS_TRANSFER: {bg: '#fff3e8', color: '#c45d00', label: 'FT'},
        FUNDS_TRANSFER_REVERSAL: {bg: '#e8f0fe', color: '#1967d2', label: 'FTR'}
    };
    const d = map[application] || {bg: '#f1f3f4', color: '#5f6368', label: (application || 'N/A').slice(0, 5)};
    return `<span style="font-size:10px;padding:1px 6px;background:${d.bg};color:${d.color};font-weight:500;letter-spacing:.03em" title="${application || ''}">${d.label}</span>`;
};

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
    const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
    if (!res || !res.ok) {
        _stopSummaryPoller();
        return null;
    }
    const batch = await res.json();
    _renderSummaryHTML(batch, batchId);
    if (batch.status !== 'PROCESSING') _stopSummaryPoller(); // done — stop polling
    return batch;
};

/** Build and inject the summary modal HTML */
const _renderSummaryHTML = (batch, batchId) => {
    const {application, totalRecords, details, successCount, failureCount, status} = batch;

    const success = (successCount !== undefined && successCount !== null)
        ? successCount
        : (details ? details.filter(r => r.status === 'SUCCESS').length : 0);
    const failure = (failureCount !== undefined && failureCount !== null)
        ? failureCount
        : (details ? details.filter(r => r.status === 'FAILED').length : 0);

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
                } catch (e) { /* keep original */
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

    // Live badge shown while PROCESSING
    const liveBadge = status === 'PROCESSING'
        ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:500;
                         color:#1d4ed8;background:#eff6ff;padding:2px 8px;margin-bottom:8px">
               <span style="width:6px;height:6px;border-radius:50%;background:#3b82f6;
                            animation:g-pulse 1.2s ease-in-out infinite;display:inline-block"></span>
               En cours — mise à jour en direct
           </span>`
        : '';

    const dashboardHtml = `
        <div class="space-y-4">
            ${liveBadge}
            <div class="grid grid-cols-3 gap-3">
                <div class="p-3 bg-gray-50 border border-gray-100 text-center">
                    <p class="text-[10px] uppercase font-bold text-gray-400">Total</p>
                    <p class="text-xl font-black text-gray-800">${totalRecords || (success + failure)}</p>
                </div>
                <div class="p-3 bg-green-50 border border-green-100 text-center">
                    <p class="text-[10px] uppercase font-bold text-green-500">Succès</p>
                    <p class="text-xl font-black text-green-700">${success}</p>
                </div>
                <div class="p-3 bg-red-50 border border-red-100 text-center">
                    <p class="text-[10px] uppercase font-bold text-red-500">Échecs</p>
                    <p class="text-xl font-black text-red-700">${failure}</p>
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
                    ${failure > 0
        ? errorRowsHtml
        : '<p class="text-xs text-gray-500 italic text-center py-4">Toutes les transactions ont été traitées avec succès.</p>'}
                </div>
            </div>

            <div class="flex gap-3 pt-2">
                <button onclick="downloadExecutionReport('${batchId}')"
                        class="flex-1 inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">
                    <i data-lucide="download" class="w-4 h-4"></i>Rapport CSV
                </button>
                <button onclick="_stopSummaryPoller(); closeModal('batchSummaryModal')"
                        class="px-6 py-2.5 bg-gray-900 text-white text-sm font-bold hover:bg-black transition">
                    Fermer
                </button>
            </div>
        </div>`;

    const contentEl = document.getElementById('batchSummaryContent');
    const titleEl = document.getElementById('batchSummaryTitle');
    if (contentEl) contentEl.innerHTML = dashboardHtml;
    if (titleEl) titleEl.innerText = `Résumé : ${batchId.slice(-10)}`;
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
        const records = batch.details;
        if (!records || records.length === 0) {
            showSnackbar("Aucune donnée disponible pour l'export.", 'info');
            return;
        }
        let allFields = new Set();
        records.forEach(item => {
            if (item.data) Object.keys(item.data).forEach(k => {
                if (item.data[k] !== null && item.data[k] !== undefined) allFields.add(k);
            });
        });
        const dynamicFields = Array.from(allFields).sort();
        const headers = ['Ligne', 'Statut T24', 'Reference T24', 'Message Erreur', ...dynamicFields];
        const csvRows = records.map(r => {
            let cleanError = r.errorMessage || '';
            if (r.status === 'FAILED' && cleanError.startsWith('{')) {
                try {
                    cleanError = JSON.parse(cleanError).error?.errorDetails?.[0]?.message || cleanError;
                } catch (e) {
                }
            }
            const row = [r.lineNumber, `"${r.status}"`, `"${r.t24Reference || 'N/A'}"`,
                `"${cleanError.replace(/"/g, '""')}"`];
            dynamicFields.forEach(f => {
                const v = r.data?.[f] ?? '';
                row.push(`"${v.toString().replace(/"/g, '""')}"`);
            });
            return row;
        });
        const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
        const blob = new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Report_${batch.application}_${batchId.slice(-8)}.csv`;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showSnackbar('Rapport CSV généré avec succès', 'success');
    } catch (err) {
        showSnackbar('Erreur export : ' + err.message, 'error');
    }
};

window.viewBatchSummary = viewBatchSummary;
window.downloadExecutionReport = downloadExecutionReport;
window._stopSummaryPoller = _stopSummaryPoller;
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