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
    c.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:10px';
    c.innerHTML = [
        {label: 'Total batchs', value: total, color: '#1e293b', bg: '#f8fafc', border: 'rgba(71,85,105,.2)'},
        {label: 'Traités OK', value: processed, color: '#166534', bg: '#f0fdf4', border: 'rgba(22,101,52,.2)'},
        {label: 'Partiels', value: partial, color: '#92400e', bg: '#fffbeb', border: 'rgba(146,64,14,.2)'},
        {label: 'Échecs', value: failed, color: '#991b1b', bg: '#fef2f2', border: 'rgba(153,27,27,.2)'},
        {
            label: 'Total enregistrements',
            value: totalRecs,
            color: '#1d4ed8',
            bg: '#eff6ff',
            border: 'rgba(29,78,216,.2)'
        },
        {label: 'Lignes échouées', value: totalFailed, color: '#991b1b', bg: '#fef2f2', border: 'rgba(153,27,27,.2)'},
    ].map(k => `
        <div style="background:${k.bg};border:0.5px solid ${k.border};padding:14px 16px;text-align:center">
            <p style="font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:6px">${k.label}</p>
            <p style="font-size:22px;font-weight:300;color:${k.color};line-height:1;font-variant-numeric:tabular-nums">${k.value.toLocaleString('fr-FR')}</p>
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

    const TD = 'padding:9px 14px;border-bottom:0.5px solid var(--line-soft,#f3f4f6);font-size:12px;color:var(--ink-2)';
    const TDc = TD + ';text-align:center';
    const TDr = TD + ';text-align:right;font-variant-numeric:tabular-nums';

    tbody.innerHTML = page.map(b => `
        <tr style="border-bottom:0.5px solid var(--line-soft,#f3f4f6)">
            <td style="${TD};font-family:monospace;font-size:11px;white-space:nowrap">${(b.batchId || '-').slice(-12)}</td>
            <td style="${TD}">${appBadgeHTML(b.application)}</td>
            <td style="${TD}">${getStatusBadge(b.status)}</td>
            <td style="${TD};font-weight:500">${b.uploadedBy || '—'}</td>
            <td style="${TD}">${b.validatedBy || '<span style="color:var(--ink-3)">—</span>'}</td>
            <td style="${TDc}">
                ${b.country
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px">${getCountryFlag(b.country)} ${b.country}</span>`
        : '<span style="color:var(--ink-3)">—</span>'}
            </td>
            <td style="${TDc};font-size:11px;color:var(--ink-3)">${b.department || '—'}</td>
            <td style="${TDr}">${(b.totalRecords || 0).toLocaleString('fr-FR')}</td>
            <td style="${TDr}">
                ${b.successCount > 0 ? propertyBadge(b.successCount.toLocaleString('fr-FR'), 'green') : '<span style="color:var(--ink-3)">0</span>'}
            </td>
            <td style="${TDr}">
                ${b.failureCount > 0 ? propertyBadge(b.failureCount.toLocaleString('fr-FR'), 'red') : '<span style="color:var(--ink-3)">0</span>'}
            </td>
            <td style="${TDr}">
                ${b.errorCount > 0 ? propertyBadge(b.errorCount, 'red') : '<span style="color:var(--ink-3)">0</span>'}
            </td>
            <td style="${TD};white-space:nowrap;font-size:11px">${b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : '—'}</td>
            <td style="${TD};white-space:nowrap;font-size:11px">${b.validatedAt ? new Date(b.validatedAt).toLocaleString('fr-FR') : '—'}</td>
            <td style="${TD};white-space:nowrap;width:1%">
                <button class="btn-flux btn-flux-sm"
                    onclick="downloadOriginalFile('${b.batchId}', '${(b.originalFilename || '').replace(/'/g, "\\'")}')">
                    <i data-lucide="download" style="width:12px;height:12px"></i>CSV
                </button>
            </td>
        </tr>`).join('');

    updatePaginationControls();
    if (typeof lucide !== 'undefined') createIcons(tbody);
}

function updatePaginationControls() {
    const el = document.getElementById('reportPagination');
    if (!el) return;
    const total = Math.ceil(filteredBatches.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, filteredBatches.length);

    if (total <= 1) {
        el.innerHTML = '';
        return;
    }

    const btn = (label, handler, disabled) =>
        `<button onclick="${handler}" ${disabled ? 'disabled' : ''}
                 style="padding:5px 14px;font-size:11px;border:0.5px solid var(--line,#e5e7eb);
                        background:${disabled ? 'var(--surface-2,#f8fafc)' : 'var(--surface,#fff)'};
                        color:${disabled ? 'var(--ink-3,#9ca3af)' : 'var(--ink-2,#374151)'};
                        cursor:${disabled ? 'default' : 'pointer'};">${label}</button>`;

    el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 16px;border-top:0.5px solid var(--line,#e5e7eb)">
            ${btn('← Précédent', 'previousPage()', currentPage === 1)}
            <span style="font-size:12px;color:var(--ink-3,#9ca3af)">
                Page ${currentPage} / ${total}
                &nbsp;·&nbsp; ${filteredBatches.length.toLocaleString('fr-FR')} résultat${filteredBatches.length !== 1 ? 's' : ''}
                &nbsp;·&nbsp; ${filteredBatches.length > 0 ? start + 1 : 0}–${end} affichés
            </span>
            ${btn('Suivant →', 'nextPage()', currentPage >= total)}
        </div>`;
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
    const from = document.getElementById('startDate').value;
    const to = document.getElementById('endDate').value;
    const now = new Date().toLocaleString('fr-FR');

    // ── Active filters ────────────────────────────────────────────────────────
    const country = document.getElementById('countryFilter')?.value || '';
    const department = document.getElementById('departmentFilter')?.value || '';
    const status = document.getElementById('statusFilter')?.value || '';
    const inputter = document.getElementById('inputterFilter')?.value || '';
    const validator = document.getElementById('validatorFilter')?.value || '';
    const activeFilters = [
        country && `Pays : ${country}`,
        department && `Département : ${department}`,
        status && `Statut : ${status}`,
        inputter && `Initiateur : ${inputter}`,
        validator && `Validateur : ${validator}`,
    ].filter(Boolean);

    // ── KPI computation ───────────────────────────────────────────────────────
    const total = filteredBatches.length;
    const processed = filteredBatches.filter(b => b.status === 'PROCESSED').length;
    const partial = filteredBatches.filter(b => b.status === 'PROCESSED_WITH_ERROR').length;
    const failed = filteredBatches.filter(b => b.status === 'PROCESSED_FAILED').length;
    const totalRecs = filteredBatches.reduce((s, b) => s + (b.totalRecords || 0), 0);
    const totalFailed = filteredBatches.reduce((s, b) => s + (b.failureCount || 0), 0);
    const rateOk = total > 0 ? Math.round(processed / total * 100) : 0;

    // ── Full data table (all rows, not just current page) ─────────────────────
    const dataRows = filteredBatches.map(b => {
        const uploadDt = b.uploadedAt ? new Date(b.uploadedAt).toLocaleString('fr-FR') : '—';
        const validateDt = b.validatedAt ? new Date(b.validatedAt).toLocaleString('fr-FR') : '—';
        const statusCell = {
            PROCESSED: '<td class="td-ok">Traité OK</td>',
            PROCESSED_WITH_ERROR: '<td class="td-partial">Partiel</td>',
            PROCESSED_FAILED: '<td class="td-err">Échec</td>',
            PROCESSING: '<td class="td-proc">En cours</td>',
            VALIDATED: '<td class="td-val">Validé</td>',
            UPLOADED: '<td class="td-upl">Importé</td>',
        }[b.status] || `<td>${b.status || '—'}</td>`;

        return `<tr>
            <td class="mono">${(b.batchId || '—').slice(-12)}</td>
            <td>${escXml(b.application || '—')}</td>
            ${statusCell}
            <td>${escXml(b.uploadedBy || '—')}</td>
            <td>${escXml(b.validatedBy || '—')}</td>
            <td class="td-center">${escXml(b.country || '—')}</td>
            <td class="td-center">${escXml(b.department || '—')}</td>
            <td class="td-right">${(b.totalRecords || 0).toLocaleString('fr-FR')}</td>
            <td class="td-right ok">${(b.successCount || 0).toLocaleString('fr-FR')}</td>
            <td class="td-right err">${(b.failureCount || 0).toLocaleString('fr-FR')}</td>
            <td class="td-center small">${uploadDt}</td>
            <td class="td-center small">${validateDt}</td>
        </tr>`;
    }).join('');

    const filterBadges = activeFilters.length
        ? `<div class="filter-row">${activeFilters.map(f =>
            `<span class="badge">${escXml(f)}</span>`).join('')}</div>`
        : '';

    // ── Build printable HTML ──────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport — ${escXml(from)} au ${escXml(to)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; font-size: 10.5pt;
       color: #1e293b; background: #fff; }

.no-print { display: flex; gap: 10px; padding: 12px 24px;
            background: #f1f5f9; border-bottom: 1px solid #e2e8f0; align-items: center; }
.btn-print { padding: 8px 20px; background: #1a73e8; color: #fff; border: none;
             font-size: 13px; font-weight: 500; cursor: pointer; }
.btn-close { padding: 8px 20px; background: #fff; color: #64748b;
             border: 1px solid #cbd5e1; font-size: 13px; cursor: pointer; }
@media print { .no-print { display: none; } }

.page { max-width: 100%; padding: 24px 30px; }

.report-header { background: #0f172a; color: #fff; padding: 18px 26px; margin-bottom: 20px; }
.report-title  { font-size: 15pt; font-weight: 500; }
.report-sub    { font-size: 10pt; color: #94a3b8; margin-top: 4px; }

.period-row  { display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
               font-size: 11pt; }
.period-label { font-weight: 500; color: #475569; }
.period-value { color: #1e293b; }
.filter-row  { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.badge       { background: #f1f5f9; color: #475569; border: 0.5px solid #cbd5e1;
               padding: 3px 10px; font-size: 10pt; }

.kpi-grid { display: grid; grid-template-columns: repeat(6,1fr); gap: 10px; margin-bottom: 20px; }
.kpi-card { padding: 14px 12px; border: 0.5px solid #e2e8f0; text-align: center; }
.kpi-label{ font-size: 8pt; font-weight: 500; text-transform: uppercase;
            letter-spacing: .07em; color: #94a3b8; margin-bottom: 5px; }
.kpi-val  { font-size: 20pt; font-weight: 500; line-height: 1; }
.kpi-gray { background: #f8fafc; }
.kpi-gray .kpi-val  { color: #1e293b; }
.kpi-green{ background: #f0fdf4; border-color: #bbf7d0; }
.kpi-green .kpi-label { color: #166534; }
.kpi-green .kpi-val   { color: #15803d; }
.kpi-amber{ background: #fffbeb; border-color: #fde68a; }
.kpi-amber .kpi-label { color: #92400e; }
.kpi-amber .kpi-val   { color: #d97706; }
.kpi-red  { background: #fef2f2; border-color: #fecaca; }
.kpi-red  .kpi-label  { color: #991b1b; }
.kpi-red  .kpi-val    { color: #dc2626; }
.kpi-blue { background: #eff6ff; border-color: #bfdbfe; }
.kpi-blue .kpi-label  { color: #1e40af; }
.kpi-blue .kpi-val    { color: #2563eb; }

.section-title { font-size: 10pt; font-weight: 500; color: #475569;
                 text-transform: uppercase; letter-spacing: .07em;
                 padding-bottom: 8px; border-bottom: 1.5px solid #e2e8f0;
                 margin-bottom: 10px; }

table  { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
thead th { background: #e86e00; color: #fff; font-weight: 500; padding: 7px 8px;
           text-align: left; border: 0.5px solid #c45d00; white-space: nowrap; }
tbody td { padding: 5px 8px; border: 0.5px solid #e2e8f0; color: #1e293b; }
tbody tr:nth-child(even) td { background: #f8fafc; }
.mono      { font-family: monospace; font-size: 8pt; }
.td-center { text-align: center; }
.td-right  { text-align: right; font-variant-numeric: tabular-nums; }
.small     { font-size: 7.5pt; color: #64748b; }
.ok        { color: #166534; font-weight: 500; }
.err       { color: #dc2626; font-weight: 500; }
.td-ok     { color: #166534; font-weight: 500; }
.td-partial{ color: #d97706; font-weight: 500; }
.td-err    { color: #dc2626; font-weight: 500; }
.td-proc   { color: #2563eb; font-weight: 500; }
.td-val    { color: #7c3aed; font-weight: 500; }
.td-upl    { color: #64748b; }

.footer    { margin-top: 16px; font-size: 8pt; color: #94a3b8;
             border-top: 0.5px solid #e2e8f0; padding-top: 8px;
             display: flex; justify-content: space-between; }

@media print {
    @page { margin: 10mm 8mm; size: A4 landscape; }
    .page { padding: 0; }
    table { font-size: 7.5pt; }
    thead th { padding: 5px 6px; }
    tbody td { padding: 4px 6px; }
    .kpi-grid { grid-template-columns: repeat(6,1fr); }
    .kpi-val  { font-size: 16pt; }
}
</style>
</head>
<body>

<div class="no-print">
  <button class="btn-print" onclick="window.print()">Imprimer / Enregistrer en PDF</button>
  <button class="btn-close" onclick="window.close()">Fermer</button>
  <span style="font-size:12px;color:#94a3b8;margin-left:8px">${filteredBatches.length} lot(s) · impression paysage recommandée</span>
</div>

<div class="page">
  <div class="report-header">
    <div class="report-title">Rapport des lots — FLUX Orange Bank</div>
    <div class="report-sub">Exporté le ${now}</div>
  </div>

  <div class="period-row">
    <span class="period-label">Période :</span>
    <span class="period-value">${escXml(from)} → ${escXml(to)}</span>
  </div>
  ${filterBadges}

  <div class="kpi-grid">
    <div class="kpi-card kpi-gray">
      <div class="kpi-label">Total lots</div>
      <div class="kpi-val">${total.toLocaleString('fr-FR')}</div>
    </div>
    <div class="kpi-card kpi-green">
      <div class="kpi-label">Traités OK</div>
      <div class="kpi-val">${processed.toLocaleString('fr-FR')}</div>
    </div>
    <div class="kpi-card kpi-amber">
      <div class="kpi-label">Partiels</div>
      <div class="kpi-val">${partial.toLocaleString('fr-FR')}</div>
    </div>
    <div class="kpi-card kpi-red">
      <div class="kpi-label">Échecs</div>
      <div class="kpi-val">${failed.toLocaleString('fr-FR')}</div>
    </div>
    <div class="kpi-card kpi-blue">
      <div class="kpi-label">Total lignes</div>
      <div class="kpi-val">${totalRecs.toLocaleString('fr-FR')}</div>
    </div>
    <div class="kpi-card kpi-red">
      <div class="kpi-label">Lignes échouées</div>
      <div class="kpi-val">${totalFailed.toLocaleString('fr-FR')}</div>
    </div>
  </div>

  <div class="section-title">Détail des lots (${filteredBatches.length} résultats)</div>

  <table>
    <thead>
      <tr>
        <th>ID lot</th>
        <th>Application</th>
        <th>Statut</th>
        <th>Initiateur</th>
        <th>Validateur</th>
        <th>Pays</th>
        <th>Dept</th>
        <th style="text-align:right">Total</th>
        <th style="text-align:right">Succès</th>
        <th style="text-align:right">Échecs</th>
        <th style="text-align:center">Date import</th>
        <th style="text-align:center">Date validation</th>
      </tr>
    </thead>
    <tbody>${dataRows}</tbody>
  </table>

  <div class="footer">
    <span>Orange Bank — Rapport confidentiel</span>
    <span>${now}</span>
    <span>Taux de succès : ${rateOk}%</span>
  </div>
</div>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) {
        showSnackbar("Autorisez les popups pour ce site afin d'exporter.", 'error');
        return;
    }
    win.document.write(html);
    win.document.close();
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
