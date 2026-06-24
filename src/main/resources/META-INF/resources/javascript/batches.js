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

    const TH = `padding:10px 16px;text-align:left;font-size:10px;font-weight:500;color:var(--ink-3,#80868b);text-transform:uppercase;letter-spacing:.07em`;
    const TD = `padding:11px 16px;border-bottom:0.5px solid var(--line-soft,#f0f1f3)`;
    const BTN = `padding:5px;background:none;border:none;cursor:pointer;color:var(--ink-3,#80868b);display:inline-flex;align-items:center;justify-content:center`;

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
                <tbody data-batch-tbody>
                    ${uploadedBatches.map(b => renderBatchRow(b, TD, BTN)).join('')}
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
            <div style="font-size:12px;font-weight:500;color:var(--ink-1,#202124);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px" title="${filename}">${short}</div>
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
                        style="${BTN}" onmouseover="this.style.color='#1967d2'" onmouseout="this.style.color='var(--ink-3,#80868b)'">
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

function progressRowId(batchId) {
    return `progress-row-${batchId}`;
}

function injectProgressRow(batchId, data) {
    const batchRow = document.querySelector(`tr[data-batch-id="${batchId}"]`);
    if (!batchRow) return;
    removeProgressRow(batchId);
    const tr = document.createElement('tr');
    tr.id = progressRowId(batchId);
    tr.innerHTML = buildProgressRowHTML(data);
    batchRow.insertAdjacentElement('afterend', tr);
}

function updateProgressRow(batchId, data) {
    const row = document.getElementById(progressRowId(batchId));
    if (!row) {
        injectProgressRow(batchId, data);
        return;
    }
    row.innerHTML = buildProgressRowHTML(data);
}

function removeProgressRow(batchId) {
    document.getElementById(progressRowId(batchId))?.remove();
}

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

            <div style="display:flex;align-items:center;gap:0;flex-wrap:wrap;row-gap:4px">
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

// Inject keyframes once
if (!document.getElementById('progress-pulse-style')) {
    const s = document.createElement('style');
    s.id = 'progress-pulse-style';
    s.textContent = `
        @keyframes g-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        @keyframes g-pulse{0%,100%{opacity:1}50%{opacity:.35}}
    `;
    document.head.appendChild(s);
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
