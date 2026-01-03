/**
 * ============================================================================
 * script.js - Final Integrated Version (Upgraded Drag & Drop)
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

// 4. CORE LOGIC: APPLICATION & FIELDS
async function loadApplications() {
    const el = elements.appSelect();
    if (!el) return;
    el.innerHTML = '<option value="">Chargement...</option>';
    try {
        const res = await secureFetch(`${DEV_API_BASE}/applications`);
        if (!res) return;
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

    try {
        const res = await fetch(`${DEV_API_BASE}/applications/${appCode}/fields`);
        const data = await res.json();

        mDiv.innerHTML = '';
        oDiv.innerHTML = '';

        (data.mandatory || []).forEach(f => mDiv.appendChild(createFieldItem(f)));
        (data.optional || []).forEach(f => oDiv.appendChild(createFieldItem(f)));

        // UPGRADE: Initialize Drop Zones for field movement
        setupFieldDropZones([mDiv, oDiv]);

        rebuildFieldLists();
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

// UPGRADE: Advanced Field Drop Logic (Allows reordering and cross-list moving)
function setupFieldDropZones(containers) {
    containers.forEach(container => {
        container.addEventListener("dragover", (e) => {
            e.preventDefault();
            const draggingEl = document.querySelector(".dragging");
            if (!draggingEl) return;

            const afterElement = getDragAfterElement(container, e.clientY);
            if (afterElement == null) {
                container.appendChild(draggingEl);
            } else {
                container.insertBefore(draggingEl, afterElement);
            }
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.field-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function rebuildFieldLists() {
    const mDiv = elements.mandatoryDiv();
    if (!mDiv) return;
    state.mandatoryFields = [...mDiv.querySelectorAll('.field-item')].map(el => el.dataset.fieldName);
    const headerCode = elements.csvHeaderCode();
    if (headerCode) headerCode.textContent = state.mandatoryFields.join(',');
}

// 5. THE PREVIEW ENGINE
function clearCsvPreview() {
    const input = elements.csvInput();
    if (input) input.value = '';
    state.fullCsvData = { header: [], data: [] };
    elements.previewSection()?.classList.add("hidden");
    const existingSummary = document.getElementById('dataCaptureSummary');
    if (existingSummary) existingSummary.remove();

    const sendBtn = elements.sendCsvBtn();
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.classList.add("opacity-50");
    }
}

function openFullCsvPreview() {
    if (!state.fullCsvData.data.length) return;
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 focus';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
            <div class="px-6 py-4 border-b flex justify-between items-center bg-gray-50">
                <h3 class="font-bold text-gray-800">Données complètes (${state.fullCsvData.data.length} lignes)</h3>
                <button id="closeModal" class="p-2 hover:bg-gray-200 rounded-full transition-colors text-2xl line-height-0">&times;</button>
            </div>
            <div class="overflow-auto flex-1">
                <table class="min-w-full divide-y divide-gray-200 text-left">
                    <thead class="bg-gray-100 sticky top-0">
                        <tr>
                            ${state.fullCsvData.header.map(h => `<th class="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase">${h}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${state.fullCsvData.data.map(row => `<tr>${row.map(c => `<td class="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">${c || ''}</td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#closeModal').onclick = () => modal.remove();
    modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
}

function previewCsv(file) {
    if (!file) return;
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
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.classList.remove("opacity-50");
            }

            const appCode = elements.appSelect().value;
            if (appCode === 'DATA_CAPTURE') {
                const summary = computeSummaryData(header, data);
                renderSummary(summary, appCode);
            }
        } catch (err) {
            showAppSnackbar("Impossible de lire le CSV : " + err.message, "error");
        }
    };
    reader.readAsText(file);
}

// 6. SUMMARY LOGIC
function computeSummaryData(header, data) {
    const h = header.map(v => v.trim().toUpperCase());
    const amtIdx = h.findIndex(val => val === 'AMOUNT_LCY' || val === 'AMOUNT.LCY');
    const signIdx = h.indexOf('SIGN');
    if (amtIdx === -1 || signIdx === -1) return { fieldsMissing: true };

    let dr = 0, cr = 0;
    data.forEach(row => {
        const amt = parseFloat((row[amtIdx] || "0").toString().replace(/,/g, ''));
        const sign = row[signIdx]?.trim().toUpperCase();
        if (!isNaN(amt) && amt > 0) {
            if (sign === 'D') dr += amt;
            else if (sign === 'C') cr += amt;
        }
    });

    return { totalDebit: dr, totalCredit: cr, mismatch: Math.abs(dr - cr) > 0.01, fieldsMissing: false };
}

function renderSummary(summary, appCode) {
    const existingSummary = document.getElementById('dataCaptureSummary');
    if (existingSummary) existingSummary.remove();
    if (appCode !== 'DATA_CAPTURE' || !summary) return;

    const summaryDiv = document.createElement('div');
    summaryDiv.id = 'dataCaptureSummary';
    summaryDiv.className = 'mt-6';
    const fmt = (v) => Number(v).toLocaleString('fr-FR');
    const statusColor = summary.mismatch ? 'border-red-500 bg-red-50/30' : 'border-green-500 bg-green-50/30';

    summaryDiv.innerHTML = `
    <div class="p-5 bg-white rounded-xl border-2 shadow-sm ${statusColor} transition-all duration-300">
        <h4 class="text-sm font-bold text-gray-700 mb-4 uppercase tracking-wider flex items-center gap-2">
            <i data-lucide="bar-chart-3" class="w-4 h-4"></i> Résumé des Transactions
        </h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div class="text-center p-4 bg-white rounded-lg border border-red-200">
                <p class="text-[10px] font-bold text-red-500 uppercase mb-1">Total Débit</p>
                <p class="text-2xl font-black text-red-600">${fmt(summary.totalDebit)}</p>
            </div>
            <div class="text-center p-4 bg-white rounded-lg border border-green-200">
                <p class="text-[10px] font-bold text-green-500 uppercase mb-1">Total Crédit</p>
                <p class="text-2xl font-black text-green-600">${fmt(summary.totalCredit)}</p>
            </div>
        </div>
        ${summary.mismatch ?
            `<p class="text-red-600 text-xs font-bold flex items-center gap-2 py-2 px-3 bg-white rounded border border-red-200 shadow-sm">
                <i data-lucide="alert-octagon" class="w-4 h-4"></i> Déséquilibre détecté.
            </p>` :
            `<p class="text-green-600 text-xs font-bold flex items-center gap-2 py-2 px-3 bg-white rounded border border-green-200 shadow-sm">
                <i data-lucide="check-circle" class="w-4 h-4"></i> Balance équilibrée.
            </p>`
        }
    </div>`;
    elements.previewSection().appendChild(summaryDiv);
    if (window.lucide) window.lucide.createIcons();
}

// 7. UPLOAD ACTION
async function handleUpload() {
    const file = elements.csvInput().files[0];
    const app = elements.appSelect().value;
    const btn = elements.sendCsvBtn();
    if (!file || !app) return showAppSnackbar("Fichier ou application manquante", "error");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("applicationName", app);

    try {
        btn.disabled = true;
        btn.innerHTML = "⏳ Envoi...";
        const res = await secureFetch(`${DEV_API_BASE}/inputter/upload`, { method: "POST", body: formData });
        if (!res) return;
        if (!res.ok) throw new Error(await res.text());
        const result = await res.json();
        elements.batchIdElement().textContent = result.batchId;
        elements.successSection()?.classList.remove("hidden");
        elements.uploadSection()?.classList.add("hidden");
        elements.previewSection()?.classList.add("hidden");
        showAppSnackbar("Upload réussi !", "success");
    } catch (err) {
        showAppSnackbar(err.message, "error");
        btn.disabled = false;
        btn.innerHTML = state.originalBtnHTML;
    }
}

// 8. INITIALIZATION
document.addEventListener("DOMContentLoaded", () => {
    state.originalBtnHTML = elements.sendCsvBtn()?.innerHTML || "Envoyer";
    loadApplications();

            loadStats({
                UPLOADED: 'uploadedCount',
                VALIDATED: 'validatedCount',
                PROCESSING: 'validatedCount',
                PROCESSED: 'validatedCount',
                PROCESSED_WITH_ERROR: 'validatedCount',
                PROCESSED_FAILED: 'validatedCount' // This ensures "1" appears if a batch failed
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

    // UPGRADE: Secure File Drag & Drop using DataTransfer API
    const zone = elements.csvDropZone();
    if (zone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
            zone.addEventListener(name, (e) => { e.preventDefault(); e.stopPropagation(); });
        });

        zone.addEventListener("dragover", () => zone.classList.add("bg-blue-50", "border-blue-400"));
        zone.addEventListener("dragleave", () => zone.classList.remove("bg-blue-50", "border-blue-400"));

        zone.addEventListener("drop", (e) => {
            zone.classList.remove("bg-blue-50", "border-blue-400");
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                // Important: Link the dropped file to the hidden input
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(files[0]);
                elements.csvInput().files = dataTransfer.files;
                previewCsv(files[0]);
            }
        });

        // Bonus: Click on zone to trigger input
        zone.addEventListener("click", () => elements.csvInput().click());
    }

    elements.sendCsvBtn()?.addEventListener("click", handleUpload);

    window.copyHeader = () => {
        const text = elements.csvHeaderCode().textContent;
        navigator.clipboard.writeText(text).then(() => showAppSnackbar("Header copié !", "success"));
    };

    if (window.lucide) window.lucide.createIcons();
});