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
        const response = await secureFetch(`${API_BASE}/batches?status=UPLOADED&uploadedById=`);
        if (!response) return;
        if (!response.ok) throw new Error("Erreur lors de la récupération des batches");

        const result = await response.json();
        // Support pour le format Spring Data (content) ou Array simple
        uploadedBatches = result.content || result;

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
            <div class="flex flex-col items-center justify-center py-12 text-gray-500 bg-white rounded-md border border-dashed">
                <i data-lucide="file-check" class="w-12 h-12 mb-3 opacity-20"></i>
                <p>Aucun batch en attente de validation.</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    const html = `
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-100 bg-white rounded-xs">
               <thead class="bg-zinc-100/80">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">ID Batch</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Application</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fichier</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date Import</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${uploadedBatches.map(b => `
                    <tr class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4 text-sm font-medium text-gray-800">${b.batchId}</td>
                        <td class="px-6 py-4 text-sm text-gray-600 font-mono">${b.application}</td>
                        <td class="px-6 py-4 text-sm text-gray-700 font-medium italic">
                            ${b.originalFilename || 'N/A'}
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-500">
                            ${b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : '---'}
                        </td>
                        <td class="px-6 py-4">${getStatusBadge(b.status)}</td>
                        <td class="px-6 py-4 flex justify-start items-center gap-3">
                            <button onclick="viewBatchDetails('${b.batchId}')" class="p-1.5 hover:bg-blue-50 rounded-full transition" title="Détails">
                                <i data-lucide="eye" class="w-5 h-5 text-blue-500"></i>
                            </button>
                            <button onclick="openDeleteModal('${b.batchId}')" class="p-1.5 hover:bg-red-50 rounded-full transition" title="Supprimer">
                                <i data-lucide="trash-2" class="w-5 h-5 text-red-400"></i>
                            </button>
                            <button onclick="validateBatchNow('${b.batchId}')"
                                    class="px-4 py-1.5 rounded-md text-xs font-bold text-white bg-green-500 hover:bg-green-600 transition-all flex items-center gap-2 shadow-sm">
                                <i data-lucide="check-circle" class="w-4 h-4"></i>
                                VALIDER
                            </button>
                        </td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>`;

    container.innerHTML = html;
    lucide.createIcons();
};

/**
 * ACTION : VALIDATION
 */
const validateBatchNow = async (id) => {
if (!confirm("Voulez-vous valider ce batch et lancer son exécution dans T24 ?")) return;
    try {
        const response = await secureFetch(`${API_BASE}/batches/${id}`, {
            method: 'PUT',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "VALIDATED" })
        });

        if (!response) return;

        if (response.ok) {
            showSnackbar('Batch validé et envoyé pour traitement !', 'success');
            refreshDashboard(); // Met à jour la liste et les compteurs immédiatement
        } else {
            const errorData = await response.json();
            showSnackbar(`Erreur: ${errorData.message || 'Validation échouée'}`, 'error');
        }
    } catch (e) {
        showSnackbar('Erreur technique lors de la validation', 'error');
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
        const response = await fetch(`${API_BASE}/batches/${batchIdToDelete}`, { method: 'DELETE' });
        if (!response.ok) throw new Error("Échec de la suppression");

        showSnackbar('Batch supprimé avec succès', 'success');
        cancelDelete();
        refreshDashboard();
    } catch (e) {
        showSnackbar(`Erreur: ${e.message}`, 'error');
    }
};

// EXPOSITION DES FONCTIONS AU WINDOW (pour les onclick HTML)
window.validateBatchNow = validateBatchNow;
window.openDeleteModal = openDeleteModal;
window.cancelDelete = cancelDelete;
window.confirmDelete = confirmDelete;
window.closeBatchDetails = () => {
    if (typeof closeModal === 'function') closeModal('batchDetailsModal');
};