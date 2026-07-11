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
            for (let i = 0; i < ca.length; i++) {
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
        const regionNames = new Intl.DisplayNames(['fr'], {type: 'region'});
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
/**
 * Shared pagination renderer — single source of truth for pagination UI so
 * every list (reports, audit, …) looks and behaves identically.
 *
 * Emits the reports-style bar: an "Affichage de X à Y sur Z <label>" summary
 * on the left, and  Précédent · Page N sur M · Suivant  on the right, using
 * the .btn-flux button class.
 *
 * @param {HTMLElement|string} target   container element or its id
 * @param {object} opts
 *   page        {number} current page, 1-based
 *   totalPages  {number} total number of pages
 *   totalItems  {number} total item count (for the summary)
 *   itemLabel   {string} plural noun, e.g. "lots", "événements"
 *   pageSize    {number} items per page (to compute the X–Y range)
 *   onGo        {string} name of a global fn taking a 1-based page number
 */
const renderPagination = (target, opts) => {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;

    const {page = 1, totalPages = 1, totalItems = 0, itemLabel = '', pageSize = 0, onGo} = opts;

    if (totalPages <= 1 && totalItems <= pageSize) {
        el.innerHTML = '';
        return;
    }

    const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, totalItems);
    const summary = pageSize
        ? `Affichage de <span class="tnum">${from.toLocaleString('fr-FR')}</span> à <span class="tnum">${to.toLocaleString('fr-FR')}</span> sur <span class="tnum">${totalItems.toLocaleString('fr-FR')}</span> ${itemLabel}`
        : `<span class="tnum">${totalItems.toLocaleString('fr-FR')}</span> ${itemLabel}`;

    el.innerHTML = `
        <div class="p-4 border-t border-gray-200 flex items-center justify-between flex-wrap gap-3">
            <div style="font-size:var(--text-sm);color:var(--ink-3);">${summary}</div>
            <div class="flex items-center gap-2">
                <button class="btn-flux disabled:opacity-50 disabled:cursor-not-allowed"
                        onclick="${onGo}(${page - 1})" ${page <= 1 ? 'disabled' : ''}
                        style="padding:.4rem .7rem;font-size:.72rem;">Précédent</button>
                <span style="font-size:var(--text-sm);color:var(--ink-3);">
                    Page <span class="tnum">${page}</span> sur <span class="tnum">${totalPages}</span>
                </span>
                <button class="btn-flux disabled:opacity-50 disabled:cursor-not-allowed"
                        onclick="${onGo}(${page + 1})" ${page >= totalPages ? 'disabled' : ''}
                        style="padding:.4rem .7rem;font-size:.72rem;">Suivant</button>
            </div>
        </div>`;
};
window.renderPagination = renderPagination;

/**
 * Consistent empty & loading states. Replaces the scattered, differently-styled
 * "Chargement…" / "Aucun…" snippets across pages with one look (see the
 * .state-block classes in flux-harmonization.css).
 *
 *   emptyState('Aucun lot trouvé')                  → block
 *   emptyState('Aucun lot', {icon:'inbox'})         → block with a Lucide icon
 *   loadingState('Chargement des lots…')            → block with spinner
 *   emptyStateRow(colspan, 'Aucun lot')             → <tr><td colspan=…> variant
 *   loadingStateRow(colspan, 'Chargement…')         → table loading row
 */
const loadingState = (message = 'Chargement…', opts = {}) => {
    const cls = opts.compact ? 'state-block state-compact' : 'state-block';
    return `<div class="${cls}">
        <svg class="state-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        </svg>
        <span>${escapeHtmlShared(message)}</span>
    </div>`;
};

const emptyState = (message = 'Aucune donnée', opts = {}) => {
    const cls = opts.compact ? 'state-block state-compact' : 'state-block';
    const icon = opts.icon
        ? `<i data-lucide="${opts.icon}" style="width:22px;height:22px"></i>`
        : '';
    return `<div class="${cls}">${icon}<span>${escapeHtmlShared(message)}</span></div>`;
};

const loadingStateRow = (colspan, message = 'Chargement…') =>
    `<tr><td colspan="${colspan}" style="padding:0">${loadingState(message)}</td></tr>`;

const emptyStateRow = (colspan, message = 'Aucune donnée', opts = {}) =>
    `<tr><td colspan="${colspan}" style="padding:0">${emptyState(message, opts)}</td></tr>`;

// Minimal HTML escaper for the message text (defensive; messages are usually static).
const escapeHtmlShared = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

window.loadingState = loadingState;
window.emptyState = emptyState;
window.loadingStateRow = loadingStateRow;
window.emptyStateRow = emptyStateRow;

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
            return new Promise(() => {
            });
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
                    el.style.color = '#FF7900';
                    setTimeout(() => {
                        el.style.color = '';
                    }, 600);
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
// Three tiers, all rendered with the .badge / .badge-* classes defined in
// flux-harmonization.css (rectangular, hairline border, uppercase micro type).
// Tones map 1:1 to the semantic --status-* token families.
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

// Shared status-filter chips (Batches / Validated lists) — fixed set of 5:
// Tous / En attente et Validé / En traitement / Traité et Traité avec erreurs / Échec.
// Each chip can represent more than one underlying status.
const STATUS_FILTER_GROUPS = [
    {key: 'all', label: 'Tous', tone: null, statuses: null},
    {key: 'pending_validated', label: 'En attente et Validé', tone: 'pending', statuses: ['UPLOADED', 'VALIDATED']},
    {key: 'processing', label: 'En traitement', tone: 'processing', statuses: ['PROCESSING']},
    {
        key: 'processed',
        label: 'Traité et Traité avec erreurs',
        tone: 'success',
        statuses: ['PROCESSED', 'PROCESSED_WITH_ERROR']
    },
    {
        key: 'failed',
        label: 'Échec',
        tone: 'error',
        statuses: ['PROCESSED_FAILED', 'UPLOADED_FAILED', 'VALIDATED_FAILED']
    },
];
window.STATUS_FILTER_GROUPS = STATUS_FILTER_GROUPS;

// Returns the list of raw status strings a given chip key represents,
// or null for 'all' (meaning: no filtering).
function statusesForFilterKey(key) {
    const g = STATUS_FILTER_GROUPS.find(g => g.key === key);
    return g ? g.statuses : null;
}

window.statusesForFilterKey = statusesForFilterKey;

function renderStatusFilterChips(containerId, currentFilter, onSelect) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = STATUS_FILTER_GROUPS.map(d => {
        const active = currentFilter === d.key;
        const c = d.tone ? _BADGE_TOKENS[d.tone] : null;
        let bg, color, border;
        if (c) {
            bg = active ? c.color : c.bg;
            color = active ? '#fff' : c.color;
            border = c.border;
        } else {
            bg = active ? '#1B1B1B' : '#fff';
            color = active ? '#fff' : 'var(--ink-2)';
            border = active ? '#1B1B1B' : 'var(--line)';
        }
        return `<span data-filter-key="${d.key}"
                       style="padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;
                              border:1.5px solid ${border};background:${bg};color:${color};white-space:nowrap">${d.label}</span>`;
    }).join('');
    el.querySelectorAll('[data-filter-key]').forEach(chip => {
        chip.addEventListener('click', () => onSelect(chip.dataset.filterKey));
    });
}

window.renderStatusFilterChips = renderStatusFilterChips;

// Empty state for a filtered table body. If there's an active search query,
// show "no results for «query»"; otherwise (filter chip alone yielded zero
// rows) show the same icon + message treatment used on the Validate queue,
// rather than a hollow "Aucun résultat pour «  »" with nothing in the quotes.
function emptyFilterRowHTML(query, colspan, message) {
    if (query && query.trim()) {
        return emptyStateRow(colspan, `Aucun résultat pour « ${query} »`, {compact: true});
    }
    return emptyStateRow(colspan, message || 'Aucun lot ne correspond à ce filtre', {icon: 'inbox'});
}

window.emptyFilterRowHTML = emptyFilterRowHTML;

// Orange Design System semantic status tokens (bg / text / border).
// Badges themselves are styled by .badge classes; these tokens remain for
// the status filter chips, which derive active/inactive fills from them.
const _BADGE_TOKENS = {
    pending: {
        bg: 'var(--status-pending-bg, #F6F6F6)',
        color: 'var(--status-pending-text, #595959)',
        border: 'var(--status-pending-border, #E0E0E0)'
    },
    validated: {
        bg: 'var(--status-validated-bg, #EAF1FE)',
        color: 'var(--status-validated-text, #0B5ED7)',
        border: 'var(--status-validated-border, #C3D9FB)'
    },
    processing: {
        bg: 'var(--status-processing-bg, #FFF1E6)',
        color: 'var(--status-processing-text, #C65B00)',
        border: 'var(--status-processing-border, #FFD9B8)'
    },
    success: {
        bg: 'var(--status-success-bg, #E9F7EF)',
        color: 'var(--status-success-text, #127A3E)',
        border: 'var(--status-success-border, #BEEAD1)'
    },
    warning: {
        bg: 'var(--status-warning-bg, #FFF6E0)',
        color: 'var(--status-warning-text, #8A5A00)',
        border: 'var(--status-warning-border, #F3DFA0)'
    },
    error: {
        bg: 'var(--status-error-bg, #FDEDEB)',
        color: 'var(--status-error-text, #B42318)',
        border: 'var(--status-error-border, #F5C4BB)'
    },
};

// Tier 1 — workflow status badges (with icon), driven by the FileBatch status enum.
// This is the single source of truth for status styling — reused on the dashboard
// spine legend, batches list, validate cards, the batch detail modal, AND the
// CSV / PDF exports (via statusLabel), so every surface speaks the same French.
const STATUS_META = {
    UPLOADED: {t: 'pending', icon: 'clock', label: 'En attente', spin: false},
    VALIDATED: {t: 'validated', icon: 'clock', label: 'Validé', spin: false},
    PROCESSING: {t: 'processing', icon: 'refresh-cw', label: 'En traitement', spin: true},
    PROCESSED: {t: 'success', icon: 'check-circle', label: 'Traité', spin: false},
    PROCESSED_WITH_ERROR: {t: 'warning', icon: 'check-circle', label: 'Traité avec erreurs', spin: false},
    UPLOADED_FAILED: {t: 'error', icon: 'alert-circle', label: 'Échec import', spin: false},
    VALIDATED_FAILED: {t: 'error', icon: 'x-circle', label: 'Échec sig.', spin: false},
    PROCESSED_FAILED: {t: 'error', icon: 'x-circle', label: 'Échec', spin: false},
};

// Plain French label for a status enum — used by exports where no HTML/icon fits.
const statusLabel = (status) => (STATUS_META[status] || {}).label || (status ? status.replace(/_/g, ' ') : '—');
window.statusLabel = statusLabel;

const getStatusBadge = (status) => {
    const d = STATUS_META[status] || {
        t: 'pending',
        icon: 'help-circle',
        label: status?.replace(/_/g, ' ') || '—',
        spin: false
    };
    return `<span class="badge badge-${d.t}">
        <i data-lucide="${d.icon}"${d.spin ? ' style="animation:spin 1s linear infinite"' : ''}></i>
        ${d.label}
    </span>`;
};

// Tier 2 — category labels (application type codes, no icon)
const appBadgeHTML = (application) => {
    const map = {
        FUNDS_TRANSFER: {t: 'processing', label: 'FT'},
        FUNDS_TRANSFER_REVERSAL: {t: 'validated', label: 'FTR'},
        SICA_TRANSFER: {t: 'processing', label: 'SICA'},
        VIREMENT_SALAIRE: {t: 'processing', label: 'PAIE'},
    };
    const d = map[application] || {t: 'pending', label: (application || 'N/A').slice(0, 5)};
    return `<span class="badge badge-${d.t}" title="${application || ''}">${d.label}</span>`;
};

// Tier 3 — property labels (REQUIS, ACTIF, INACTIF — exported for reuse)
const propertyBadge = (label, tone) => {
    const t = ['pending', 'validated', 'processing', 'success', 'warning', 'error'].includes(tone) ? tone : 'pending';
    return `<span class="badge badge-${t}">${label}</span>`;
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
        <thead><tr style="border-bottom:1px solid var(--line-soft,#e9eaec)">${
        Array(cols).fill('').map(() => `<th style="padding:10px 16px;text-align:left">${bar(50)}</th>`).join('')
    }</tr></thead>
        <tbody>${Array(rows).fill('').map((_, ri) => `<tr style="border-bottom:1px solid var(--line-soft,#e9eaec)">${
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
            `<th style="padding:8px 12px;white-space:nowrap;font-size:10px;font-weight:700;
                color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;
                text-align:left;border-bottom:1px solid var(--line-soft);
                position:sticky;top:0;background:var(--canvas)">${k}</th>`
        ).join('');

        const bodyRows = details.map((r, idx) => {
            const isOdd = idx % 2 === 1;
            const isFailed = r.status === 'FAILED';
            const rowBg = isFailed ? '#fff8f8' : isOdd ? '#fafafa' : '#ffffff';
            const dataCells = nonNullKeys.map(k =>
                `<td style="padding:7px 12px;font-size:11px;color:var(--ink-2);
                    border-bottom:1px solid var(--line-soft);white-space:nowrap;
                    max-width:180px;overflow:hidden;text-overflow:ellipsis"
                    title="${String(r.data?.[k] ?? '')}">${r.data?.[k] ?? ''}</td>`
            ).join('');
            const statusCell = `<td style="padding:7px 12px;border-bottom:1px solid var(--line-soft)">${getStatusBadge(r.status)}</td>`;
            const refCell = `<td style="padding:7px 12px;font-size:10px;color:var(--ink-3);
                font-family:monospace;border-bottom:1px solid var(--line-soft)">${r.t24Reference || '—'}</td>`;
            return `<tr style="background:${rowBg}">${dataCells}${refCell}${statusCell}</tr>`;
        }).join('');

        content.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
                <div style="display:flex;gap:16px;font-size:12px">
                    <span style="color:var(--ink-3)">${total} lignes</span>
                    ${success > 0 ? `<span style="color:var(--status-success-text)">✓ ${success} succès</span>` : ''}
                    ${failed > 0 ? `<span style="color:var(--status-error-text)">✗ ${failed} échecs</span>` : ''}
                </div>
                <button onclick="downloadBatchNonNull('${batchId}')"
                        style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;
                               font-size:11px;font-weight:500;background:var(--orange);color:#fff;border:none;cursor:pointer">
                    <i data-lucide="download" style="width:13px;height:13px"></i>CSV complet
                </button>
            </div>
            <div style="overflow:auto;max-height:460px;border:1px solid var(--line)">
                <table style="min-width:100%;border-collapse:collapse">
                    <thead>
                        <tr>
                            ${headerCells}
                            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--ink-3);
                                text-transform:uppercase;letter-spacing:.06em;text-align:left;
                                border-bottom:1px solid var(--line-soft);position:sticky;top:0;
                                background:var(--canvas);white-space:nowrap">Réf. T24</th>
                            <th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--ink-3);
                                text-transform:uppercase;letter-spacing:.06em;text-align:left;
                                border-bottom:1px solid var(--line-soft);position:sticky;top:0;
                                background:var(--canvas)">Statut</th>
                        </tr>
                    </thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>`;
        createIcons(content);
    } catch (err) {
        content.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--status-error-text);font-size:13px">${err.message}</div>`;
    }
};

// ---------------------------------------------------------------
// DOWNLOAD BATCH AS CSV
// Adds two leading columns — Statut (SUCCÈS / ÉCHEC) and Erreur —
// and sorts failed rows to the top, so the uploader can open the file,
// filter Statut = ÉCHEC, read why each row failed, fix them, re-upload.
// ---------------------------------------------------------------
const downloadBatchNonNull = async (batchId) => {
    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}: Erreur API`);

        const {details} = await res.json();

        if (!details?.length) return showSnackbar("Aucune donnée à télécharger", "error");

        // CSV quoting for any field with a comma, quote or newline.
        const q = (v) => {
            const s = (v ?? "").toString();
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };

        // Original data columns, dropping the ones that are empty everywhere.
        const keys = Object.keys(details[0].data);
        const dataKeys = keys.filter(k => details.some(r => r.data[k] != null && r.data[k] !== ""));

        // Failed rows first so they're at the top of the file.
        const rows = [...details].sort((a, b) =>
            (a.status === 'FAILED' ? 0 : 1) - (b.status === 'FAILED' ? 0 : 1));

        const header = ['Statut', 'Erreur', 'Réf. T24', ...dataKeys];
        const csvLines = [
            header.map(q).join(","),
            ...rows.map(r => [
                r.status === 'FAILED' ? 'ÉCHEC' : 'SUCCÈS',
                r.status === 'FAILED' ? (r.errorMessage || 'Erreur non précisée') : '',
                r.t24Reference || '',
                ...dataKeys.map(k => r.data?.[k] ?? '')
            ].map(q).join(","))
        ].join("\r\n");

        // UTF-8 BOM so Excel reads accented column names/values correctly.
        const blob = new Blob(['\ufeff' + csvLines], {type: "text/csv;charset=utf-8;"});
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `batch_${batchId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

        const nbFailed = details.filter(r => r.status === 'FAILED').length;
        showSnackbar(nbFailed
            ? `CSV téléchargé — ${nbFailed} ligne${nbFailed > 1 ? 's' : ''} en échec en haut du fichier`
            : "CSV téléchargé", "success");
    } catch (err) {
        showSnackbar("Erreur: " + err.message, "error");
    }
};

// -----------------------------
// MODALS & LOGOUT
// -----------------------------
const openModal = (id) => {
    const m = document.getElementById(id);
    if (m) {
        m.classList.remove("hidden");
        m.classList.add("flex");
    }
};

const closeModal = (id) => {
    const m = document.getElementById(id);
    if (m) {
        m.classList.add("hidden");
        m.classList.remove("flex");
    }
};

const logoutUser = async () => {
    sessionStorage.clear();
    localStorage.clear();
    try {
        await fetch(`${API_BASE}/logout`, {method: "POST"});
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
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
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
                dot.style.background = 'var(--chrome-ok, #2EA25C)';
                badge.style.borderColor = 'var(--chrome-ok-line, rgba(46,162,92,.35))';
                badge.style.background = 'var(--chrome-ok-bg, rgba(46,162,92,.12))';
                label.style.color = 'var(--chrome-ok-text, #6FCE96)';
                label.textContent = 'Système ouvert';
            } else {
                dot.style.background = 'var(--chrome-alert, #D6493C)';
                badge.style.borderColor = 'var(--chrome-alert-line, rgba(214,73,60,.35))';
                badge.style.background = 'var(--chrome-alert-bg, rgba(214,73,60,.12))';
                label.style.color = 'var(--chrome-alert-text, #E8887D)';
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
                <button onclick="downloadBatchNonNull('${batchId}')"
                        class="flex-1 inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-sm font-bold text-gray-700 hover:bg-gray-50 transition">
                    <i data-lucide="download" class="w-4 h-4"></i>Télécharger le CSV
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

window.viewBatchSummary = viewBatchSummary;
window._stopSummaryPoller = _stopSummaryPoller;

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
    const accent = isDone ? (hasFailure ? 'var(--status-error-text)' : 'var(--status-success-text)') : 'var(--orange)';

    const label = isDone
        ? (hasFailure
            ? `<span style="color:var(--status-error-text)">✗ Terminé — ${failureCount.toLocaleString('fr-FR')} ligne${failureCount > 1 ? 's' : ''} échouée${failureCount > 1 ? 's' : ''}</span>`
            : `<span style="color:var(--status-success-text)">✓ Traitement terminé</span>`)
        : `<span style="color:var(--status-processing-text)">En cours de traitement...</span>`;

    const pendingSegment = pending > 0
        ? `<div style="flex:1;background:var(--line-soft);position:relative;overflow:hidden">
               <div style="position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,121,0,.18),transparent);animation:g-shimmer 1.6s ease-in-out infinite"></div>
           </div>`
        : '';

    return `<td colspan="4" style="padding:0 0 6px;background:var(--canvas);border-top:none">
        <div style="margin:0 4px;border-left:3px solid ${accent};background:#fff;border-top:1px solid var(--line);border-right:1px solid var(--line);border-bottom:1px solid var(--line);
                    padding:9px 16px 9px 12px;
                    transition:border-color .4s ease">
            <div style="display:flex;justify-content:space-between;align-items:center;
                        margin-bottom:8px;font-size:12px;font-weight:700">
                ${label}
                <span style="color:var(--ink);font-size:13px;font-weight:700;
                             font-variant-numeric:tabular-nums">
                    ${pct}<span style="font-size:10px;font-weight:400;color:var(--ink-3);margin-left:1px">%</span>
                </span>
            </div>
            <div style="height:6px;overflow:hidden;display:flex;background:var(--line-soft);margin-bottom:9px">
                <div style="width:${sp}%;background:var(--status-success-text);transition:width .5s ease;
                            min-width:${successCount > 0 ? '3px' : '0'}"></div>
                <div style="width:${fp}%;background:var(--status-error-text);transition:width .5s ease;
                            min-width:${failureCount > 0 ? '3px' : '0'}"></div>
                ${pendingSegment}
            </div>
            <div style="display:flex;align-items:center;flex-wrap:wrap;row-gap:4px">
                <div style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 6px;
                            background:var(--status-success-bg);border:1px solid var(--status-success-border);margin-right:7px">
                    <span style="width:6px;height:6px;border-radius:50%;background:var(--status-success-text);flex-shrink:0"></span>
                    <span style="font-size:10px;font-weight:700;color:var(--status-success-text)">
                        ${successCount.toLocaleString('fr-FR')} réussie${successCount !== 1 ? 's' : ''}
                    </span>
                </div>
                <div style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 6px;
                            background:${failureCount > 0 ? 'var(--status-error-bg)' : 'var(--canvas)'};border:1px solid ${failureCount > 0 ? 'var(--status-error-border)' : 'var(--line)'};margin-right:7px">
                    <span style="width:6px;height:6px;border-radius:50%;background:${failureCount > 0 ? 'var(--status-error-text)' : 'var(--ink-4)'};flex-shrink:0"></span>
                    <span style="font-size:10px;font-weight:700;color:${failureCount > 0 ? 'var(--status-error-text)' : 'var(--ink-3)'}">
                        ${failureCount.toLocaleString('fr-FR')} échouée${failureCount !== 1 ? 's' : ''}
                    </span>
                </div>
                ${pending > 0 ? `
                <div style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 6px;
                            background:var(--status-processing-bg);border:1px solid var(--status-processing-border)">
                    <span style="width:6px;height:6px;border-radius:50%;background:var(--status-processing-text);flex-shrink:0;
                                 animation:g-pulse 1.2s ease-in-out infinite"></span>
                    <span style="font-size:10px;font-weight:700;color:var(--status-processing-text)">
                        ${pending.toLocaleString('fr-FR')} en attente
                    </span>
                </div>` : ''}
                <span style="margin-left:auto;font-size:10px;color:var(--ink-3);white-space:nowrap;
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