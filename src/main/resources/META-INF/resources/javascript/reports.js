/**
 * reports.js
 *
 * Fixes applied vs previous version:
 *  1. Uses /api/v1/batches/export instead of /api/v1/batches?size=9999
 *     → removes the silent 50-record cap
 *  2. Date params renamed from startDate/endDate → from/to (matches the API)
 *  3. Department filter now works (field present in BatchViewDTO)
 *  4. CSV export includes successCount and failureCount columns
 *  5. PDF export includes successCount and failureCount columns
 *  6. Table search runs against filteredBatches (all data), not just the current page
 *  7. Status filter cleaned up to only show statuses that make sense in a report
 *  8. Field references normalised: uploadedBy / validatedBy (no more *ById fallbacks)
 */

let allBatches = [];
let filteredBatches = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 20;

// ── Initialisation ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initializeDates();
    loadInitialData();

    // The date range is applied server-side when fetching (/batches/export),
    // so changing either date must re-fetch — otherwise the pickers appear inert.
    const reloadOnDateChange = () => {
        const from = document.getElementById('startDate').value;
        const to = document.getElementById('endDate').value;
        if (from && to && from > to) {
            showSnackbar('La date de début doit précéder la date de fin', 'error');
            return;
        }
        loadBatchData();
    };
    document.getElementById('startDate').addEventListener('change', reloadOnDateChange);
    document.getElementById('endDate').addEventListener('change', reloadOnDateChange);
});

function initializeDates() {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('startDate').value = first.toISOString().split('T')[0];
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
}

async function loadInitialData() {
    try {
        await Promise.all([loadCountries(), loadDepartments(), loadBatchData()]);
    } catch (err) {
        console.error('Erreur chargement initial:', err);
        showSnackbar('Erreur lors du chargement des données', 'error');
    }
}

// ── Filter population ─────────────────────────────────────────────────────────

async function loadCountries() {
    try {
        const countries = await fetchCached(`${API_BASE}/country/list`);
        if (!countries) return;
        const sel = document.getElementById('countryFilter');
        sel.innerHTML = '<option value="">Tous les pays</option>' +
            countries.map(c => `<option value="${c.code}">${getCountryName(c.code)} (${c.code})</option>`).join('');
    } catch (e) {
        console.error('Erreur chargement pays:', e);
    }
}

async function loadDepartments() {
    try {
        const depts = await fetchCached(`${API_BASE}/departments/list`);
        if (!depts) return;
        const sel = document.getElementById('departmentFilter');
        sel.innerHTML = '<option value="">Tous les départements</option>' +
            depts.map(d => `<option value="${d.code}">${d.description} (${d.code})</option>`).join('');
    } catch (e) {
        console.error('Erreur chargement départements:', e);
    }
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadBatchData() {
    try {
        const from = document.getElementById('startDate').value;
        const to = document.getElementById('endDate').value;

        // ✅ FIX 1: correct endpoint — no 50-record cap
        // ✅ FIX 2: params renamed from/to (API uses from/to, not startDate/endDate)
        const params = new URLSearchParams({from, to});
        const res = await secureFetch(`${API_BASE}/batches/export?${params}`);
        if (!res || !res.ok) throw new Error('Échec chargement des batchs');

        const data = await res.json();
        allBatches = Array.isArray(data) ? data : (data.items || data.content || []);

        populateFilterDropdowns();
        applyFilters(false);
    } catch (err) {
        console.error('Erreur chargement batchs:', err);
        showSnackbar('Erreur lors du chargement des lots', 'error');
    }
}

function populateFilterDropdowns() {
    // Inputter
    const inputters = [...new Set(allBatches.map(b => b.uploadedBy).filter(Boolean))].sort();
    document.getElementById('inputterFilter').innerHTML =
        '<option value="">Tous les initiateurs</option>' +
        inputters.map(i => `<option value="${i}">${i}</option>`).join('');

    // Validator
    const validators = [...new Set(allBatches.map(b => b.validatedBy).filter(Boolean))].sort();
    document.getElementById('validatorFilter').innerHTML =
        '<option value="">Tous les validateurs</option>' +
        validators.map(v => `<option value="${v}">${v}</option>`).join('');
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function applyFilters(notify = true) {
    const f = {
        country: document.getElementById('countryFilter').value,
        department: document.getElementById('departmentFilter').value,  // ✅ FIX 3: works now
        status: document.getElementById('statusFilter').value,
        inputter: document.getElementById('inputterFilter').value,
        validator: document.getElementById('validatorFilter').value,
    };

    filteredBatches = allBatches.filter(b => {
        if (f.country && b.country !== f.country) return false;
        if (f.department && b.department !== f.department) return false;
        if (f.status && b.status !== f.status) return false;
        if (f.inputter && b.uploadedBy !== f.inputter) return false;
        if (f.validator && b.validatedBy !== f.validator) return false;
        return true;
    });

    updateActiveFilters(f);
    currentPage = 1;
    updateSummaryKpis();
    renderBatchTable();
    if (notify) showSnackbar('Filtres appliqués', 'success');
}

function updateActiveFilters(f) {
    const container = document.getElementById('activeFilters');
    const active = [];
    if (f.country) active.push({label: 'Pays', value: getCountryName(f.country), key: 'country'});
    if (f.department) active.push({label: 'Département', value: f.department, key: 'department'});
    if (f.status) active.push({label: 'Statut', value: f.status, key: 'status'});
    if (f.inputter) active.push({label: 'Initiateur', value: f.inputter, key: 'inputter'});
    if (f.validator) active.push({label: 'Validateur', value: f.validator, key: 'validator'});

    if (!active.length) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = active.map(a => `
        <span class="filter-badge">
            <span class="text-xs">${a.label}: ${a.value}</span>
            <button onclick="clearFilter('${a.key}')" class="ml-1 hover:text-red-600">
                <i data-lucide="x" class="w-3 h-3"></i>
            </button>
        </span>`).join('');
    if (typeof lucide !== 'undefined') createIcons(container);
}

function clearFilter(key) {
    const map = {
        country: 'countryFilter', department: 'departmentFilter',
        status: 'statusFilter', inputter: 'inputterFilter', validator: 'validatorFilter'
    };
    document.getElementById(map[key]).value = '';
    applyFilters();
}

// ── KPIs ──────────────────────────────────────────────────────────────────────

function updateSummaryKpis() {
    const total = filteredBatches.length;
    const processed = filteredBatches.filter(b => b.status === 'PROCESSED').length;
    const partial = filteredBatches.filter(b => b.status === 'PROCESSED_WITH_ERROR').length;
    const failed = filteredBatches.filter(b => b.status === 'PROCESSED_FAILED').length;
    // Everything not yet in a terminal processed/failed state → "en attente/traitement".
    const processing = filteredBatches.filter(b => b.status === 'PROCESSING').length;
    const pending = total - processed - partial - failed - processing;
    const totalRecs = filteredBatches.reduce((s, b) => s + (b.totalRecords || 0), 0);
    const totalFailed = filteredBatches.reduce((s, b) => s + (b.failureCount || 0), 0);

    // Proportional spine — same component as the dashboard, but driven by real
    // proportions so each segment's width reflects its share of the total.
    // "processed" groups full + partial successes (matching the dashboard buckets).
    const setFlex = (id, n) => {
        const el = document.getElementById(id);
        if (el) el.style.flex = String(n);
    };
    setFlex('rspine-pending', Math.max(pending, 0));
    setFlex('rspine-processing', processing);
    setFlex('rspine-processed', processed + partial);
    setFlex('rspine-errors', failed);

    const setNum = (id, n) => {
        const el = document.getElementById(id);
        if (el) el.textContent = n.toLocaleString('fr-FR');
    };
    setNum('rdetail-processed', processed);
    setNum('rdetail-partial', partial);
    setNum('rdetail-errors', failed);
    setNum('rdetail-total', total);
    setNum('rdetail-records', totalRecs);
    setNum('rdetail-failedrows', totalFailed);
}

// ── Table rendering ───────────────────────────────────────────────────────────

function renderBatchTable() {
    const tbody = document.getElementById('batchTableBody');
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const page = filteredBatches.slice(start, start + ITEMS_PER_PAGE);

    if (!page.length) {
        tbody.innerHTML = emptyStateRow(14, 'Aucun lot trouvé', {icon: 'inbox'});
        if (typeof createIcons === 'function') createIcons(tbody);
        updatePaginationControls();
        if (typeof lucide !== 'undefined') createIcons(tbody);
        return;
    }

    // Cell padding, borders and alignment come from .data-table / .tcol-center.
    const countChip = (n, tone) => n > 0
        ? `<span class="badge badge-${tone}">${n.toLocaleString()}</span>`
        : '<span style="color:var(--ink-4);">0</span>';

    tbody.innerHTML = page.map(b => `
        <tr class="table-row">
            <td><span class="mono" style="font-size:var(--text-xs);font-weight:700;color:var(--ink);">${b.batchId || '—'}</span></td>
            <td>${b.application || '—'}</td>
            <td class="tcol-center">${getStatusBadge(b.status)}</td>
            <td>
                <div class="flex items-center gap-2">
                    <span class="cell-initial" style="background:var(--status-processing-bg);color:var(--orange);">${(b.uploadedBy || 'S')[0].toUpperCase()}</span>
                    <span style="font-size:var(--text-sm);color:var(--ink);">${b.uploadedBy || '—'}</span>
                </div>
            </td>
            <td>
                ${b.validatedBy
        ? `<div class="flex items-center gap-2">
                           <span class="cell-initial" style="background:var(--status-success-bg);color:var(--status-success-text);">${b.validatedBy[0].toUpperCase()}</span>
                           <span style="font-size:var(--text-sm);color:var(--ink);">${b.validatedBy}</span>
                       </div>`
        : '<span style="color:var(--ink-4);font-size:var(--text-sm);">—</span>'}
            </td>
            <td class="tcol-center">
                ${b.country
        ? `<div class="flex items-center justify-center gap-1">${getCountryFlag(b.country)}<span style="font-size:var(--text-xs);">${b.country}</span></div>`
        : '—'}
            </td>
            <td class="tcol-center"><span class="badge badge-pending">${b.department || '—'}</span></td>
            <td class="tcol-center" style="font-weight:700;color:var(--ink);">${(b.totalRecords || 0).toLocaleString()}</td>
            <td class="tcol-center">${countChip(b.successCount, 'success')}</td>
            <td class="tcol-center">${countChip(b.failureCount, 'error')}</td>
            <td class="tcol-center">${countChip(b.errorCount, 'error')}</td>
            <td class="tcol-center" style="font-size:var(--text-xs);color:var(--ink-2);">${b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : '—'}</td>
            <td class="tcol-center" style="font-size:var(--text-xs);color:var(--ink-2);">${b.validatedAt ? new Date(b.validatedAt).toLocaleString('fr-FR') : '—'}</td>
            <td class="tcol-center">
                <button type="button" class="btn-flux"
                    style="padding:var(--sp-1) var(--sp-2);font-size:var(--text-xs);"
                    onclick="downloadOriginalFile('${b.batchId}', '${(b.originalFilename || '').replace(/'/g, "\\'")}')">
                    <i data-lucide="download"></i>CSV
                </button>
            </td>
        </tr>`).join('');

    updatePaginationControls();
    if (typeof lucide !== 'undefined') createIcons(tbody);
}

function updatePaginationControls() {
    const total = Math.ceil(filteredBatches.length / ITEMS_PER_PAGE) || 1;
    renderPagination('reportsPagination', {
        page: currentPage,
        totalPages: total,
        totalItems: filteredBatches.length,
        itemLabel: 'lots',
        pageSize: ITEMS_PER_PAGE,
        onGo: 'reportsGoToPage'
    });
}

window.reportsGoToPage = (page) => {
    const total = Math.ceil(filteredBatches.length / ITEMS_PER_PAGE) || 1;
    if (page < 1 || page > total) return;
    currentPage = page;
    renderBatchTable();
    window.scrollTo({top: 0, behavior: 'smooth'});
};

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        renderBatchTable();
        window.scrollTo({top: 0, behavior: 'smooth'});
    }
}
function nextPage() {
    if (currentPage < Math.ceil(filteredBatches.length / ITEMS_PER_PAGE)) {
        currentPage++;
        renderBatchTable();
        window.scrollTo({top: 0, behavior: 'smooth'});
    }
}

// ── Search ────────────────────────────────────────────────────────────────────

// ✅ FIX 6: search now runs against ALL filtered data, not just the current page's DOM rows.
function searchInTable() {
    const term = document.getElementById('searchTable').value.toLowerCase().trim();
    if (!term) {
        filteredBatches = applyCurrentFiltersToAll();
    } else {
        const base = applyCurrentFiltersToAll();
        filteredBatches = base.filter(b =>
            [b.batchId, b.application, b.uploadedBy, b.validatedBy, b.country, b.department, b.status, b.originalFilename]
                .some(v => v && String(v).toLowerCase().includes(term))
        );
    }
    currentPage = 1;
    updateSummaryKpis();
    renderBatchTable();
}

function applyCurrentFiltersToAll() {
    const f = {
        country: document.getElementById('countryFilter').value,
        department: document.getElementById('departmentFilter').value,
        status: document.getElementById('statusFilter').value,
        inputter: document.getElementById('inputterFilter').value,
        validator: document.getElementById('validatorFilter').value,
    };
    return allBatches.filter(b => {
        if (f.country && b.country !== f.country) return false;
        if (f.department && b.department !== f.department) return false;
        if (f.status && b.status !== f.status) return false;
        if (f.inputter && b.uploadedBy !== f.inputter) return false;
        if (f.validator && b.validatedBy !== f.validator) return false;
        return true;
    });
}

// ── Exports ───────────────────────────────────────────────────────────────────

// ✅ FIX 4: CSV now includes successCount and failureCount
function exportTableToCSV() {
    const headers = [
        'Batch ID', 'Application', 'Statut', 'Initiateur', 'Validateur',
        'Pays', 'Département', 'Records', 'Réussies', 'Échouées', 'Erreurs validation',
        'Date Upload', 'Date Validation'
    ];
    const dash = '—';
    const rows = filteredBatches.map(b => [
        b.batchId || dash,
        b.application || dash,
        statusLabel(b.status),
        b.uploadedBy || dash,
        b.validatedBy || dash,
        b.country || dash,
        b.department || dash,
        b.totalRecords || 0,
        b.successCount || 0,
        b.failureCount || 0,
        b.errorCount || 0,
        b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : dash,
        b.validatedAt ? new Date(b.validatedAt).toLocaleString('fr-FR') : dash
    ]);

    const csv = [headers, ...rows].map(r =>
        r.map(c => {
            const s = String(c);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
    ).join('\r\n');

    const link = document.createElement('a');
    // Prepend UTF-8 BOM so Excel reads the accented French headers correctly.
    link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8;'}));
    link.download = `rapport_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showSnackbar('Export CSV réussi !', 'success');
}

// ✅ FIX 5: PDF now includes successCount and failureCount columns
function exportToPDF() {
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    const W = doc.internal.pageSize.width, H = doc.internal.pageSize.height;

    // House palette as RGB (mirrors flux-tokens.css)
    const ORANGE = [255, 121, 0], INK = [27, 27, 27], INK3 = [118, 118, 118],
        CHROME = [10, 10, 10], CANVAS = [246, 246, 246], LINE = [232, 232, 232];

    // ── Title band: dark chrome with the 3px orange accent, like the app header ──
    doc.setFillColor(...CHROME);
    doc.rect(0, 0, W, 20, 'F');
    doc.setFillColor(...ORANGE);
    doc.rect(0, 0, W, 1.1, 'F'); // signature accent stripe (≈3px)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text('RAPPORT DÉTAILLÉ DES LOTS', 14, 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(154, 163, 175); // --chrome-text
    doc.text('Orange Bank', W - 14 - doc.getTextWidth('Orange Bank'), 13);

    // ── Meta line ──
    doc.setTextColor(...INK3);
    doc.setFontSize(9);
    const from = document.getElementById('startDate').value;
    const to = document.getElementById('endDate').value;
    const periode = (from || to) ? `Période : ${from || '…'} au ${to || '…'}` : 'Période : toutes dates';
    doc.text(periode, 14, 28);

    const activeF = [];
    if (document.getElementById('countryFilter').value) activeF.push(`Pays: ${document.getElementById('countryFilter').value}`);
    if (document.getElementById('departmentFilter').value) activeF.push(`Département: ${document.getElementById('departmentFilter').value}`);
    if (document.getElementById('statusFilter').value) activeF.push(`Statut: ${statusLabel(document.getElementById('statusFilter').value)}`);
    if (activeF.length) doc.text(`Filtres : ${activeF.join('  |  ')}`, 14, 33);

    const yStats = activeF.length ? 39 : 34;
    const processed = filteredBatches.filter(b => b.status === 'PROCESSED').length;
    const totalRecs = filteredBatches.reduce((s, b) => s + (b.totalRecords || 0), 0);
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Total : ${filteredBatches.length}     Traités OK : ${processed}     Total lignes : ${totalRecs.toLocaleString('fr-FR')}`, 14, yStats);
    doc.setFont('helvetica', 'normal');

    doc.autoTable({
        head: [['Lot ID', 'Application', 'Statut', 'Initiateur', 'Validateur', 'Pays', 'Dépt', 'Records', 'OK', 'KO', 'Err.', 'Import', 'Validation']],
        body: filteredBatches.map(b => [
            (b.batchId || '—').substring(0, 18),
            (b.application || '—').substring(0, 14),
            statusLabel(b.status),
            (b.uploadedBy || '—').substring(0, 12),
            (b.validatedBy || '—').substring(0, 12),
            b.country || '—',
            b.department || '—',
            (b.totalRecords || 0).toLocaleString('fr-FR'),
            (b.successCount || 0).toString(),
            (b.failureCount || 0).toString(),
            (b.errorCount || 0).toString(),
            b.uploadedAt ? new Date(b.uploadedAt).toLocaleDateString('fr-FR') : '—',
            b.validatedAt ? new Date(b.validatedAt).toLocaleDateString('fr-FR') : '—'
        ]),
        startY: yStats + 5,
        margin: {left: 14, right: 14},
        theme: 'grid',
        styles: {fontSize: 7, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: 0.1, overflow: 'linebreak'},
        // Header: ink on canvas with an orange top rule — not orange-on-orange.
        headStyles: {
            fillColor: CANVAS,
            textColor: INK,
            fontStyle: 'bold',
            halign: 'center',
            lineColor: LINE,
            lineWidth: 0.1
        },
        // Alignment only — let autoTable size columns to the page so long
        // French labels (e.g. "Traité avec erreurs") never clip or overflow.
        columnStyles: {
            0: {fontStyle: 'bold'},
            5: {halign: 'center'}, 6: {halign: 'center'},
            7: {halign: 'right'}, 8: {halign: 'right'},
            9: {halign: 'right'}, 10: {halign: 'right'},
            11: {halign: 'center'}, 12: {halign: 'center'}
        },
        alternateRowStyles: {fillColor: [250, 250, 250]},
        // Orange accent rule directly under the header row.
        didDrawCell: (data) => {
            if (data.section === 'head' && data.column.index === 0 && data.row.index === 0) {
                doc.setFillColor(...ORANGE);
                doc.rect(data.cursor.x, data.cell.y + data.cell.height - 0.4, W - 28, 0.4, 'F');
            }
        }
    });

    // ── Footer on every page ──
    const pages = doc.internal.getNumberOfPages();
    const gen = `Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`;
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.1);
        doc.line(14, H - 11, W - 14, H - 11);
        doc.setFontSize(7);
        doc.setTextColor(...INK3);
        doc.text('Orange Bank — Rapport confidentiel', 14, H - 7);
        const pgTxt = `Page ${i} / ${pages}`;
        doc.text(pgTxt, (W - doc.getTextWidth(pgTxt)) / 2, H - 7);
        doc.text(gen, W - 14 - doc.getTextWidth(gen), H - 7);
    }

    doc.save(`rapport_${from || 'tout'}_${to || 'tout'}.pdf`);
    showSnackbar('Export PDF réussi !', 'success');
}

// ── Misc ──────────────────────────────────────────────────────────────────────

function refreshAllReports() {
    showSnackbar('Actualisation...', 'info');
    loadBatchData();
}

async function downloadOriginalFile(batchId, originalFilename) {
    try {
        showSnackbar('Téléchargement en cours...', 'info');
        const res = await secureFetch(`${API_BASE}/batches/${batchId}/download`);
        if (!res || !res.ok) {
            const err = await res.json().catch(() => ({}));
            showSnackbar(err.message || 'Fichier non disponible', 'error');
            return;
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = originalFilename || `batch_${batchId}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        showSnackbar('Fichier téléchargé', 'success');
    } catch (e) {
        console.error('Erreur téléchargement:', e);
        showSnackbar('Erreur lors du téléchargement', 'error');
    }
}

// ── Globals ───────────────────────────────────────────────────────────────────
window.applyFilters = applyFilters;
window.clearFilter = clearFilter;
window.refreshAllReports = refreshAllReports;
window.previousPage = previousPage;
window.nextPage = nextPage;
window.searchInTable = searchInTable;
window.exportTableToCSV = exportTableToCSV;
window.exportToPDF = exportToPDF;
window.downloadOriginalFile = downloadOriginalFile;
