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
        const response = await fetch(`${API_BASE}/batches?size=999`);
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
                        <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${uploadedBatches.map(b => `
                    <tr class="hover:bg-brand-light/30 transition-colors">
                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${b.batchId}</td>
                        <td class="px-6 py-4 text-sm text-gray-600 font-mono text-xs">${b.application || 'N/A'}</td>
                        <td class="px-6 py-4 text-sm text-gray-500">
                            ${b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : 'Date inconnue'}
                        </td>
                        <td class="px-6 py-4 text-sm">
                            ${getStatusBadge(b.status)}
                        </td>
                        <td class="px-6 py-4 flex justify-end gap-2">
                            <button onclick="viewBatchDetails('${b.batchId}')" title="Voir détails" class="p-2 hover:bg-blue-50 rounded-full transition">
                                <i data-lucide="eye" class="w-5 h-5 text-blue-500"></i>
                            </button>
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
        const response = await fetch(`${API_BASE}/batches/${batchIdToDelete}`, { method: 'DELETE' });
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
window.cancelDelete = cancelDelete;
window.confirmDelete = confirmDelete;
window.closeBatchDetails = () => {
    if (typeof closeModal === 'function') closeModal('batchDetailsModal');
};