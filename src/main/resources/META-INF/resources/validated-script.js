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
        // Fetch statuses representing the execution lifecycle
        const statuses = ['VALIDATED', 'PROCESSING', 'PROCESSED', 'PROCESSED_WITH_ERROR', 'PROCESSED_FAILED'];
        const queryParams = statuses.map(s => `status=${s}`).join('&');

        const res = await secureFetch(`${API_BASE}/batches?${queryParams}`);
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

        const result = await res.json();
        // Support Spring Pageable (content) or standard Array
        validatedBatches = result.content || result;

        renderValidatedBatches();
    } catch (e) {
        showSnackbar(`Erreur de chargement: ${e.message}`, "error");
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
            <div class="flex flex-col items-center justify-center py-12 text-gray-500 bg-white rounded-xl border border-dashed">
                <i data-lucide="info" class="w-12 h-12 mb-3 opacity-20"></i>
                <p>Aucun batch validé ou en cours de traitement.</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    const html = `
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 bg-white rounded-xl shadow-sm border border-gray-100">
                <thead class="bg-gray-50/50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">ID</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Application</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                        <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                        <th class="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${validatedBatches.map(b => `
                        <tr class="hover:bg-gray-50 transition-colors">
                            <td class="px-6 py-4 text-sm font-medium text-gray-800">${b.batchId}</td>
                            <td class="px-6 py-4 text-sm text-gray-600 font-mono">${b.application}</td>
                            <td class="px-6 py-4 text-sm text-gray-500">${new Date(b.uploadedAt).toLocaleString('fr-FR')}</td>
                            <td class="px-6 py-4">${getStatusBadge(b.status)}</td>
                            <td class="px-6 py-4 flex justify-end items-center gap-3">
                                <button onclick="viewBatchDetails('${b.batchId}')" class="p-1.5 hover:bg-blue-50 rounded-full transition" title="Voir données">
                                    <i data-lucide="eye" class="w-5 h-5 text-blue-500"></i>
                                </button>
                                <button onclick="viewBatchSummary('${b.batchId}')" class="p-1.5 hover:bg-teal-50 rounded-full transition" title="Résumé d'exécution">
                                    <i data-lucide="file-text" class="w-5 h-5 text-teal-600"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
    lucide.createIcons();
};

// -----------------------------
// EXECUTION SUMMARY (MODAL)
// -----------------------------
const viewBatchSummary = async (batchId) => {
    try {
        // Fetch the batch data from the API
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) return;
        if (!res.ok) throw new Error("Erreur lors de la récupération du résumé");

        const batch = await res.json();

        /** * 1. Data Destructuring
         * Based on your JSON, we use 'details' as the primary source of truth.
         */
        const { application, totalRecords, details } = batch;

        // Calculate counts based on the 'status' field in the details array
        const success = details ? details.filter(r => r.status === 'SUCCESS').length : 0;
        const failure = details ? details.filter(r => r.status === 'FAILED').length : 0;

        /**
         * 2. Financial Total Calculation
         * We check both Debit and Credit amounts as per T24 FUNDS_TRANSFER structure
         */
        let totalAmount = 0;
        if (application === 'FUNDS_TRANSFER' && details) {
            totalAmount = details.reduce((sum, item) => {
                const amt = parseFloat(item.data['DEBIT.AMOUNT'] || item.data['CREDIT.AMOUNT']) || 0;
                return sum + amt;
            }, 0);
        }

        /**
         * 3. Error Rows Rendering (Anomaly Journal)
         * Parses stringified JSON error messages into human-readable text
         */
        let errorRowsHtml = '';
        if (failure > 0 && details) {
            errorRowsHtml = details
                .filter(r => r.status === 'FAILED')
                .map(r => {
                    let cleanError = r.errorMessage;
                    try {
                        // Parse nested JSON from T24 response
                        const parsed = JSON.parse(r.errorMessage);
                        if (parsed.error && parsed.error.errorDetails && parsed.error.errorDetails.length > 0) {
                            cleanError = parsed.error.errorDetails[0].message;
                        }
                    } catch (e) {
                        // If not JSON (e.g., timeout error), keep the original text
                    }

                    return `
                        <div class="flex items-start gap-3 p-3 bg-red-50 border-l-4 border-red-500 rounded-r-lg mb-2 shadow-sm">
                            <i data-lucide="alert-circle" class="w-4 h-4 text-red-600 mt-0.5 shrink-0"></i>
                            <div class="text-xs">
                                <p class="font-bold text-red-800 uppercase text-[10px]">Ligne ${r.lineNumber}</p>
                                <p class="text-red-700 font-medium">${cleanError}</p>
                            </div>
                        </div>
                    `;
                }).join('');
        }

        /**
         * 4. UI Construction
         * Using Tailwind CSS classes for the layout
         */
        const dashboardHtml = `
            <div class="space-y-6">
                <div class="grid grid-cols-3 gap-3">
                    <div class="p-3 bg-gray-50 rounded-xl border border-gray-100 text-center">
                        <p class="text-[10px] uppercase font-bold text-gray-400">Total</p>
                        <p class="text-xl font-black text-gray-800">${totalRecords}</p>
                    </div>
                    <div class="p-3 bg-green-50 rounded-xl border border-green-100 text-center">
                        <p class="text-[10px] uppercase font-bold text-green-500">Succès</p>
                        <p class="text-xl font-black text-green-700">${success}</p>
                    </div>
                    <div class="p-3 bg-red-50 rounded-xl border border-red-100 text-center">
                        <p class="text-[10px] uppercase font-bold text-red-500">Échecs</p>
                        <p class="text-xl font-black text-red-700">${failure}</p>
                    </div>
                </div>

                <div class="bg-indigo-600 rounded-xl p-5 text-white shadow-lg relative overflow-hidden">
                    <div class="relative z-10">
                        <p class="text-indigo-100 text-xs font-bold uppercase tracking-widest mb-1">Volume Financier</p>
                        <p class="text-3xl font-black tracking-tight">
                            ${totalAmount.toLocaleString('fr-FR', { style: 'currency', currency: 'XOF' })}
                        </p>
                    </div>
                    <i data-lucide="banknote" class="absolute -right-1 -bottom-4 w-24 h-24 text-white/10 rotate-12"></i>
                </div>

                <div class="mt-4">
                    <h4 class="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                        ${failure > 0
                            ? '<i data-lucide="alert-triangle" class="w-4 h-4 text-orange-500"></i> Journal des anomalies'
                            : '<i data-lucide="check-circle" class="w-4 h-4 text-green-500"></i> Statut Technique'}
                    </h4>
                    <div class="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                        ${failure > 0
                            ? errorRowsHtml
                            : '<p class="text-xs text-gray-500 italic text-center py-4">Toutes les transactions ont été traitées avec succès.</p>'}
                    </div>
                </div>

                <div class="flex gap-3 pt-4">
                    <button onclick="downloadExecutionReport('${batchId}')"
                            class="flex-1 inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all shadow-sm">
                        <i data-lucide="download" class="w-4 h-4"></i> Rapport CSV
                    </button>
                    <button onclick="closeModal('batchSummaryModal')"
                            class="px-6 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-black transition-all">
                        Fermer
                    </button>
                </div>
            </div>
        `;

        // Update DOM elements
        document.getElementById('batchSummaryContent').innerHTML = dashboardHtml;
        document.getElementById('batchSummaryTitle').innerText = `Résumé : ${batchId.slice(-10)}`;

        // Open Modal and re-trigger Lucide icon generation
        openModal('batchSummaryModal');
        if (window.lucide) {
            lucide.createIcons();
        }

    } catch (err) {
        console.error("View Summary Error:", err);
        if (window.showSnackbar) {
            showSnackbar(err.message, "error");
        }
    }
};

/**
 * GENERATE DYNAMIC CSV REPORT
 * Merges technical T24 results with original business data.
 */
const downloadExecutionReport = async (batchId) => {
    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) return;
        if (!res.ok) throw new Error("Impossible de récupérer les données du batch.");
        const batch = await res.json();

        // FIX: In your JSON, data is in 'details', not 'summary'
        const records = batch.details;

        if (!records || records.length === 0) {
            showSnackbar("Aucune donnée disponible pour l'export.", "info");
            return;
        }

        // 1. Collect all unique field names from the 'data' objects
        let allPossibleFields = new Set();
        records.forEach(item => {
            if (item.data) {
                Object.keys(item.data).forEach(key => {
                    // Only include fields that have at least one non-null value in the batch
                    if (item.data[key] !== null && item.data[key] !== undefined) {
                        allPossibleFields.add(key);
                    }
                });
            }
        });

        const dynamicFields = Array.from(allPossibleFields).sort();

        // 2. Define CSV Headers
        const headers = [
            "Ligne",
            "Statut T24",
            "Reference T24",
            "Message Erreur (Propre)",
            ...dynamicFields
        ];

        // 3. Map rows for CSV
        const csvRows = records.map(record => {
            const bizData = record.data || {};

            // Clean the error message (Handling the stringified JSON from T24)
            let cleanError = record.errorMessage || "";
            if (record.status === 'FAILED' && cleanError.startsWith('{')) {
                try {
                    const parsed = JSON.parse(cleanError);
                    cleanError = parsed.error?.errorDetails?.[0]?.message || cleanError;
                } catch (e) { /* Keep original if parsing fails */ }
            }

            // Technical columns
            const row = [
                record.lineNumber,
                `"${record.status}"`,
                `"${record.t24Reference || 'N/A'}"`,
                `"${cleanError.replace(/"/g, '""')}"` // Escape quotes for CSV
            ];

            // Business columns
            dynamicFields.forEach(field => {
                const value = bizData[field] ?? "";
                row.push(`"${value.toString().replace(/"/g, '""')}"`);
            });

            return row;
        });

        // 4. Build CSV String
        const csvString = [
            headers.join(","),
            ...csvRows.map(r => r.join(","))
        ].join("\n");

        // 5. Trigger Download with UTF-8 BOM (Essential for Excel to read French accents/symbols)
        const blob = new Blob(["\ufeff" + csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.setAttribute("href", url);
        link.setAttribute("download", `Report_${batch.application}_${batchId.slice(-8)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showSnackbar("Rapport CSV généré avec succès", "success");

    } catch (err) {
        console.error("CSV Export Error:", err);
        showSnackbar("Erreur lors de l'exportation : " + err.message, "error");
    }
};

// Global Exposure
window.viewBatchDetails = viewBatchDetails;
window.viewBatchSummary = viewBatchSummary;
window.refreshValidatedView = refreshValidatedView;
window.downloadExecutionReport = downloadExecutionReport;