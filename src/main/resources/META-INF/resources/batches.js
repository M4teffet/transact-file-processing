/**
 * ============================================================================
 * batches.js - Orange Bank
 * Manages the display, filtering, and deletion of uploaded batches.
 * ============================================================================
 */

const uploadedBatchesContainer = document.getElementById("uploadedBatchesContainer");

// State
let uploadedBatches = [];
let batchIdToDelete = null;

/**
 * INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Fetch the data for the table
    loadUploadedBatches();

    // 2. Fetch and aggregate the KPI counts (Stats)
    // Note: We map multiple backend statuses to 'validatedCount' to match your UI requirements.
    if (typeof loadStats === 'function') {
        loadStats({
            UPLOADED: 'uploadedCount',
            VALIDATED: 'validatedCount',
            PROCESSING: 'validatedCount',
            PROCESSED: 'validatedCount',
            PROCESSED_WITH_ERROR: 'validatedCount',
            PROCESSED_FAILED: 'validatedCount'
        });
    }

    // 3. Event Listeners
    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof logoutUser === 'function') logoutUser();
    });

    // Initialize icons for static elements
    lucide.createIcons();
});

/**
 * DATA FETCHING
 */
const loadUploadedBatches = async () => {
    try {
        const response = await secureFetch(`${API_BASE}/batches?size=999`);
        if (!response) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();

        // Handle Spring-style paginated response (content) or flat array
        const rawData = result.content || result;

        // Filter for specific statuses relevant to the "Uploaded" view
        const allowedStatuses = [
            'UPLOADED', 'VALIDATED', 'PROCESSING',
            'PROCESSED', 'PROCESSED_FAILED', 'PROCESSED_WITH_ERROR'
        ];

        uploadedBatches = Array.isArray(rawData)
            ? rawData.filter(b => allowedStatuses.includes(b.status))
            : [];

        renderUploadedBatches();
    } catch (e) {
        console.error("Fetch error:", e);
        showSnackbar(`Erreur chargement: ${e.message}`, "error");
    }
};

/**
 * RENDERING
 */
const renderUploadedBatches = () => {
    const container = document.getElementById('uploadedBatchesContainer');
    if (!container) return;

    if (!uploadedBatches.length) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-gray-500">
                <i data-lucide="inbox" class="w-12 h-12 mb-3 opacity-20"></i>
                <p>Aucun batch trouvé pour le moment.</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    const html = `
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 bg-white">
                <thead class="bg-gray-50/50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ID Batch</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Application</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date Import</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Statut</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${uploadedBatches.map(b => `
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4 text-sm font-medium text-gray-800">${b.batchId}</td>
                        <td class="px-6 py-4 text-sm text-gray-600 font-mono">${b.application || 'N/A'}</td>
                        <td class="px-6 py-4 text-sm text-gray-500">
                            ${b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : 'Date inconnue'}
                        </td>
                        <td class="px-6 py-4 text-sm">
                            ${getStatusBadge(b.status)}
                        </td>
                        <td class="px-6 py-4 flex justify-start gap-3">
                            <button onclick="viewBatchDetails('${b.batchId}')" title="Voir détails" class="p-2 hover:bg-blue-50 rounded-full transition">
                                <i data-lucide="eye" class="w-5 h-5 text-blue-500"></i>
                            </button>
                            ${b.status != 'UPLOADED' ? `
                            <button onclick="viewBatchSummary('${b.batchId}')" class="p-1.5 hover:bg-teal-50 rounded-full transition" title="Résumé d'exécution">
                                <i data-lucide="file-text" class="w-5 h-5 text-teal-600"></i>
                            </button>
                            ` : ''}
                            ${b.status === 'UPLOADED' ? `
                                <button onclick="openDeleteModal('${b.batchId}')" title="Supprimer" class="p-2 hover:bg-red-50 rounded-full transition">
                                    <i data-lucide="trash-2" class="w-5 h-5 text-red-500"></i>
                                </button>
                            ` : ''}
                        </td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>`;

    container.innerHTML = html;
    lucide.createIcons();
};

/**
 * EXECUTION SUMMARY (MODAL)
 */
const viewBatchSummary = async (batchId) => {
    const modalContent = document.getElementById('batchSummaryContent');
    const titleEl = document.getElementById('batchSummaryTitle');

    if (!modalContent || !titleEl) {
        showSnackbar("Erreur d'affichage du modal", "error");
        return;
    }

    // 1. Afficher un loader immédiatement
    modalContent.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16">
            <div class="animate-spin rounded-full h-12 w-12 border-b-4 border-brand-primary mb-4"></div>
            <p class="text-gray-600">Chargement du résumé...</p>
        </div>`;

    titleEl.textContent = `Résumé : ${batchId.slice(-10)}`;
    openModal('batchSummaryModal');

    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) {
            throw new Error("Pas de réponse du serveur");
        }
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Erreur HTTP ${res.status} : ${errorText || 'Inconnue'}`);
        }

        const batch = await res.json();

        // 2. Valeurs par défaut sécurisées
        const application = batch.application || 'N/A';
        const totalRecords = batch.totalRecords || 0;
        const details = Array.isArray(batch.details) ? batch.details : [];

        // 3. Calcul succès / échecs
        const success = details.filter(r => r.status === 'SUCCESS').length;
        const failure = details.filter(r => r.status === 'FAILED').length;

        // 4. Calcul montant financier (seulement pour FUNDS_TRANSFER)
        let totalAmount = 0;
        if (application === 'FUNDS_TRANSFER' && details.length > 0) {
            totalAmount = details.reduce((sum, item) => {
                const debit = parseFloat(item.data?.['DEBIT.AMOUNT']) || 0;
                const credit = parseFloat(item.data?.['CREDIT.AMOUNT']) || 0;
                return sum + debit + credit; // Les deux sont des sorties ou entrées, mais on somme le volume
            }, 0);
        }

        // 5. Journal des erreurs avec parsing sécurisé
        let errorRowsHtml = '';
        if (failure > 0) {
            errorRowsHtml = details
                .filter(r => r.status === 'FAILED')
                .map(r => {
                    let errorMsg = r.errorMessage || 'Erreur inconnue';

                    // Tentative de parsing sécurisé
                    if (typeof r.errorMessage === 'string') {
                        try {
                            const parsed = JSON.parse(r.errorMessage);
                            if (parsed?.error?.errorDetails?.[0]?.message) {
                                errorMsg = parsed.error.errorDetails[0].message;
                            } else if (parsed?.message) {
                                errorMsg = parsed.message;
                            }
                        } catch (e) {
                            // Si ce n'est pas du JSON, on garde le texte brut
                        }
                    }

                    return `
                        <div class="flex items-start gap-3 p-3 bg-red-50 border-l-4 border-red-500 rounded-r-lg mb-2 shadow-sm">
                            <i data-lucide="alert-circle" class="w-4 h-4 text-red-600 mt-0.5 shrink-0"></i>
                            <div class="text-xs">
                                <p class="font-bold text-red-800 uppercase text-[10px]">Ligne ${r.lineNumber || '?'}</p>
                                <p class="text-red-700 font-medium">${errorMsg}</p>
                            </div>
                        </div>`;
                })
                .join('');
        }

        // 6. Construction finale du HTML
        const html = `
            <div class="space-y-6">
                <!-- Stats rapides -->
                <div class="grid grid-cols-3 gap-3">
                    <div class="p-3 bg-gray-50 rounded-md border border-gray-100 text-center">
                        <p class="text-[10px] uppercase font-bold text-gray-400">Total</p>
                        <p class="text-xl font-black text-gray-800">${totalRecords}</p>
                    </div>
                    <div class="p-3 bg-green-50 rounded-md border border-green-100 text-center">
                        <p class="text-[10px] uppercase font-bold text-green-500">Succès</p>
                        <p class="text-xl font-black text-green-700">${success}</p>
                    </div>
                    <div class="p-3 bg-red-50 rounded-md border border-red-100 text-center">
                        <p class="text-[10px] uppercase font-bold text-red-500">Échecs</p>
                        <p class="text-xl font-black text-red-700">${failure}</p>
                    </div>
                </div>

                <!-- Volume financier -->
                ${application === 'FUNDS_TRANSFER' ? `
                <div class="bg-indigo-600 rounded-md p-5 text-white shadow-lg relative overflow-hidden">
                    <div class="relative z-10">
                        <p class="text-indigo-100 text-xs font-bold uppercase tracking-widest mb-1">Volume Financier</p>
                        <p class="text-3xl font-black tracking-tight">
                            ${totalAmount.toLocaleString('fr-FR', { style: 'currency', currency: 'XOF' })}
                        </p>
                    </div>
                    <i data-lucide="banknote" class="absolute -right-1 -bottom-4 w-24 h-24 text-white/10 rotate-12"></i>
                </div>` : ''}

                <!-- Journal des anomalies -->
                <div class="mt-4">
                    <h4 class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                        ${failure > 0
                            ? '<i data-lucide="alert-triangle" class="w-4 h-4 text-orange-500"></i> Journal des anomalies'
                            : '<i data-lucide="check-circle" class="w-4 h-4 text-green-500"></i> Toutes les lignes traitées avec succès'}
                    </h4>
                    <div class="space-y-2 max-h-60 overflow-y-auto pr-2">
                        ${failure > 0
                            ? errorRowsHtml
                            : '<p class="text-xs text-gray-500 italic text-center py-4">Aucune erreur détectée.</p>'}
                    </div>
                </div>

                <!-- Boutons -->
                <div class="flex gap-3 pt-4">
                    <button onclick="downloadExecutionReport('${batchId}')"
                            class="flex-1 inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-md text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all shadow-sm">
                        <i data-lucide="download" class="w-4 h-4"></i> Rapport CSV
                    </button>
                    <button onclick="closeModal('batchSummaryModal')"
                            class="px-6 py-2.5 bg-gray-900 text-white rounded-md text-sm font-bold hover:bg-black transition-all">
                        Fermer
                    </button>
                </div>
            </div>`;

        modalContent.innerHTML = html;
        lucide.createIcons(); // Très important après innerHTML

    } catch (err) {
        console.error("Erreur dans viewBatchSummary:", err);
        modalContent.innerHTML = `
            <div class="text-center py-12">
                <i data-lucide="alert-triangle" class="w-16 h-16 text-red-500 mx-auto mb-4"></i>
                <p class="text-lg font-semibold text-red-600">Erreur de chargement</p>
                <p class="text-sm text-gray-600 mt-2">${err.message || 'Erreur inconnue'}</p>
                <button onclick="closeModal('batchSummaryModal')" class="mt-6 px-6 py-3 bg-gray-900 text-white rounded-md hover:bg-black">
                    Fermer
                </button>
            </div>`;
        lucide.createIcons();
        showSnackbar(`Résumé indisponible : ${err.message}`, "error");
    }
};


/**
 * MODAL & ACTION HANDLERS
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
        if (!response) return;
        if (!response.ok) throw new Error("Erreur serveur");

        showSnackbar('Batch supprimé avec succès', 'success');
        cancelDelete();
        loadUploadedBatches(); // Refresh table

        // Refresh Stats to update counts
        if (typeof loadStats === 'function') {
            loadStats({
                UPLOADED: 'uploadedCount',
                VALIDATED: 'validatedCount',
                PROCESSING: 'validatedCount',
                PROCESSED: 'validatedCount',
                PROCESSED_WITH_ERROR: 'validatedCount',
                PROCESSED_FAILED: 'validatedCount'
            });
        }
    } catch (e) {
        showSnackbar(`Erreur lors de la suppression: ${e.message}`, "error");
    }
};

// Global Exposure for HTML onclick attributes
window.openDeleteModal = openDeleteModal;
window.viewBatchSummary = viewBatchSummary;
window.cancelDelete = cancelDelete;
window.confirmDelete = confirmDelete;
window.closeBatchDetails = () => {
    if (typeof closeModal === 'function') closeModal('batchDetailsModal');
};