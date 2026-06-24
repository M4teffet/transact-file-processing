/**
 * ============================================================================
 * validated-script.js
 * Manages the "Work-in-Progress" and "Finished" batches for the Validator.
 * ============================================================================
 */

let validatedBatches = [];

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    // Check if we are on the correct page view
    if (document.getElementById('validatedPage') || document.getElementById('validatedBatchesContainer')) {
        refreshValidatedView();
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

    const TH = `padding:10px 16px;text-align:left;font-size:10px;font-weight:500;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em`;
    const TD = `padding:11px 16px;border-bottom:0.5px solid var(--line-soft,#f0f1f3)`;
    const ICON_BTN = `padding:5px;background:none;border:none;cursor:pointer;color:var(--ink-3);display:inline-flex;align-items:center;justify-content:center`;

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
                <tbody>
                    ${validatedBatches.map(b => {
        const filename = b.originalFilename || '—';
        const short = filename.length > 36 ? filename.slice(0, 34) + '…' : filename;
        const {date, time} = formatDateParts(b.uploadedAt);
        const records = b.totalRecords
            ? `<span style="font-size:10px;color:var(--ink-3)">${b.totalRecords.toLocaleString('fr-FR')} lignes</span>`
            : '';
        return `<tr style="border-bottom:0.5px solid var(--line-soft,#f0f1f3)">
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
    }).join('')}
                </tbody>
            </table>
        </div>`;

    createIcons(container);
};

// viewBatchSummary and downloadExecutionReport are defined in shared.js
// and exported to window there — no redeclaration needed here.

// Global Exposure
window.viewBatchDetails = viewBatchDetails;
window.refreshValidatedView = refreshValidatedView;