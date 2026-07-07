/**
 * ============================================================================
 * validate-script.js
 * Gère la validation manuelle des batches par l'utilisateur "Validator".
 * ============================================================================
 */

let uploadedBatches = [];
let batchIdToDelete = null;
let validateSearchQuery = '';

const _filterUploaded = (list, q) => {
    if (!q || !q.trim()) return list;
    const lq = q.toLowerCase().trim();
    return list.filter(b =>
        (b.originalFilename || '').toLowerCase().includes(lq) ||
        (b.batchId || '').toLowerCase().includes(lq) ||
        (b.application || '').toLowerCase().includes(lq) ||
        (b.uploadedBy || '').toLowerCase().includes(lq)
    );
};

const _ensureValidateSearch = () => {
    const anchor = document.getElementById('validateSearchAnchor');
    if (!anchor || anchor.dataset.ready) return;
    anchor.dataset.ready = '1';
    anchor.innerHTML = `
        <div style="position:relative">
            <i data-lucide="search" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);
               width:13px;height:13px;color:var(--ink-3);pointer-events:none"></i>
            <input id="validateSearchInput" type="text"
                   placeholder="Rechercher…"
                   style="width:240px;padding:5px 10px 5px 28px;font-size:12px;
                          border:1px solid var(--line);background:#fff;
                          color:var(--ink-2);outline:none;box-sizing:border-box"/>
        </div>`;
    anchor.querySelector('input').addEventListener('input', e => {
        validateSearchQuery = e.target.value;
        renderUploadedBatches();
    });
    createIcons(anchor);
};

/**
 * Action globale de rafraîchissement (Dernier lot validé + Liste)
 */
const refreshDashboard = () => {
    loadLastValidatedBatch();
    loadUploadedBatches();
};

document.addEventListener('DOMContentLoaded', () => {
    // Vérifie si nous sommes sur la page de validation (identifiée par ID ou élément spécifique)
    if (document.getElementById('validatePage') || document.getElementById('uploadedBatchesContainer')) {
        refreshDashboard();
    }

    document.getElementById('logoutBtn')?.addEventListener('click', logoutUser);
});

// "Dernier lot validé" strip — mirrors the Upload page's "Dernier batch":
// answers "did the last batch I validated actually go through T24 OK?"
// without the authoriser needing to click over to the Validated page.
// The /batches endpoint has no server-side validatedById filter, so we
// pull the post-validation statuses and filter client-side.
function loadLastValidatedBatch() {
    const filenameEl = document.getElementById('lastValidatedFilename');
    const timeEl = document.getElementById('lastValidatedTime');
    const badgeEl = document.getElementById('lastValidatedBadge');
    if (!filenameEl) return;

    (async () => {
        try {
            const username = sessionStorage.getItem('username') || '';
            const statuses = ['VALIDATED', 'PROCESSING', 'PROCESSED', 'PROCESSED_WITH_ERROR', 'PROCESSED_FAILED'];
            const params = new URLSearchParams();
            statuses.forEach(s => params.append('status', s));

            const res = await secureFetch(`${API_BASE}/batches?${params}`);
            if (!res || !res.ok) throw new Error('fetch failed');

            const result = await res.json();
            const raw = result.items || result.content || result;
            const list = (Array.isArray(raw) ? raw : []).filter(b => b.validatedBy === username);

            if (!list.length) {
                filenameEl.textContent = "Aucun lot validé pour le moment";
                filenameEl.style.cssText = "font-size:.8rem;font-weight:400;color:var(--ink-3)";
                return;
            }

            list.sort((a, b) => new Date(b.validatedAt || 0) - new Date(a.validatedAt || 0));
            const last = list[0];

            filenameEl.textContent = last.originalFilename || last.batchId;
            filenameEl.style.cssText = "font-size:.8rem;font-weight:700;color:var(--ink)";
            if (timeEl) timeEl.textContent = last.validatedAt ? new Date(last.validatedAt).toLocaleString('fr-FR') : '';
            if (badgeEl && typeof getStatusBadge === 'function') badgeEl.innerHTML = getStatusBadge(last.status);

            const accentByStatus = {
                PROCESSED: 'var(--status-success-text)',
                VALIDATED: 'var(--status-validated-text)',
                PROCESSING: 'var(--status-processing-text)',
                PROCESSED_WITH_ERROR: 'var(--status-warning-text)',
                PROCESSED_FAILED: 'var(--status-error-text)',
            };
            const strip = document.getElementById('lastValidatedStrip');
            if (strip) strip.style.borderLeftColor = accentByStatus[last.status] || 'var(--ink-4)';

            if (window.lucide) window.lucide.createIcons();
        } catch (e) {
            filenameEl.textContent = "Impossible de charger le dernier lot validé";
            filenameEl.style.cssText = "font-size:.8rem;font-weight:400;color:var(--ink-3)";
        }
    })();
}

/**
 * CHARGEMENT DES DONNÉES
 */
const loadUploadedBatches = async () => {
    const container = document.getElementById('uploadedBatchesContainer');
    try {
        const response = await secureFetch(`${API_BASE}/batches?status=UPLOADED`);
        if (!response) return;
        if (!response.ok) throw new Error("Erreur lors de la récupération des batches");

        const result = await response.json();
        // Support pour le format Spring Data (content) ou Array simple
        uploadedBatches = result.items || result.content || result;

        renderUploadedBatches();
    } catch (e) {
        showSnackbar(`Erreur: ${e.message}`, "error");
        if (container) container.innerHTML = `<p class="text-center text-red-500 py-6">Erreur de chargement.</p>`;
    }
};

/**
 * RENDU DE LA TABLE
 */
const renderUploadedBatches = () => {
    const container = document.getElementById('uploadedBatchesContainer');
    if (!container) return;

    if (!uploadedBatches.length) {
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                        padding:3rem 1rem;color:var(--ink-3);text-align:center">
                <i data-lucide="file-check" style="width:40px;height:40px;opacity:.2;margin-bottom:.75rem"></i>
                <p style="font-size:13px">Aucun lot en attente de validation</p>
            </div>`;
        createIcons(container);
        return;
    }

    _ensureValidateSearch();

    const filtered = _filterUploaded(uploadedBatches, validateSearchQuery);
    const TH = `padding:10px 16px;text-align:left;font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em`;
    const TD = `padding:11px 16px;border-bottom:1px solid var(--line-soft)`;
    const BTN = `padding:5px;background:none;border:none;cursor:pointer;color:var(--ink-3);display:inline-flex;align-items:center`;

    container.innerHTML = `
        <div style="overflow-x:auto">
            <table style="min-width:100%;border-collapse:collapse">
                <thead>
                    <tr style="border-bottom:1px solid var(--line)">
                        <th style="${TH}">Lot</th>
                        <th style="${TH}">Date d'import</th>
                        <th style="${TH}">Statut</th>
                        <th style="${TH};width:1%;white-space:nowrap"></th>
                    </tr>
                </thead>
                <tbody>
                    ${filtered.length ? filtered.map(b => {
        const filename = b.originalFilename || '—';
        const short = filename.length > 36 ? filename.slice(0, 34) + '…' : filename;
        const {date, time} = formatDateParts(b.uploadedAt);
        const records = b.totalRecords
            ? `<span style="font-size:10px;color:var(--ink-3)">${b.totalRecords.toLocaleString('fr-FR')} lignes</span>`
            : '';
        return `<tr style="border-bottom:1px solid var(--line-soft)">
                            <td style="${TD};max-width:300px">
                                <div style="font-size:12px;font-weight:700;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${filename}">${short}</div>
                                <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap">
                                    ${appBadgeHTML(b.application)}
                                    <span class="mono" style="font-size:10px;color:var(--ink-3)">${b.batchId}</span>
                                    ${records}
                                </div>
                                ${b.uploadedBy ? `<div style="margin-top:4px">
                                    <span style="font-size:10px;font-weight:700;background:var(--canvas);color:var(--ink-2);border:1px solid var(--line);
                                                 padding:2px 7px;display:inline-flex;align-items:center;gap:3px">
                                        <i data-lucide="user" style="width:10px;height:10px"></i>${b.uploadedBy}
                                    </span>
                                </div>` : ''}
                            </td>
                            <td style="${TD};white-space:nowrap">
                                <div style="font-size:12px;color:var(--ink-2)">${date}</div>
                                <div style="font-size:11px;color:var(--ink-3)">${time}</div>
                            </td>
                            <td style="${TD}">${getStatusBadge(b.status)}</td>
                            <td style="${TD};white-space:nowrap;width:1%">
                                <button onclick="viewBatchDetails('${b.batchId}')" title="Voir les données"
                                        style="${BTN}" onmouseover="this.style.color='var(--orange)'" onmouseout="this.style.color='var(--ink-3)'">
                                    <i data-lucide="eye" style="width:15px;height:15px"></i>
                                </button>
                                <button onclick="openDeleteModal('${b.batchId}')" title="Supprimer"
                                        style="${BTN}" onmouseover="this.style.color='var(--status-error-text)'" onmouseout="this.style.color='var(--ink-3)'">
                                    <i data-lucide="trash-2" style="width:15px;height:15px"></i>
                                </button>
                                <button onclick="validateBatchNow('${b.batchId}')"
                                        style="margin-left:6px;padding:5px 12px;font-size:11px;font-weight:700;
                                               color:#fff;background:var(--orange);border:1.5px solid var(--orange);cursor:pointer;
                                               display:inline-flex;align-items:center;gap:5px"
                                        onmouseover="this.style.background='var(--orange-deep)';this.style.borderColor='var(--orange-deep)'" onmouseout="this.style.background='var(--orange)';this.style.borderColor='var(--orange)'">
                                    <i data-lucide="check-circle" style="width:12px;height:12px"></i>Valider
                                </button>
                            </td>
                        </tr>`;
    }).join('') : emptyFilterRowHTML(validateSearchQuery, 4)}
                </tbody>
            </table>
        </div>`;
    createIcons(container);
};

/**
 * ACTION : VALIDATION
 * Four-eyes control: the AUTHORISER reviews the batch (filename, application,
 * uploader, record count) in the confirm modal, then approves. The approval
 * itself is the second pair of eyes — no extra typed step.
 */
let _pendingValidationId = null;

const validateBatchNow = (id) => {
    const batch = uploadedBatches.find(b => b.batchId === id);
    if (!batch) return;

    _pendingValidationId = id;

    // Populate the review modal — the authoriser sees exactly what they are
    // approving (the second pair of eyes) before it is sent to T24.
    document.getElementById('confirmFilename').textContent   = batch.originalFilename || 'N/A';
    document.getElementById('confirmApp').textContent        = batch.application || 'N/A';
    document.getElementById('confirmUploadedBy').textContent = batch.uploadedBy || 'N/A';
    document.getElementById('confirmRecords').textContent = batch.totalRecords > 0
        ? batch.totalRecords.toLocaleString('fr-FR')
        : '—';

    if (typeof openModal === 'function') openModal('validateConfirmModal');
};

const cancelValidation = () => {
    _pendingValidationId = null;
    if (typeof closeModal === 'function') closeModal('validateConfirmModal');
};

const confirmValidation = async () => {
    const id = _pendingValidationId;
    if (!id) return;

    const confirmBtn = document.getElementById('confirmValidateBtn');
    const confirmText = document.getElementById('confirmValidateBtnText');
    if (confirmBtn) confirmBtn.disabled = true;
    if (confirmText) confirmText.textContent = 'En cours…';

    try {
        const response = await secureFetch(`${API_BASE}/batches/${id}`, {
            method: 'PUT',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "VALIDATED" })
        });

        cancelValidation();

        if (!response) return;
        if (response.ok) {
            showSnackbar('Lot validé — traitement en cours', 'success');
            refreshDashboard();
        } else {
            const errorData = await response.json();
            showSnackbar(`Erreur : ${errorData.message || 'Validation échouée'}`, 'error');
        }
    } catch (e) {
        cancelValidation();
        showSnackbar('Erreur technique lors de la validation', 'error');
    } finally {
        if (confirmBtn) confirmBtn.disabled = false;
        if (confirmText) confirmText.textContent = 'Valider';
    }
};

/**
 * GESTION DE LA SUPPRESSION
 */
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
        const response = await secureFetch(`${API_BASE}/batches/${batchIdToDelete}`, { method: 'DELETE' });
        if (!response || !response.ok) throw new Error("Échec de la suppression");

        showSnackbar('Batch supprimé avec succès', 'success');
        cancelDelete();
        refreshDashboard();
    } catch (e) {
        showSnackbar(`Erreur: ${e.message}`, 'error');
    }
};

// EXPOSITION DES FONCTIONS AU WINDOW (pour les onclick HTML)
window.validateBatchNow = validateBatchNow;
window.cancelValidation = cancelValidation;
window.confirmValidation = confirmValidation;
window.openDeleteModal = openDeleteModal;
window.cancelDelete = cancelDelete;
window.confirmDelete = confirmDelete;
window.closeBatchDetails = () => {
    if (typeof closeModal === 'function') closeModal('batchDetailsModal');
};