/**
 * ============================================================================
 * validate-script.js
 * Gère la validation manuelle des batches par l'utilisateur "Validator".
 * ============================================================================
 */

let uploadedBatches = [];
let batchIdToDelete = null;

/**
 * CONFIGURATION DES STATS POUR CETTE PAGE
 */
const validationStatsMapping = {
    VALIDATED: 'validatedCount',
    PROCESSING: 'processedCount',
    PROCESSED: 'processedCount',
    PROCESSED_WITH_ERROR: 'processedCount',
    PROCESSED_FAILED: 'processedCount'
};

document.addEventListener('DOMContentLoaded', () => {
    // Vérifie si nous sommes sur la page de validation (identifiée par ID ou élément spécifique)
    if (document.getElementById('validatedPage') || document.getElementById('uploadedBatchesContainer')) {
        refreshDashboard();
    }

    document.getElementById('logoutBtn')?.addEventListener('click', logoutUser);
});

/**
 * Action globale de rafraîchissement (Stats + Liste)
 */
const refreshDashboard = () => {
    loadStats(validationStatsMapping);
    loadUploadedBatches();
};

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

    const TH = `padding:10px 16px;text-align:left;font-size:10px;font-weight:500;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em`;
    const TD = `padding:11px 16px;border-bottom:0.5px solid var(--line-soft,#f0f1f3)`;
    const BTN = `padding:5px;background:none;border:none;cursor:pointer;color:var(--ink-3);display:inline-flex;align-items:center`;

    container.innerHTML = `
        <div style="overflow-x:auto">
            <table style="min-width:100%;border-collapse:collapse">
                <thead>
                    <tr style="border-bottom:0.5px solid var(--line)">
                        <th style="${TH}">Lot</th>
                        <th style="${TH}">Date d'import</th>
                        <th style="${TH}">Statut</th>
                        <th style="${TH}"></th>
                    </tr>
                </thead>
                <tbody>
                    ${uploadedBatches.map(b => {
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
                                        style="${BTN}" onmouseover="this.style.color='#1967d2'" onmouseout="this.style.color='var(--ink-3)'">
                                    <i data-lucide="eye" style="width:15px;height:15px"></i>
                                </button>
                                <button onclick="openDeleteModal('${b.batchId}')" title="Supprimer"
                                        style="${BTN}" onmouseover="this.style.color='#c5221f'" onmouseout="this.style.color='var(--ink-3)'">
                                    <i data-lucide="trash-2" style="width:15px;height:15px"></i>
                                </button>
                                <button onclick="validateBatchNow('${b.batchId}')"
                                        style="margin-left:6px;padding:4px 11px;font-size:11px;font-weight:500;
                                               color:#fff;background:#16a34a;border:none;cursor:pointer;
                                               display:inline-flex;align-items:center;gap:5px"
                                        onmouseover="this.style.background='#15803d'" onmouseout="this.style.background='#16a34a'">
                                    <i data-lucide="check-circle" style="width:12px;height:12px"></i>Valider
                                </button>
                            </td>
                        </tr>`;
    }).join('')}
                </tbody>
            </table>
        </div>`;
    createIcons(container);
};

/**
 * ACTION : VALIDATION
 */
let _pendingValidationId = null;

const validateBatchNow = (id) => {
    const batch = uploadedBatches.find(b => b.batchId === id);
    if (!batch) return;

    _pendingValidationId = id;

    // Populate modal content
    document.getElementById('confirmBatchId').textContent    = id;
    document.getElementById('confirmFilename').textContent   = batch.originalFilename || 'N/A';
    document.getElementById('confirmApp').textContent        = batch.application || 'N/A';
    document.getElementById('confirmRecords').textContent = (batch.totalRecords.toLocaleString('fr-FR') || '—') + ' enregistrement(s)';
    document.getElementById('confirmUploadedAt').textContent = batch.uploadedAt
        ? new Date(batch.uploadedAt).toLocaleString('fr-FR') : '—';

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