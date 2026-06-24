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
        showSnackbar('Erreur lors du chargement des batchs', 'error');
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
    const totalRecs = filteredBatches.reduce((s, b) => s + (b.totalRecords || 0), 0);
    const totalFailed = filteredBatches.reduce((s, b) => s + (b.failureCount || 0), 0);

    const c = document.getElementById('reportKpis');
    if (!c) return;
    c.innerHTML = [
        {label: 'Total batchs', value: total, color: 'text-gray-900', bg: 'bg-gray-50'},
        {label: 'Traités OK', value: processed, color: 'text-green-700', bg: 'bg-green-50'},
        {label: 'Partiels', value: partial, color: 'text-orange-600', bg: 'bg-orange-50'},
        {label: 'Échecs', value: failed, color: 'text-red-600', bg: 'bg-red-50'},
        {label: 'Total enregistrements', value: totalRecs, color: 'text-blue-700', bg: 'bg-blue-50'},
        {label: 'Lignes échouées', value: totalFailed, color: 'text-red-600', bg: 'bg-red-50'},
    ].map(k => `
        <div class="${k.bg} rounded-lg border border-gray-100 p-3 text-center hover:shadow-sm transition-all">
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">${k.label}</p>
            <p class="text-xl font-black ${k.color}">${k.value.toLocaleString()}</p>
        </div>`).join('');
}

// ── Table rendering ───────────────────────────────────────────────────────────

function renderBatchTable() {
    const tbody = document.getElementById('batchTableBody');
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const page = filteredBatches.slice(start, start + ITEMS_PER_PAGE);

    if (!page.length) {
        tbody.innerHTML = `<tr><td colspan="14" class="px-4 py-12 text-center text-gray-500">
            <div class="flex flex-col items-center gap-3">
                <i data-lucide="inbox" class="w-12 h-12 text-gray-300"></i>
                <span>Aucun batch trouvé</span>
            </div></td></tr>`;
        updatePaginationControls();
        if (typeof lucide !== 'undefined') createIcons(tbody);
        return;
    }

    tbody.innerHTML = page.map(b => `
        <tr class="table-row">
            <td class="px-4 py-3"><span class="font-mono text-xs font-semibold text-gray-900">${b.batchId || '-'}</span></td>
            <td class="px-4 py-3">${b.application || '-'}</td>
            <td class="px-4 py-3 text-center">${getStatusBadge(b.status)}</td>
            <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-full bg-orange-50 flex items-center justify-center text-orange-600 font-bold text-xs">
                        ${(b.uploadedBy || 'S')[0].toUpperCase()}
                    </div>
                    <span class="text-sm font-medium text-gray-900">${b.uploadedBy || '—'}</span>
                </div>
            </td>
            <td class="px-4 py-3">
                ${b.validatedBy
        ? `<div class="flex items-center gap-2">
                           <div class="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">${b.validatedBy[0].toUpperCase()}</div>
                           <span class="text-sm font-medium text-gray-900">${b.validatedBy}</span>
                       </div>`
        : '<span class="text-gray-400 text-sm">—</span>'}
            </td>
            <td class="px-4 py-3 text-center">
                ${b.country
        ? `<div class="flex items-center justify-center gap-1">${getCountryFlag(b.country)}<span class="text-xs font-medium">${b.country}</span></div>`
        : '-'}
            </td>
            <td class="px-4 py-3 text-center">
                <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-700">${b.department || '-'}</span>
            </td>
            <td class="px-4 py-3 text-center font-semibold text-gray-900">${(b.totalRecords || 0).toLocaleString()}</td>
            <td class="px-4 py-3 text-center">
                ${b.successCount > 0
        ? `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">${b.successCount.toLocaleString()}</span>`
        : '<span class="text-gray-400">0</span>'}
            </td>
            <td class="px-4 py-3 text-center">
                ${b.failureCount > 0
        ? `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">${b.failureCount.toLocaleString()}</span>`
        : '<span class="text-gray-400">0</span>'}
            </td>
            <td class="px-4 py-3 text-center">
                ${b.errorCount > 0
        ? `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">${b.errorCount}</span>`
        : '<span class="text-gray-400">0</span>'}
            </td>
            <td class="px-4 py-3 text-center text-xs text-gray-600">${b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : '-'}</td>
            <td class="px-4 py-3 text-center text-xs text-gray-600">${b.validatedAt ? new Date(b.validatedAt).toLocaleString('fr-FR') : '-'}</td>
            <td class="px-4 py-3 text-center">
                <button type="button"
                    class="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-gray-700 border border-gray-300 hover:border-orange-500 hover:text-orange-600 transition-colors"
                    onclick="downloadOriginalFile('${b.batchId}', '${(b.originalFilename || '').replace(/'/g, "\\'")}')">
                    <i data-lucide="download" class="w-3.5 h-3.5"></i>CSV
                </button>
            </td>
        </tr>`).join('');

    updatePaginationControls();
    if (typeof lucide !== 'undefined') createIcons(tbody);
}

function updatePaginationControls() {
    const total = Math.ceil(filteredBatches.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, filteredBatches.length);
    document.getElementById('showingFrom').textContent = filteredBatches.length > 0 ? start + 1 : 0;
    document.getElementById('showingTo').textContent = end;
    document.getElementById('totalItems').textContent = filteredBatches.length;
    document.getElementById('currentPage').textContent = currentPage;
    document.getElementById('totalPages').textContent = total || 1;
    document.getElementById('prevPageBtn').disabled = currentPage === 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= total;
}

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
    const rows = filteredBatches.map(b => [
        b.batchId || '',
        b.application || '',
        b.status || '',
        b.uploadedBy || '',
        b.validatedBy || '',
        b.country || '',
        b.department || '',
        b.totalRecords || 0,
        b.successCount || 0,
        b.failureCount || 0,
        b.errorCount || 0,
        b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : '',
        b.validatedAt ? new Date(b.validatedAt).toLocaleString('fr-FR') : ''
    ]);

    const csv = [headers, ...rows].map(r =>
        r.map(c => {
            const s = String(c);
            return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
    ).join('\n');

    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8;'}));
    link.download = `rapport_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showSnackbar('Export CSV réussi !', 'success');
}

// ✅ FIX 5: PDF now includes successCount and failureCount columns
function exportToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');

    doc.setFontSize(18);
    doc.setTextColor(255, 121, 0);
    doc.text('RAPPORT DÉTAILLÉ DES BATCHS', 14, 18);

    doc.setFontSize(9);
    doc.setTextColor(80);
    const from = document.getElementById('startDate').value;
    const to = document.getElementById('endDate').value;
    doc.text(`Période : ${from} au ${to}`, 14, 25);

    const activeF = [];
    if (document.getElementById('countryFilter').value) activeF.push(`Pays: ${document.getElementById('countryFilter').value}`);
    if (document.getElementById('departmentFilter').value) activeF.push(`Département: ${document.getElementById('departmentFilter').value}`);
    if (document.getElementById('statusFilter').value) activeF.push(`Statut: ${document.getElementById('statusFilter').value}`);
    if (activeF.length) doc.text(`Filtres : ${activeF.join(' | ')}`, 14, 30);

    const yStats = activeF.length ? 36 : 31;
    const processed = filteredBatches.filter(b => b.status === 'PROCESSED').length;
    const totalRecs = filteredBatches.reduce((s, b) => s + (b.totalRecords || 0), 0);
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.text(`Total : ${filteredBatches.length}  |  Traités OK : ${processed}  |  Total lignes : ${totalRecs.toLocaleString()}`, 14, yStats);

    doc.setDrawColor(255, 121, 0);
    doc.setLineWidth(0.4);
    doc.line(14, yStats + 3, 283, yStats + 3);

    doc.autoTable({
        head: [['Batch ID', 'Application', 'Statut', 'Initiateur', 'Validateur', 'Pays', 'Dept', 'Records', 'OK', 'KO', 'Err.', 'Upload', 'Validation']],
        body: filteredBatches.map(b => [
            (b.batchId || '-').substring(0, 18),
            (b.application || '-').substring(0, 14),
            b.status || '-',
            (b.uploadedBy || '—').substring(0, 12),
            (b.validatedBy || '-').substring(0, 12),
            b.country || '-',
            b.department || '-',
            (b.totalRecords || 0).toString(),
            (b.successCount || 0).toString(),
            (b.failureCount || 0).toString(),
            (b.errorCount || 0).toString(),
            b.uploadedAt ? new Date(b.uploadedAt).toLocaleDateString('fr-FR') : '-',
            b.validatedAt ? new Date(b.validatedAt).toLocaleDateString('fr-FR') : '-'
        ]),
        startY: yStats + 6,
        styles: {fontSize: 7, cellPadding: 1.5},
        headStyles: {fillColor: [255, 121, 0], textColor: 255, fontStyle: 'bold', halign: 'center'},
        columnStyles: {
            0: {cellWidth: 22, fontSize: 6},
            1: {cellWidth: 18},
            2: {cellWidth: 22, halign: 'center'},
            3: {cellWidth: 17}, 4: {cellWidth: 17},
            5: {cellWidth: 10, halign: 'center'},
            6: {cellWidth: 12, halign: 'center'},
            7: {cellWidth: 14, halign: 'right'},
            8: {cellWidth: 10, halign: 'right'},
            9: {cellWidth: 10, halign: 'right'},
            10: {cellWidth: 10, halign: 'center'},
            11: {cellWidth: 18, fontSize: 6},
            12: {cellWidth: 18, fontSize: 6}
        },
        alternateRowStyles: {fillColor: [248, 248, 248]},
        didDrawPage: data => {
            const pg = doc.internal.getCurrentPageInfo().pageNumber;
            doc.setFontSize(7);
            doc.setTextColor(140);
            doc.text(`Page ${pg}`, 14, doc.internal.pageSize.height - 8);
        }
    });

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text('Orange Bank — Rapport Confidentiel', 14, doc.internal.pageSize.height - 8);
        const gen = `Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`;
        doc.text(gen, doc.internal.pageSize.width - 14 - doc.getTextWidth(gen), doc.internal.pageSize.height - 8);
        const pgTxt = `Page ${i} / ${pages}`;
        doc.text(pgTxt, (doc.internal.pageSize.width - doc.getTextWidth(pgTxt)) / 2, doc.internal.pageSize.height - 8);
    }

    doc.save(`rapport_${from}_${to}.pdf`);
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
