/**
 * ============================================================================
 * script.js - Full Integrated Version (Drag & Drop + Backend + Error Modal)
 * ============================================================================
 */

// 1. CONFIGURATION & STATE
const DEV_API_BASE = "/api/v1"; // relative — works in dev and production

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
    el.innerHTML = '<option value="">Chargement...</option>';
    try {
        // 30-min cache — the application list almost never changes during a session
        const apps = await fetchCached(`${DEV_API_BASE}/applications`, 30 * 60 * 1000);
        if (!apps) throw new Error('Aucune donnée reçue');
        el.innerHTML = '<option value="">Choisir une application...</option>';
        apps.forEach(app => el.add(new Option(`${app.code} – ${app.label}`, app.code)));
    } catch (err) {
        console.error("[upload] loadApplications failed:", err);
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
        const res = await secureFetch(`${DEV_API_BASE}/applications/${appCode}/fields`);
        if (!res || !res.ok) throw new Error(`Erreur HTTP ${res?.status}`);
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

        if (window.lucide) createIcons([mDiv, oDiv]);
    } catch (err) {
        showAppSnackbar("Erreur lors du chargement des champs", "error");
    }
}

function createFieldItem(field) {
    const div = document.createElement("div");
    div.className = "field-item flex items-center p-2.5 mb-2 cursor-move select-none transition-all";
    div.style.cssText = "background:#fff;border:1px solid var(--line);";
    div.draggable = true;
    div.dataset.fieldName = field.fieldName;
    div.innerHTML = `
        <i data-lucide="grip-vertical" class="w-4 h-4 mr-2" style="color:var(--ink-4)"></i>
        <span style="font-size:.8rem;font-weight:700;color:var(--ink-2)">${field.fieldName}</span>
    `;
    div.addEventListener("mouseenter", () => div.style.borderColor = "var(--orange)");
    div.addEventListener("mouseleave", () => div.style.borderColor = "var(--line)");
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

            elements.previewHeader().innerHTML = '<tr style="background:var(--canvas);border-bottom:1px solid var(--line)">' + header.map(function (h) {
                return '<th style="padding:8px 12px;font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;text-align:left;white-space:nowrap">' + h + '</th>';
            }).join('') + '</tr>';
            elements.previewBody().innerHTML = data.slice(0, 5).map((row, i) => `
                <tr style="background:${i % 2 === 0 ? '#fff' : 'var(--canvas)'};border-bottom:1px solid var(--line-soft)">
                    ${row.map(cell => `<td style="padding:8px 16px;font-size:.8rem;color:var(--ink-2);white-space:nowrap">${cell || ''}</td>`).join('')}
                </tr>
            `).join('');

            elements.previewSection()?.classList.remove("hidden");
            // Scroll the preview into view so the user sees it immediately
            // without having to manually scroll down the page
            setTimeout(() => {
                elements.previewSection()?.scrollIntoView({behavior: 'smooth', block: 'start'});
            }, 50); // brief delay lets the browser paint the unhidden section first
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
        <div style="background:#fff;border-top:3px solid var(--orange);width:100%;max-width:72rem;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding-bottom:1rem;">
            <div style="padding:16px 24px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;background:var(--canvas);">
                <h3 style="font-size:1rem;font-weight:700;color:var(--ink);">Aperçu des données CSV</h3>
                <button id="closeModal" style="padding:4px;color:var(--ink-3);" aria-label="Fermer">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <div class="flex-1 overflow-auto" style="background:var(--canvas);">
                <table class="min-w-full">
                    <thead style="background:var(--line-soft);position:sticky;top:0;z-index:10;">
                        <tr>${headers.map(h => `<th style="padding:10px 20px;text-align:left;font-size:11px;font-weight:700;color:var(--ink-2);text-transform:uppercase;letter-spacing:.05em;">${h}</th>`).join('')}</tr>
                    </thead>
                    <tbody style="background:#fff;">
                        ${displayRows.map(row => `<tr style="border-top:1px solid var(--line-soft)">${row.map(cell => `<td style="padding:10px 20px;font-size:.8rem;color:var(--ink-2);white-space:nowrap">${cell || ''}</td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table>
                ${isTruncated ? `<div style="padding:14px 24px;background:var(--status-processing-bg);border-top:1px solid var(--status-processing-border);text-align:center;color:var(--status-processing-text);font-weight:700;font-size:.8rem;">⚠️ Limité à 1000 lignes</div>` : ''}
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
        <svg class="w-9 h-9" style="color:var(--status-error-text)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
    `;

    modal.innerHTML = `
        <div style="background:#fff;border-top:3px solid var(--status-error-text);width:100%;max-width:48rem;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
            <!-- Header -->
            <div style="padding:18px 24px;border-bottom:1px solid var(--status-error-border);background:var(--status-error-bg);display:flex;align-items:center;gap:16px;">
                ${errorIcon}
                <div class="flex-1">
                    <h3 style="font-size:1.05rem;font-weight:700;color:var(--status-error-text);">${errorMessage}</h3>
                    <p style="font-size:.8rem;color:var(--status-error-text);margin-top:2px;">${errorCount} erreur${errorCount > 1 ? 's' : ''} détectée${errorCount > 1 ? 's' : ''} dans votre fichier CSV</p>
                </div>
                <button id="closeErrorModal" style="padding:6px;color:var(--status-error-text);flex-shrink:0;" aria-label="Fermer">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Error List -->
            <div class="flex-1 overflow-auto p-5" style="background:var(--canvas);">
                <div class="space-y-2">
                    ${errors.map((err, index) => `
                        <div style="background:#fff;border-left:3px solid var(--status-error-text);border-top:1px solid var(--line);border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px 16px;">
                            <div class="flex items-start gap-3">
                                <div style="flex-shrink:0;width:26px;height:26px;background:var(--status-error-bg);display:flex;align-items:center;justify-content:center;">
                                    <span style="color:var(--status-error-text);font-weight:700;font-size:.78rem;">${err.line || index + 1}</span>
                                </div>
                                <div class="flex-1">
                                    <div class="flex items-center gap-2 mb-1">
                                        <span style="font-size:10.5px;font-weight:700;color:var(--status-error-text);text-transform:uppercase;letter-spacing:.06em;">Ligne ${err.line || index + 1}</span>
                                        ${err.field ? `<span class="mono" style="font-size:10.5px;background:var(--status-error-bg);color:var(--status-error-text);padding:2px 6px;">${err.field}</span>` : ''}
                                    </div>
                                    <p style="font-size:.82rem;color:var(--ink-2);line-height:1.5;">${err.message || 'Erreur inconnue'}</p>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Footer -->
            <div style="padding:14px 24px;background:var(--line-soft);border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;">
                <p style="font-size:.8rem;color:var(--ink-2);">
                    <span style="font-weight:700;">Conseil :</span> Corrigez les erreurs dans votre fichier CSV et réessayez.
                </p>
                <button id="closeErrorModalBtn" class="btn-flux" style="border-color:var(--status-error-text);color:var(--status-error-text);">
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
        const checkRes = await secureFetch(`${DEV_API_BASE}/inputter/check-filename?${params}`);
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

        const res = await secureFetch(`${DEV_API_BASE}/inputter/upload`, { method: "POST", body: formData });

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
        loadLastBatch();

    } catch (err) {
        showAppSnackbar("Erreur réseau : " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = state.originalBtnHTML;
    }
}

// "Dernier batch" strip — answers "did my last upload actually go through?"
// without the inputter having to click over to the Batches page.
function loadLastBatch() {
    const filenameEl = document.getElementById('lastBatchFilename');
    const timeEl = document.getElementById('lastBatchTime');
    const badgeEl = document.getElementById('lastBatchBadge');
    if (!filenameEl) return;

    (async () => {
        try {
            const username = sessionStorage.getItem('username') || '';
            const statuses = ['UPLOADED', 'VALIDATED', 'PROCESSING', 'PROCESSED',
                'PROCESSED_WITH_ERROR', 'PROCESSED_FAILED', 'UPLOADED_FAILED', 'VALIDATED_FAILED'];
            const params = new URLSearchParams({uploadedById: username});
            statuses.forEach(s => params.append('status', s));

            const res = await secureFetch(`${DEV_API_BASE}/batches?${params}`);
            if (!res || !res.ok) throw new Error('fetch failed');

            const result = await res.json();
            const raw = result.items || result.content || result;
            const list = Array.isArray(raw) ? raw : [];

            if (!list.length) {
                filenameEl.textContent = "Aucun batch envoyé pour le moment";
                filenameEl.style.cssText = "font-size:.8rem;font-weight:400;color:var(--ink-3)";
                return;
            }

            list.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
            const last = list[0];

            filenameEl.textContent = last.originalFilename || last.batchId;
            filenameEl.style.cssText = "font-size:.8rem;font-weight:700;color:var(--ink)";
            if (timeEl) timeEl.textContent = last.uploadedAt ? new Date(last.uploadedAt).toLocaleString('fr-FR') : '';
            if (badgeEl && typeof getStatusBadge === 'function') badgeEl.innerHTML = getStatusBadge(last.status);

            const accentByStatus = {
                PROCESSED: 'var(--status-success-text)',
                VALIDATED: 'var(--status-validated-text)',
                PROCESSING: 'var(--status-processing-text)',
                PROCESSED_WITH_ERROR: 'var(--status-warning-text)',
                UPLOADED_FAILED: 'var(--status-error-text)',
                VALIDATED_FAILED: 'var(--status-error-text)',
                PROCESSED_FAILED: 'var(--status-error-text)',
            };
            const strip = document.getElementById('lastBatchStrip');
            if (strip) strip.style.borderLeftColor = accentByStatus[last.status] || 'var(--ink-4)';

            if (window.lucide) window.lucide.createIcons();
        } catch (e) {
            filenameEl.textContent = "Impossible de charger le dernier batch";
            filenameEl.style.cssText = "font-size:.8rem;font-weight:400;color:var(--ink-3)";
        }
    })();
}

// 7. INITIALIZATION
// Fire immediately if DOM already loaded, otherwise wait
function initUploadPage() {
    console.log('[upload] initUploadPage() fired, readyState:', document.readyState);
    state.originalBtnHTML = elements.sendCsvBtn()?.innerHTML || "Soumettre";

    loadApplications();
    loadLastBatch();

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

        zone.addEventListener("dragover", () => zone.classList.add("bg-orange-50", "border-orange-400"));
        zone.addEventListener("dragleave", () => zone.classList.remove("bg-orange-50", "border-orange-400"));

        zone.addEventListener("drop", (e) => {
            zone.classList.remove("bg-orange-50", "border-orange-400");
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

    // Pre-existing bug fix: this button had no handler defined at all.
    window.downloadTemplate = () => {
        const header = (elements.csvHeaderCode()?.textContent || "").trim();
        if (!header) return;
        const blob = new Blob([header + "\r\n"], {type: "text/csv;charset=utf-8;"});
        const url = URL.createObjectURL(blob);
        const appName = (elements.appSelect()?.value || "modele").toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const a = document.createElement("a");
        a.href = url;
        a.download = `modele_${appName}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (window.lucide) window.lucide.createIcons();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUploadPage);
} else {
    initUploadPage();
}