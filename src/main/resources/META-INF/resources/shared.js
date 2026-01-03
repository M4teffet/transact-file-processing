const API_BASE = "http://localhost:8080/api";

// -----------------------------
// SNACKBAR (UPDATED)
// -----------------------------
const showSnackbar = (msg, type = "info") => {
    const container = document.getElementById("snackbar-container");
    if (!container) {
        console.error("Snackbar container missing, logging message instead:", msg);
        return;
    }
    const div = document.createElement("div");
    const colors = {
        error: "bg-red-50 border-red-700 text-red-800",
        success: "bg-green-50 border-green-700 text-green-800",
        info: "bg-blue-50 border-blue-700 text-blue-800"
    };
    div.className = `
        p-3 rounded shadow text-sm my-2 border
        opacity-0 translate-y-2 transition-all duration-300
        ${colors[type] || colors.info}
        whitespace-pre-line
    `;
    div.textContent = msg;
    container.appendChild(div);

    requestAnimationFrame(() => {
        div.classList.remove("opacity-0", "translate-y-2");
    });
    setTimeout(() => {
        div.classList.add("opacity-0", "translate-y-2");
        setTimeout(() => div.remove(), 300);
    }, 7000);
};


/**
 * GLOBAL SECURITY WRAPPER
 * Intercepts 401/403 errors to redirect to login
 */
const secureFetch = async (url, options = {}) => {
    try {
        const response = await fetch(url, options);

        // If the server says "Unauthorized", we must leave the current page
        if (response.status === 401 || response.status === 403) {
            console.warn("Auth required. Redirecting to login...");

            // 1. Clear local data to prevent loops
            sessionStorage.clear();

            // 2. Force a HARD redirect (this changes the URL in the bar)
            window.location.href = "/login?error=session_expired";

            // 3. Return a pending promise that never resolves to stop further execution
            return new Promise(() => {});
        }

        return response;
    } catch (error) {
        console.error("Fetch error:", error);
        throw error;
    }
};

// -----------------------------
// LOAD STATS
// -----------------------------
const loadStats = async (mapping) => {
    try {
        const res = await secureFetch(`${API_BASE}/batches/counts?size=999`);
        if (!res) return; // Exit if redirected
        if (!res.ok) return; // Exit if redirected

        const stats = await res.json();
        const totals = {};

        // Aggregate the counts based on the mapping provided in the script
        Object.entries(mapping).forEach(([status, elementId]) => {
            const count = stats[status] || 0;
            if (!totals[elementId]) totals[elementId] = 0;
            totals[elementId] += count;
        });

        // Update DOM elements
        Object.entries(totals).forEach(([elementId, finalSum]) => {
            const el = document.getElementById(elementId);
            if (el) el.textContent = finalSum;
        });
    } catch (err) {
        console.error("Stats Error:", err);
    }
};


// -----------------------------
// STATUS BADGES
// -----------------------------
const getStatusBadge = (status) => {
    const types = {
        UPLOADED: { color: "bg-gray-100 text-gray-700 border-gray-200", icon: "clock", label: "En Attente" },
        VALIDATED: { color: "bg-blue-50 text-blue-700 border-blue-200", icon: "user-check", label: "Signé" },
        PROCESSING: { color: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: "refresh-cw", label: "Traitement" },
        PROCESSED: { color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: "check-circle", label: "Succès" },
        PROCESSED_WITH_ERROR: { color: "bg-orange-100 text-orange-800 border-orange-200", icon: "alert-triangle", label: "Traité avec Anomalies" },
        UPLOADED_FAILED: { color: "bg-red-50 text-red-700 border-red-100", icon: "alert-octagon", label: "Échec Upload" },
        VALIDATED_FAILED: { color: "bg-red-50 text-red-700 border-red-100", icon: "x-octagon", label: "Échec Signature" },
        PROCESSED_FAILED: { color: "bg-red-100 text-red-900 border-red-200", icon: "x-circle", label: "Échec Total" }
    };

    const def = types[status] || { color: "bg-gray-100 text-gray-700 border-gray-200", icon: "help-circle", label: status.replace(/_/g, ' ') };

    return `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-tighter shadow-xs ${def.color}">
            <i data-lucide="${def.icon}" class="w-3.5 h-3.5 ${status === 'PROCESSING' ? 'animate-spin' : ''}"></i>
            ${def.label}
        </span>
    `;
};


// -----------------------------
// VIEW BATCH DETAILS
// -----------------------------
const viewBatchDetails = async (batchId, modalId = "batchDetailsModal", contentId = "batchDetailsContent") => {
    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) return;
        if (!res.ok) throw new Error("Erreur API");

        const { details, batchId: id, totalRecords } = await res.json();

        const content = document.getElementById(contentId);
        if (!content) return;

        if (!details?.length) {
            content.innerHTML = `<p class="text-gray-500 text-sm">Aucune donnée.</p>`;
            return openModal(modalId);
        }

        const preview = details.slice(0, 10);

        // Get all keys from the first row's data
        const keys = Object.keys(preview[0].data);

        // Filter out keys that are null/empty in all preview rows
        const nonNullKeys = keys.filter(k => preview.some(r => r.data[k] != null && r.data[k] !== ""));

        const table = `
            <div class="overflow-auto max-h-96 border rounded">
                <table class="min-w-full text-xs">
                    <thead class="bg-gray-100 sticky top-0 z-10">
                        <tr>${nonNullKeys.map(k => `<th class="px-3 py-2 border-b">${k}</th>`).join("")}</tr>
                    </thead>
                    <tbody>
                        ${preview.map(r => `
                            <tr class="border-b hover:bg-gray-50">
                                ${nonNullKeys.map(k => `<td class="px-3 py-2 border-r">${r.data[k] ?? ""}</td>`).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;

        content.innerHTML = `
            <div class="space-y-2 mb-4">
                <p class="text-sm"><strong>ID :</strong> ${id}</p>
                <p class="text-sm"><strong>Total :</strong> ${totalRecords} enregistrements</p>
            </div>
            <p class="text-gray-500 mb-2 text-xs uppercase font-bold">Aperçu des données</p>
            ${table}
            <button
                onclick="downloadBatchNonNull('${batchId}')"
                class="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-primary text-white rounded hover:bg-brand-dark transition-colors">
                <i data-lucide="download" class="w-4 h-4"></i> Télécharger le CSV complet
            </button>
        `;

        openModal(modalId);
        lucide.createIcons();
    } catch (err) {
        showSnackbar(err.message, "error");
    }
};



// -----------------------------
// DOWNLOAD CSV (FIXED ESCAPING)
// -----------------------------
const downloadBatchNonNull = async (batchId) => {
    try {
        const res = await secureFetch(`${API_BASE}/batches/${batchId}`);
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}: Erreur API`);

        const { details } = await res.json(); // use 'details' instead of 'data'

        if (!details?.length) return showSnackbar("Aucune donnée à télécharger", "error");

        const keys = Object.keys(details[0].data);
        const nonNullKeys = keys.filter(k => details.some(r => r.data[k] != null && r.data[k] !== ""));

        const csvLines = [
            nonNullKeys.join(","),
            ...details.map(r => nonNullKeys.map(k => {
                let val = (r.data[k] ?? "").toString();
                if (val.includes('"') || val.includes(',') || val.includes('\n')) {
                    val = '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            }).join(","))
        ].join("\n");

        const blob = new Blob([csvLines], { type: "text/csv;charset=utf-8;" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `batch_${batchId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

        showSnackbar("Téléchargement lancé !", "success");
    } catch (err) {
        showSnackbar("Erreur: " + err.message, "error");
    }
};


// -----------------------------
// MODALS & LOGOUT
// -----------------------------
const openModal = (id) => {
    const m = document.getElementById(id);
    if (m) { m.classList.remove("hidden"); m.classList.add("flex"); }
};
const closeModal = (id) => {
    const m = document.getElementById(id);
    if (m) { m.classList.add("hidden"); m.classList.remove("flex"); }
};

const logoutUser = async () => {
    sessionStorage.clear();
    try {
        await fetch(`${API_BASE}/logout`, { method: "POST" });
    } finally {
        window.location.href = "/login";
    }
};


// -----------------------------
// EXPORTS & AUTO-INIT
// -----------------------------
window.showSnackbar = showSnackbar;
window.loadStats = loadStats;
window.getStatusBadge = getStatusBadge;
window.viewBatchDetails = viewBatchDetails;
window.downloadBatchNonNull = downloadBatchNonNull;
window.openModal = openModal;
window.closeModal = closeModal;
window.logoutUser = logoutUser;
window.secureFetch = secureFetch;

document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();
});