/**
 * ============================================================================
 * validated-script.js
 * Manages the "Work-in-Progress" and "Finished" batches for the Validator.
 * ============================================================================
 */

let validatedBatches = [];

// ── Progress polling for PROCESSING batches ───────────────────────────────────
// Mirrors the INPUTTER progress bar: same bar, same 3-second interval.
// Completion calls loadValidatedBatches() to refresh the full list.

const POLL_INTERVAL = 3000;
const activePollers = new Map();

function startProgressPoller(batchId, batchMeta) {
    if (activePollers.has(batchId)) return;

    injectProgressRow(batchId, {
        total: batchMeta?.totalRecords || 0,
        successCount: 0, failureCount: 0
    });

    const state = {timer: null, inflight: false};
    activePollers.set(batchId, state);

    const tick = async () => {
        if (!activePollers.has(batchId)) return;
        if (state.inflight) {
            state.timer = setTimeout(tick, POLL_INTERVAL);
            return;
        }
        state.inflight = true;
        try {
            const res = await secureFetch(`${API_BASE}/batches/${batchId}/progress`);
            if (!res || !res.ok) throw new Error('progress fetch failed');
            const data = await res.json();

            updateProgressRow(batchId, data);

            if (data.status !== 'PROCESSING') {
                stopPoller(batchId);
                showSnackbar(
                    data.status === 'PROCESSED'
                        ? `✓ Lot traité avec succès`
                        : `Lot terminé — ${data.status.replace(/_/g, ' ')}`,
                    data.status === 'PROCESSED' ? 'success' : 'info'
                );
                loadValidatedBatches(); // refresh the full list on completion
                return;
            }
        } catch (e) {
            console.warn(`[progress/validated] ${batchId}:`, e.message);
        } finally {
            state.inflight = false;
        }
        if (activePollers.has(batchId)) state.timer = setTimeout(tick, POLL_INTERVAL);
    };
    state.timer = setTimeout(tick, 500);
}

function stopPoller(batchId) {
    const s = activePollers.get(batchId);
    if (s) {
        clearTimeout(s.timer);
        activePollers.delete(batchId);
    }
}

function stopAllPollers() {
    for (const [id] of activePollers) stopPoller(id);
}

window.addEventListener('beforeunload', stopAllPollers);

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('validatedPage') || document.getElementById('validatedBatchesContainer')) {
        refreshValidatedView();

        // Re-check every 30 s when no poller is active — catches completions
        // the AUTHORISER would otherwise miss without a manual reload
        setInterval(() => {
            if (activePollers.size === 0) loadValidatedBatches();
        }, 30_000);
    }
    document.getElementById('logoutBtn')?.addEventListener('click', logoutUser);
});

/**
 * Global refresh for stats and the table
 */
const refreshValidatedView = () => {
    // Aggregate all processing/finished statuses into a single "Processed" KPI
    loadStats({
        VALIDATED: 'validatedCount',
        PROCESSING: 'processedCount',
        PROCESSED: 'processedCount',
        PROCESSED_WITH_ERROR: 'processedCount',
        PROCESSED_FAILED: 'processedCount'
    });
    loadValidatedBatches();
};

// -----------------------------
// DATA LOADING
// -----------------------------
const loadValidatedBatches = async () => {
    stopAllPollers();
    try {
        const statuses = ['VALIDATED', 'PROCESSING', 'PROCESSED', 'PROCESSED_WITH_ERROR', 'PROCESSED_FAILED'];
        const queryParams = statuses.map(s => `status=${s}`).join('&');

        const res = await secureFetch(`${API_BASE}/batches?${queryParams}`);
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const result = await res.json();
        // Normalise: handle raw array, paginated wrapper {items:[...]}, or {content:[...]}
        if (Array.isArray(result)) {
            validatedBatches = result;
        } else if (Array.isArray(result.items)) {
            validatedBatches = result.items;
        } else if (Array.isArray(result.content)) {
            validatedBatches = result.content;
        } else {
            validatedBatches = [];
            console.warn('[validated] Unexpected response shape:', result);
        }

        renderValidatedBatches();
    } catch (e) {
        console.error('[validated] Load error:', e);
        showSnackbar(`Erreur de chargement: ${e.message}`, 'error');
    }
};

// -----------------------------
// RENDER TABLE
// -----------------------------
let validatedSearchQuery = '';

const _filterValidated = (list, q) => {
    if (!q || !q.trim()) return list;
    const lq = q.toLowerCase().trim();
    return list.filter(b =>
        (b.originalFilename || '').toLowerCase().includes(lq) ||
        (b.batchId || '').toLowerCase().includes(lq) ||
        (b.application || '').toLowerCase().includes(lq) ||
        (b.status || '').toLowerCase().includes(lq) ||
        (b.uploadedBy || '').toLowerCase().includes(lq)
    );
};

const _ensureValidatedSearch = () => {
    const anchor = document.getElementById('validatedSearchAnchor');
    if (!anchor || anchor.dataset.ready) return;
    anchor.dataset.ready = '1';
    anchor.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
            <div style="position:relative">
                <i data-lucide="search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);
                   width:13px;height:13px;color:var(--ink-3);pointer-events:none"></i>
                <input id="validatedSearchInput" type="text"
                       placeholder="Rechercher…"
                       style="width:240px;padding:5px 10px 5px 28px;font-size:12px;
                              border:0.5px solid var(--line,#e0e0e0);
                              background:var(--color-background-primary,#fff);
                              color:var(--ink-2);outline:none;box-sizing:border-box"/>
            </div>
            <p style="font-size:10px;color:var(--ink-3);margin:0">
                Ex. virements.csv · PROCESSED · MARTIAL.EHUI
            </p>
        </div>`;
    anchor.querySelector('input').addEventListener('input', e => {
        validatedSearchQuery = e.target.value;
        _renderValidatedTbody();
    });
    createIcons(anchor);
};

const _renderValidatedTbody = () => {
    const tbody = document.getElementById('validatedTbody');
    if (!tbody) return;
    const TD = `padding:11px 16px;border-bottom:0.5px solid var(--line-soft,#f0f1f3)`;
    const ICON_BTN = `padding:5px;background:none;border:none;cursor:pointer;color:var(--ink-3);display:inline-flex;align-items:center;justify-content:center`;
    const filtered = _filterValidated(validatedBatches, validatedSearchQuery);
    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:2rem;text-align:center;font-size:12px;color:var(--ink-3)">Aucun résultat pour « ${validatedSearchQuery} »</td></tr>`;
        return;
    }
    tbody.innerHTML = filtered.map(b => _validatedRow(b, TD, ICON_BTN)).join('');
    createIcons(tbody);
};

const _validatedRow = (b, TD, ICON_BTN) => {
    const filename = b.originalFilename || '—';
    const short = filename.length > 36 ? filename.slice(0, 34) + '…' : filename;
    const {date, time} = formatDateParts(b.uploadedAt);
    const records = b.totalRecords
        ? `<span style="font-size:10px;color:var(--ink-3)">${b.totalRecords.toLocaleString('fr-FR')} lignes</span>`
        : '';
    return `<tr style="border-bottom:0.5px solid var(--line-soft,#f0f1f3)" data-batch-id="${b.batchId}">
        <td style="${TD};max-width:300px">
            <div style="font-size:12px;font-weight:500;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${filename}">${short}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
                ${appBadgeHTML(b.application)}
                <span style="font-size:10px;color:var(--ink-3);font-family:monospace">${b.batchId}</span>
                ${records}
            </div>
            ${b.uploadedBy ? `<div style="margin-top:4px">
                <span style="font-size:10px;font-weight:500;background:#e8f0fe;color:#1967d2;
                             padding:2px 7px;border-radius:99px;display:inline-flex;align-items:center;gap:3px">
                    <i data-lucide="user" style="width:10px;height:10px"></i>${b.uploadedBy}
                </span>
            </div>` : ''}
        </td>
        <td style="${TD};white-space:nowrap">
            <div style="font-size:12px;color:var(--ink-2)">${date}</div>
            <div style="font-size:11px;color:var(--ink-3)">${time}</div>
        </td>
        <td style="${TD}">${getStatusBadge(b.status)}</td>
        <td style="${TD};white-space:nowrap">
            <button onclick="viewBatchDetails('${b.batchId}')" title="Voir les données"
                    style="${ICON_BTN}" onmouseover="this.style.color='#1967d2'" onmouseout="this.style.color='var(--ink-3)'">
                <i data-lucide="eye" style="width:15px;height:15px"></i>
            </button>
            <button onclick="viewBatchSummary('${b.batchId}')" title="Résumé d'exécution"
                    style="${ICON_BTN}" onmouseover="this.style.color='#0f6e56'" onmouseout="this.style.color='var(--ink-3)'">
                <i data-lucide="bar-chart-2" style="width:15px;height:15px"></i>
            </button>
        </td>
    </tr>`;
};

const renderValidatedBatches = () => {
    const container = document.getElementById('validatedBatchesContainer');
    if (!container) return;

    if (!validatedBatches.length) {
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                        padding:3rem 1rem;color:var(--ink-3);text-align:center">
                <i data-lucide="layers" style="width:40px;height:40px;opacity:.2;margin-bottom:.75rem"></i>
                <p style="font-size:13px">Aucun lot validé ou en cours de traitement</p>
            </div>`;
        createIcons(container);
        return;
    }

    _ensureValidatedSearch();

    const TH = `padding:10px 16px;text-align:left;font-size:10px;font-weight:500;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em`;
    const TD = `padding:11px 16px;border-bottom:0.5px solid var(--line-soft,#f0f1f3)`;
    const ICON_BTN = `padding:5px;background:none;border:none;cursor:pointer;color:var(--ink-3);display:inline-flex;align-items:center;justify-content:center`;
    const filtered = _filterValidated(validatedBatches, validatedSearchQuery);

    container.innerHTML = `
        <div style="overflow-x:auto">
            <table style="min-width:100%;border-collapse:collapse">
                <thead>
                    <tr style="border-bottom:0.5px solid var(--line)">
                        <th style="${TH}">Lot</th>
                        <th style="${TH}">Date</th>
                        <th style="${TH}">Statut</th>
                        <th style="${TH}"></th>
                    </tr>
                </thead>
                <tbody id="validatedTbody">
                    ${filtered.length
        ? filtered.map(b => _validatedRow(b, TD, ICON_BTN)).join('')
        : `<tr><td colspan="4" style="padding:2rem;text-align:center;font-size:12px;color:var(--ink-3)">Aucun résultat pour « ${validatedSearchQuery} »</td></tr>`}
                </tbody>
            </table>
        </div>`;

    createIcons(container);

    // Start live progress bar for any batch currently being processed
    validatedBatches
        .filter(b => b.status === 'PROCESSING')
        .forEach(b => startProgressPoller(b.batchId, b));
};

// viewBatchSummary and downloadExecutionReport are defined in shared.js
// and exported to window there — no redeclaration needed here.

// Global Exposure
window.viewBatchDetails = viewBatchDetails;
window.refreshValidatedView = refreshValidatedView;