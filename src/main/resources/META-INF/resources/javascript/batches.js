/**
 * batches.js — INPUTTER batch page
 *
 * Original table design: ID BATCH | APPLICATION | FICHIER | DATE IMPORT | STATUT | ACTIONS
 * The only addition is an inline segmented progress bar injected below
 * any PROCESSING batch row, updated every 3 s via the /progress endpoint.
 */

const POLL_INTERVAL = 3000;

let uploadedBatches = [];
let batchIdToDelete = null;
const activePollers = new Map();

// ── Init ──────────────────────────────────────────────────────────────────────

function initBatchesPage() {
    loadUploadedBatches();

    // Re-check every 30 s when idle so INPUTTER sees the batch move to PROCESSING
    setInterval(() => {
        if (activePollers.size === 0) loadUploadedBatches();
    }, 30_000);

    if (typeof startStatsPolling === 'function') {
        startStatsPolling({
            UPLOADED: 'uploadedCount',
            VALIDATED: 'validatedCount',
            PROCESSING: 'validatedCount',
            PROCESSED: 'validatedCount',
            PROCESSED_WITH_ERROR: 'validatedCount',
            PROCESSED_FAILED: 'validatedCount'
        }, 15);
    }

    document.getElementById('logoutBtn')?.addEventListener('click', e => {
        e.preventDefault();
        if (typeof logoutUser === 'function') logoutUser();
    });

    window.addEventListener('beforeunload', stopAllPollers);
    lucide.createIcons();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBatchesPage);
} else {
    initBatchesPage();
}

// ── Data ──────────────────────────────────────────────────────────────────────

const loadUploadedBatches = async () => {
    try {
        const currentInputter = sessionStorage.getItem('username') || '';
        const statuses = ['VALIDATED', 'UPLOADED', 'PROCESSING', 'PROCESSED',
            'PROCESSED_WITH_ERROR', 'PROCESSED_FAILED'];
        const params = new URLSearchParams({uploadedById: currentInputter});
        statuses.forEach(s => params.append('status', s));

        const response = await secureFetch(`${API_BASE}/batches?${params}`);
        if (!response) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();
        const raw = result.items || result.content || result;
        const allowed = ['UPLOADED', 'VALIDATED', 'PROCESSING', 'PROCESSED',
            'PROCESSED_FAILED', 'PROCESSED_WITH_ERROR'];
        uploadedBatches = Array.isArray(raw) ? raw.filter(b => allowed.includes(b.status)) : [];

        stopAllPollers();
        renderUploadedBatches();
    } catch (e) {
        console.error('Fetch error:', e);
        showSnackbar(`Erreur chargement: ${e.message}`, 'error');
    }
};

// ── Table ─────────────────────────────────────────────────────────────────────

let batchSearchQuery = '';
let batchStatusFilter = 'all';

const _filterBatches = (list, q) => {
    const groupStatuses = statusesForFilterKey(batchStatusFilter);
    let out = groupStatuses ? list.filter(b => groupStatuses.includes(b.status)) : list;
    if (!q || !q.trim()) return out;
    const lq = q.toLowerCase().trim();
    return out.filter(b =>
        (b.originalFilename || '').toLowerCase().includes(lq) ||
        (b.batchId || '').toLowerCase().includes(lq) ||
        (b.application || '').toLowerCase().includes(lq) ||
        (b.status || '').toLowerCase().includes(lq)
    );
};

const _ensureBatchStatusChips = () => {
    renderStatusFilterChips('batchStatusChips', batchStatusFilter, (key) => {
        batchStatusFilter = key;
        renderUploadedBatches();
    });
};

const _ensureBatchSearch = () => {
    const anchor = document.getElementById('batchSearchAnchor');
    if (!anchor || anchor.dataset.ready) return;
    anchor.dataset.ready = '1';
    anchor.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
            <div style="position:relative">
                <i data-lucide="search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);
                   width:13px;height:13px;color:var(--ink-3,#80868b);pointer-events:none"></i>
                <input id="batchSearchInput" type="text"
                       placeholder="Rechercher…"
                       style="width:240px;padding:5px 10px 5px 28px;font-size:12px;
                              border:0.5px solid var(--line,#e0e0e0);
                              background:var(--color-background-primary,#fff);
                              color:var(--ink-2,#5f6368);outline:none;box-sizing:border-box"/>
            </div>
            <p style="font-size:10px;color:var(--ink-3,#9ca3af);margin:0">
                Ex. transactions.csv · PROCESSED · 6a37af…
            </p>
        </div>`;
    anchor.querySelector('input').addEventListener('input', e => {
        batchSearchQuery = e.target.value;
        _renderBatchTbody();
    });
    createIcons(anchor);
};

const _renderBatchTbody = () => {
    const tbody = document.getElementById('batchTbody');
    if (!tbody) return;
    const TD = `padding:11px 16px;border-bottom:0.5px solid var(--line-soft,#f0f1f3)`;
    const BTN = `padding:5px;background:none;border:none;cursor:pointer;color:var(--ink-3,#80868b);display:inline-flex;align-items:center;justify-content:center`;
    const filtered = _filterBatches(uploadedBatches, batchSearchQuery);
    if (!filtered.length) {
        tbody.innerHTML = emptyFilterRowHTML(batchSearchQuery, 4);
    } else {
        tbody.innerHTML = filtered.map(b => renderBatchRow(b, TD, BTN)).join('');
    }
    createIcons(tbody);
};
const renderUploadedBatches = () => {
    const container = document.getElementById('uploadedBatchesContainer');
    if (!container) return;

    if (!uploadedBatches.length) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-gray-500">
                <i data-lucide="inbox" class="w-12 h-12 mb-3 opacity-20"></i>
                <p class="text-sm">Aucun batch trouvé pour le moment.</p>
            </div>`;
        createIcons(container);
        return;
    }

    _ensureBatchSearch();
    _ensureBatchStatusChips();

    const TH = `padding:10px 16px;text-align:left;font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em`;
    const TD = `padding:11px 16px;border-bottom:0.5px solid var(--line-soft,#f0f1f3)`;
    const BTN = `padding:5px;background:none;border:none;cursor:pointer;color:var(--ink-3,#80868b);display:inline-flex;align-items:center;justify-content:center`;
    const filtered = _filterBatches(uploadedBatches, batchSearchQuery);

    container.innerHTML = `
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
                <thead>
                    <tr style="border-bottom:0.5px solid var(--line,#e0e0e0)">
                        <th style="${TH}">Lot</th>
                        <th style="${TH}">Date d'import</th>
                        <th style="${TH}">Statut</th>
                        <th style="${TH}"></th>
                    </tr>
                </thead>
                <tbody id="batchTbody">
                    ${filtered.length
        ? filtered.map(b => renderBatchRow(b, TD, BTN)).join('')
        : emptyFilterRowHTML(batchSearchQuery, 4)}
                </tbody>
            </table>
        </div>`;

    createIcons(container);

    uploadedBatches
        .filter(b => b.status === 'PROCESSING')
        .forEach(b => startProgressPoller(b.batchId, b));
};

const renderBatchRow = (b, TD, BTN) => {
    const filename = b.originalFilename || '—';
    const short = filename.length > 40 ? filename.slice(0, 38) + '…' : filename;
    const {date, time} = formatDateParts(b.uploadedAt);
    const records = b.totalRecords
        ? `<span style="font-size:10px;color:var(--ink-3,#80868b)">${b.totalRecords.toLocaleString('fr-FR')} lignes</span>`
        : '';

    return `<tr class="hover:bg-gray-50 transition-colors" data-batch-id="${b.batchId}">
        <td style="${TD}">
            <div style="font-size:12px;font-weight:700;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px" title="${filename}">${short}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
                ${appBadgeHTML(b.application)}
                <span style="font-size:10px;color:var(--ink-3,#80868b);font-family:monospace">${b.batchId}</span>
                ${records}
            </div>
        </td>
        <td style="${TD};white-space:nowrap">
            <div style="font-size:12px;color:var(--ink-2,#5f6368)">${date}</div>
            <div style="font-size:11px;color:var(--ink-3,#80868b)">${time}</div>
        </td>
        <td style="${TD}">${getStatusBadge(b.status)}</td>
        <td style="${TD};white-space:nowrap">
            <div style="display:flex;align-items:center;gap:2px">
                <button onclick="viewBatchDetails('${b.batchId}')" title="Voir les données"
                        style="${BTN}" onmouseover="this.style.color='var(--orange)'" onmouseout="this.style.color='var(--ink-3,#80868b)'">
                    <i data-lucide="eye" style="width:15px;height:15px"></i>
                </button>
                ${b.status !== 'UPLOADED' ? `
                <button onclick="viewBatchSummary('${b.batchId}')" title="Résumé d'exécution"
                        style="${BTN}" onmouseover="this.style.color='#0f6e56'" onmouseout="this.style.color='var(--ink-3,#80868b)'">
                    <i data-lucide="bar-chart-2" style="width:15px;height:15px"></i>
                </button>` : ''}
                ${b.status === 'UPLOADED' ? `
                <button onclick="openDeleteModal('${b.batchId}')" title="Supprimer"
                        style="${BTN}" onmouseover="this.style.color='#c5221f'" onmouseout="this.style.color='var(--ink-3,#80868b)'">
                    <i data-lucide="trash-2" style="width:15px;height:15px"></i>
                </button>` : ''}
            </div>
        </td>
    </tr>`;
};

// ── Inline progress bar ───────────────────────────────────────────────────────

function startProgressPoller(batchId, batchMeta) {
    if (activePollers.has(batchId)) return;

    injectProgressRow(batchId, {
        pct: 0, done: 0, total: batchMeta?.totalRecords || 0,
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
                loadUploadedBatches();
                return;
            }
        } catch (e) {
            console.warn(`[progress] ${batchId}:`, e.message);
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



// ── Delete modal ──────────────────────────────────────────────────────────────

const openDeleteModal = (id) => {
    batchIdToDelete = id;
    if (typeof openModal === 'function') openModal('deleteConfirmationModal');
};

const cancelDelete = () => {
    batchIdToDelete = null;
    if (typeof closeModal === 'function') closeModal('deleteConfirmationModal');
};

const confirmDelete = async () => {
    if (!batchIdToDelete) return;
    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchIdToDelete}`, {method: 'DELETE'});
        if (!res || !res.ok) throw new Error('Erreur serveur');
        showSnackbar('Lot supprimé avec succès', 'success');
        cancelDelete();
        loadUploadedBatches();
    } catch (e) {
        showSnackbar(`Erreur suppression: ${e.message}`, 'error');
    }
};

// ── Exports ───────────────────────────────────────────────────────────────────

window.openDeleteModal = openDeleteModal;
window.cancelDelete = cancelDelete;
window.confirmDelete = confirmDelete;
window.closeBatchDetails = () => {
    if (typeof closeModal === 'function') closeModal('batchDetailsModal');
};
