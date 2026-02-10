/**
 * ============================================================================
 * script.js - Full Integrated Version (Drag & Drop + Backend + Error Modal)
 * ============================================================================
 */

// 1. CONFIGURATION & STATE
const DEV_API_BASE = "http://localhost:8080/api";

let state = {
    fieldOrder: [],
    mandatoryFields: [],
    optionalFields: [],
    fullCsvData: { header: [], data: [] },
    originalBtnHTML: ""
};

// 2. DOM ELEMENT SELECTORS
const elements = {
    appSelect: () => document.getElementById("appSelect"),
    mandatoryDiv: () => document.getElementById("mandatory-fields"),
    optionalDiv: () => document.getElementById("optional-fields"),
    csvInput: () => document.getElementById("csvInput"),
    csvDropZone: () => document.getElementById("csvDropZone"),
    previewSection: () => document.getElementById("csvPreviewSection"),
    previewHeader: () => document.getElementById("previewHeader"),
    previewBody: () => document.getElementById("previewBody"),
    sendCsvBtn: () => document.getElementById("sendCsvBtn"),
    deleteCsvBtn: () => document.getElementById("deleteCsvBtn"),
    csvHeaderCode: () => document.getElementById("csv-header"),
    uploadSection: () => document.getElementById("uploadSection"),
    fieldsSection: () => document.getElementById("fieldsSection"),
    headerSection: () => document.getElementById("headerSection"),
    successSection: () => document.getElementById("success"),
    batchIdElement: () => document.getElementById("batchId"),
    fullPreviewBtn: () => document.getElementById("fullPreviewBtn")
};

// 3. UTILITIES
const showAppSnackbar = (msg, type = "info") => {
    if (typeof window.showSnackbar === 'function') {
        window.showSnackbar(msg, type);
    } else {
        console.warn(`[${type}] ${msg}`);
    }
};

const parseCsvRow = (row) => {
    let result = [], current = '', inQuotes = false;
    for (let char of row) {
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else current += char;
    }
    result.push(current.trim());
    return result;
};

// 4. CORE LOGIC: APPLICATIONS & FIELDS
async function loadApplications() {
    const el = elements.appSelect();
    if (!el) return;
    el.innerHTML = '<option value="">Chargement...</option>';
    try {
        const res = await fetch(`${DEV_API_BASE}/applications`);
        if (!res.ok) throw new Error("Erreur serveur");
        const apps = await res.json();
        el.innerHTML = '<option value="">Choisir une application...</option>';
        apps.forEach(app => el.add(new Option(`${app.code} – ${app.label}`, app.code)));
    } catch (err) {
        el.innerHTML = '<option value="">Erreur de chargement</option>';
    }
}

async function loadFields(appCode) {
    if (!appCode) return;
    elements.fieldsSection()?.classList.remove("hidden");
    elements.headerSection()?.classList.remove("hidden");
    elements.uploadSection()?.classList.remove("hidden");

    const mDiv = elements.mandatoryDiv();
    const oDiv = elements.optionalDiv();
    mDiv.innerHTML = "<p class='text-gray-400 text-sm py-4'>Chargement...</p>";
    oDiv.innerHTML = "";

    try {
        const res = await fetch(`${DEV_API_BASE}/applications/${appCode}/fields`);
        const data = await res.json();

        mDiv.innerHTML = '';
        oDiv.innerHTML = '';

        (data.mandatory || []).forEach(f => mDiv.appendChild(createFieldItem(f)));
        (data.optional || []).forEach(f => oDiv.appendChild(createFieldItem(f)));

        // Initialize drag & drop
        setupFieldDropZones([mDiv, oDiv]);
        rebuildFieldLists();

        // Ensure accordion starts collapsed
        const content = document.getElementById("fieldsContent");
        const chevron = document.getElementById("fieldsChevron");
        if (content && chevron) {
            content.classList.add("hidden");
            chevron.classList.remove("rotate-180");
        }

        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        showAppSnackbar("Erreur lors du chargement des champs", "error");
    }
}

function createFieldItem(field) {
    const div = document.createElement("div");
    div.className = "field-item flex items-center p-3 bg-white border rounded shadow-sm mb-2 cursor-move hover:border-blue-400 transition-all select-none";
    div.draggable = true;
    div.dataset.fieldName = field.fieldName;
    div.innerHTML = `
        <i data-lucide="grip-vertical" class="w-4 h-4 text-gray-400 mr-2"></i>
        <span class="text-sm font-medium text-gray-700">${field.fieldName}</span>
    `;
    div.addEventListener("dragstart", () => div.classList.add("opacity-50", "dragging"));
    div.addEventListener("dragend", () => {
        div.classList.remove("opacity-50", "dragging");
        rebuildFieldLists();
    });
    return div;
}

// Drag & Drop Logic
function setupFieldDropZones(containers) {
    containers.forEach(container => {
        container.addEventListener("dragover", (e) => {
            e.preventDefault();
            const draggingEl = document.querySelector(".dragging");
            if (!draggingEl) return;
            const afterElement = getDragAfterElement(container, e.clientY);
            if (afterElement == null) container.appendChild(draggingEl);
            else container.insertBefore(draggingEl, afterElement);
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.field-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Rebuild field lists & summary text
function rebuildFieldLists() {
    const mDiv = elements.mandatoryDiv();
    const oDiv = elements.optionalDiv();
    if (!mDiv || !oDiv) return;

    state.mandatoryFields = [...mDiv.querySelectorAll('.field-item')].map(el => el.dataset.fieldName);
    state.optionalFields = [...oDiv.querySelectorAll('.field-item')].map(el => el.dataset.fieldName);

    const headerCode = elements.csvHeaderCode();
    if (headerCode) headerCode.textContent = state.mandatoryFields.join(',');

    const summaryText = document.getElementById("fieldsSummaryText");
    if (summaryText) summaryText.textContent = `${state.mandatoryFields.length} obligatoires • ${state.optionalFields.length} optionnels`;
}

// Accordion toggle
function toggleFieldsVisibility() {
    const content = document.getElementById("fieldsContent");
    const chevron = document.getElementById("fieldsChevron");
    if (!content || !chevron) return;

    const isHidden = content.classList.toggle("hidden");
    chevron.classList.toggle("rotate-180", !isHidden);
}
window.toggleFieldsVisibility = toggleFieldsVisibility;

// 5. CSV PREVIEW
function clearCsvPreview() {
    const input = elements.csvInput();
    if (input) input.value = '';
    state.fullCsvData = { header: [], data: [] };
    elements.previewSection()?.classList.add("hidden");

    const sendBtn = elements.sendCsvBtn();
    if (sendBtn) { sendBtn.disabled = true; sendBtn.classList.add("opacity-50"); }
}

function previewCsv(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
        showAppSnackbar("Format invalide : Veuillez sélectionner un fichier .csv", "error");
        clearCsvPreview();
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const lines = e.target.result.split(/\r?\n/).filter(l => l.trim() !== "");
            if (lines.length === 0) throw new Error("CSV vide");
            const header = parseCsvRow(lines[0]);
            const data = lines.slice(1).map(parseCsvRow);
            state.fullCsvData = { header, data };

            elements.previewHeader().innerHTML = `<tr class="bg-gray-100 border-b">${header.map(h => `<th class="px-4 py-2 text-xs font-bold text-gray-600 uppercase text-left whitespace-nowrap">${h}</th>`).join('')}</tr>`;
            elements.previewBody().innerHTML = data.slice(0, 5).map((row, i) => `
                <tr class="${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-b">
                    ${row.map(cell => `<td class="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">${cell || ''}</td>`).join('')}
                </tr>
            `).join('');

            elements.previewSection()?.classList.remove("hidden");
            const fullBtn = elements.fullPreviewBtn();
            if (fullBtn) {
                fullBtn.classList.toggle('hidden', data.length <= 5);
                fullBtn.textContent = `Afficher toutes les lignes (${data.length})`;
            }

            const sendBtn = elements.sendCsvBtn();
            if (sendBtn) { sendBtn.disabled = false; sendBtn.classList.remove("opacity-50"); }

        } catch (err) {
            showAppSnackbar("Impossible de lire le CSV : " + err.message, "error");
        }
    };
    reader.readAsText(file);
}

function openFullCsvPreview() {
    const data = state.fullCsvData.data;
    if (!data || !data.length) return;

    const headers = state.fullCsvData.header;
    const MAX_ROWS = 1000;
    const displayRows = data.slice(0, MAX_ROWS);
    const isTruncated = data.length > MAX_ROWS;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.innerHTML = `
        <div class="bg-white rounded-md shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden pb-4">
            <div class="px-6 py-4 border-b flex justify-between items-center bg-gradient-to-r from-blue-50 to-indigo-50">
                <h3 class="text-lg font-bold text-gray-800">Aperçu des données CSV</h3>
                <button id="closeModal" class="p-1 rounded-full hover:bg-gray-100 transition" aria-label="Fermer">
                    <svg class="w-5 h-5 text-gray-700 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <div class="flex-1 overflow-auto bg-gray-50">
                <table class="min-w-full divide-y divide-gray-300">
                    <thead class="bg-gray-200 sticky top-0 z-10">
                        <tr>${headers.map(h => `<th class="px-5 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">${h}</th>`).join('')}</tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${displayRows.map(row => `<tr>${row.map(cell => `<td class="px-5 py-3 text-sm text-gray-700 whitespace-nowrap">${cell || ''}</td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table>
                ${isTruncated ? `<div class="px-6 py-4 bg-orange-50 border-t text-center text-orange-800 font-medium">⚠️ Limité à 1000 lignes</div>` : ''}
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#closeModal').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.remove(); }, { once: true });
}

// ✅ NEW: Show validation error modal
function showValidationErrorModal(errorData) {
    const errors = errorData.details || [];
    const errorMessage = errorData.error || "Erreurs de validation";

    if (errors.length === 0) {
        showAppSnackbar(errorMessage, "error");
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const errorCount = errors.length;
    const errorIcon = `
        <svg class="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
    `;

    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <!-- Header -->
            <div class="px-6 py-5 border-b bg-red-50 flex items-center gap-4">
                ${errorIcon}
                <div class="flex-1">
                    <h3 class="text-xl font-bold text-red-900">${errorMessage}</h3>
                    <p class="text-sm text-red-700 mt-1">${errorCount} erreur${errorCount > 1 ? 's' : ''} détectée${errorCount > 1 ? 's' : ''} dans votre fichier CSV</p>
                </div>
                <button id="closeErrorModal" class="p-2 rounded-full hover:bg-red-100 transition" aria-label="Fermer">
                    <svg class="w-6 h-6 text-red-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Error List -->
            <div class="flex-1 overflow-auto p-6 bg-gray-50">
                <div class="space-y-3">
                    ${errors.map((err, index) => `
                        <div class="bg-white border-l-4 border-red-500 rounded-r-lg shadow-sm p-4 hover:shadow-md transition-shadow">
                            <div class="flex items-start gap-3">
                                <div class="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                                    <span class="text-red-700 font-bold text-sm">${err.line || index + 1}</span>
                                </div>
                                <div class="flex-1">
                                    <div class="flex items-center gap-2 mb-1">
                                        <span class="text-xs font-semibold text-red-600 uppercase tracking-wider">Ligne ${err.line || index + 1}</span>
                                        ${err.field ? `<span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-mono">${err.field}</span>` : ''}
                                    </div>
                                    <p class="text-sm text-gray-800 leading-relaxed">${err.message || 'Erreur inconnue'}</p>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 bg-gray-100 border-t flex justify-between items-center">
                <p class="text-sm text-gray-600">
                    <span class="font-semibold">💡 Conseil :</span> Corrigez les erreurs dans votre fichier CSV et réessayez.
                </p>
                <button id="closeErrorModalBtn" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium">
                    Fermer
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('#closeErrorModal').onclick = closeModal;
    modal.querySelector('#closeErrorModalBtn').onclick = closeModal;
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); }, { once: true });
}

// 6. UPLOAD ACTION (UPDATED)
async function handleUpload() {
    const file = elements.csvInput().files[0];
    const app = elements.appSelect().value;
    const btn = elements.sendCsvBtn();
    if (!file || !app) return showAppSnackbar("Fichier ou application manquante", "error");

    if (!file.name.toLowerCase().endsWith('.csv')) return showAppSnackbar("Seuls les fichiers CSV sont autorisés.", "error");

    const filename = file.name;
    try {
        const params = new URLSearchParams({ applicationName: app, filename });
        const checkRes = await fetch(`${DEV_API_BASE}/inputter/check-filename?${params}`);
        if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.exists) return showAppSnackbar(`Le fichier "${filename}" existe déjà.`, "error");
        }
    } catch (err) { console.warn("Pre-check failed", err); }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("applicationName", app);

    try {
        btn.disabled = true;
        btn.innerHTML = "⏳ Envoi...";

        const res = await fetch(`${DEV_API_BASE}/inputter/upload`, { method: "POST", body: formData });

        // ✅ UPDATED: Better error handling
        if (!res.ok) {
            const contentType = res.headers.get('content-type');
            let errorData;

            if (contentType && contentType.includes('application/json')) {
                errorData = await res.json();
            } else {
                const text = await res.text();
                errorData = { error: text || `Erreur ${res.status}` };
            }

            // ✅ Show modal for validation errors
            if (errorData.details && Array.isArray(errorData.details)) {
                showValidationErrorModal(errorData);
            } else {
                showAppSnackbar(errorData.error || errorData.message || "Erreur serveur", "error");
            }
            return;
        }

        const data = await res.json();
        elements.batchIdElement().textContent = data.batchId;
        elements.successSection()?.classList.remove("hidden");
        elements.uploadSection()?.classList.add("hidden");
        elements.previewSection()?.classList.add("hidden");

        showAppSnackbar("Upload réussi !", "success");

    } catch (err) {
        showAppSnackbar("Erreur réseau : " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = state.originalBtnHTML;
    }
}

// 7. INITIALIZATION
document.addEventListener("DOMContentLoaded", () => {
    state.originalBtnHTML = elements.sendCsvBtn()?.innerHTML || "Soumettre";

    loadApplications();

    loadStats({
        UPLOADED: 'uploadedCount',
        VALIDATED: 'validatedCount',
        PROCESSING: 'validatedCount',
        PROCESSED: 'validatedCount',
        PROCESSED_WITH_ERROR: 'validatedCount',
        PROCESSED_FAILED: 'validatedCount'
    });

    elements.appSelect()?.addEventListener("change", (e) => {
        if (e.target.value) { loadFields(e.target.value); clearCsvPreview(); }
        else { elements.fieldsSection()?.classList.add("hidden"); elements.uploadSection()?.classList.add("hidden"); clearCsvPreview(); }
    });

    elements.csvInput()?.addEventListener("change", (e) => {
        if (e.target.files.length > 0) previewCsv(e.target.files[0]);
    });

    elements.deleteCsvBtn()?.addEventListener('click', (e) => { e.preventDefault(); clearCsvPreview(); });
    elements.fullPreviewBtn()?.addEventListener('click', (e) => { e.preventDefault(); openFullCsvPreview(); });

    // Drag & Drop CSV
    const zone = elements.csvDropZone();
    if (zone) {
        ['dragenter','dragover','dragleave','drop'].forEach(name => {
            zone.addEventListener(name, e => { e.preventDefault(); e.stopPropagation(); });
        });

        zone.addEventListener("dragover", () => zone.classList.add("bg-blue-50", "border-blue-400"));
        zone.addEventListener("dragleave", () => zone.classList.remove("bg-blue-50", "border-blue-400"));

        zone.addEventListener("drop", (e) => {
            zone.classList.remove("bg-blue-50", "border-blue-400");
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const dt = new DataTransfer();
                dt.items.add(files[0]);
                elements.csvInput().files = dt.files;
                previewCsv(files[0]);
            }
        });

        zone.addEventListener("click", () => elements.csvInput().click());
    }

    elements.sendCsvBtn()?.addEventListener("click", handleUpload);

    window.copyHeader = () => {
        const text = elements.csvHeaderCode().textContent;
        navigator.clipboard.writeText(text).then(() => showAppSnackbar("Copié dans le presse-papiers", "success"));
    };

    if (window.lucide) window.lucide.createIcons();
});