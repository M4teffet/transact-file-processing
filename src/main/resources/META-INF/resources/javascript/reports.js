/**
 * reports.js - Enhanced version with detailed batch tracking and PDF export
 */

let allBatches = [];
let filteredBatches = [];
let currentPage = 1;
const itemsPerPage = 20;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeDates();
    loadInitialData();
});

function initializeDates() {
    const today = new Date('2026-02-15');
    const startDate = new Date('2026-02-01');

    document.getElementById('startDate').value = startDate.toISOString().split('T')[0];
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
}

async function loadInitialData() {
    try {
        // Load filter options
        await Promise.all([
            loadCountries(),
            loadDepartments(),
            loadBatchData()
        ]);
    } catch (error) {
        console.error('Error loading initial data:', error);
        showSnackbar('Erreur lors du chargement des données', 'error');
    }
}

async function loadCountries() {
    try {
        const res = await secureFetch(`${API_BASE}/country/list`);
        if (!res || !res.ok) return;
        const countries = await res.json();

        const select = document.getElementById('countryFilter');
        select.innerHTML = '<option value="">Tous les pays</option>' +
            countries.map(c => `<option value="${c.code}">${getCountryName(c.code)} (${c.code})</option>`).join('');
    } catch (error) {
        console.error('Error loading countries:', error);
    }
}

async function loadDepartments() {
    try {
        const res = await secureFetch(`${API_BASE}/departments/list`);
        if (!res || !res.ok) return;
        const departments = await res.json();

        const select = document.getElementById('departmentFilter');
        select.innerHTML = '<option value="">Tous les départements</option>' +
            departments.map(d => `<option value="${d.code}">${d.description} (${d.code})</option>`).join('');
    } catch (error) {
        console.error('Error loading departments:', error);
    }
}

async function loadBatchData() {
    try {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;

        const params = new URLSearchParams({
            startDate: startDate,
            endDate: endDate,
            size: 9999
        });

        const res = await secureFetch(`${API_BASE}/batches?${params.toString()}`);
        if (!res || !res.ok) throw new Error('Failed to fetch batches');

        const data = await res.json();

        // Filter to only show PROCESSED and PROCESSED_WITH_ERROR batches
        allBatches = (data.content || []).filter(batch =>
            batch.status === 'PROCESSED' || batch.status === 'PROCESSED_WITH_ERROR'
        );

        // Populate filter dropdowns with unique values
        populateFilterDropdowns();

        // Apply any active filters
        applyFilters();

    } catch (error) {
        console.error('Error loading batch data:', error);
        showSnackbar('Erreur lors du chargement des batchs', 'error');
    }
}

function populateFilterDropdowns() {
    // Populate Inputter filter
    const inputters = [...new Set(allBatches.map(b => b.uploadedBy).filter(Boolean))].sort();
    const inputterSelect = document.getElementById('inputterFilter');
    inputterSelect.innerHTML = '<option value="">Tous les inputters</option>' +
        inputters.map(i => `<option value="${i}">${i}</option>`).join('');

    // Populate Validator filter
    const validators = [...new Set(allBatches.map(b => b.validatedBy).filter(Boolean))].sort();
    const validatorSelect = document.getElementById('validatorFilter');
    validatorSelect.innerHTML = '<option value="">Tous les validateurs</option>' +
        validators.map(v => `<option value="${v}">${v}</option>`).join('');
}

function applyFilters() {
    const filters = {
        country: document.getElementById('countryFilter').value,
        department: document.getElementById('departmentFilter').value,
        status: document.getElementById('statusFilter').value,
        inputter: document.getElementById('inputterFilter').value,
        validator: document.getElementById('validatorFilter').value
    };

    filteredBatches = allBatches.filter(batch => {
        if (filters.country && batch.country !== filters.country) return false;
        if (filters.department && batch.department !== filters.department) return false;
        if (filters.status && batch.status !== filters.status) return false;
        if (filters.inputter && batch.uploadedBy !== filters.inputter) return false;
        if (filters.validator && batch.validatedBy !== filters.validator) return false;
        return true;
    });

    // Update active filters display
    updateActiveFilters(filters);

    // Reset to first page
    currentPage = 1;

    // Update display
    renderBatchTable();

    showSnackbar('Filtres appliqués', 'success', 2000);
}

function updateActiveFilters(filters) {
    const container = document.getElementById('activeFilters');
    const activeFilters = [];

    if (filters.country) activeFilters.push({ label: 'Pays', value: getCountryName(filters.country), key: 'country' });
    if (filters.department) activeFilters.push({ label: 'Département', value: filters.department, key: 'department' });
    if (filters.status) activeFilters.push({ label: 'Statut', value: filters.status, key: 'status' });
    if (filters.inputter) activeFilters.push({ label: 'Inputter', value: filters.inputter, key: 'inputter' });
    if (filters.validator) activeFilters.push({ label: 'Validateur', value: filters.validator, key: 'validator' });

    if (activeFilters.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = activeFilters.map(f => `
        <span class="filter-badge">
            <span class="text-xs">${f.label}: ${f.value}</span>
            <button onclick="clearFilter('${f.key}')" class="ml-1 hover:text-red-600">
                <i data-lucide="x" class="w-3 h-3"></i>
            </button>
        </span>
    `).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function clearFilter(key) {
    const filterMap = {
        'country': 'countryFilter',
        'department': 'departmentFilter',
        'status': 'statusFilter',
        'inputter': 'inputterFilter',
        'validator': 'validatorFilter'
    };

    document.getElementById(filterMap[key]).value = '';
    applyFilters();
}

function renderBatchTable() {
    const tbody = document.getElementById('batchTableBody');
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageBatches = filteredBatches.slice(startIndex, endIndex);

    if (pageBatches.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="px-4 py-12 text-center text-gray-500">
                    <div class="flex flex-col items-center gap-3">
                        <i data-lucide="inbox" class="w-12 h-12 text-gray-300"></i>
                        <span>Aucun batch trouvé avec les filtres actifs</span>
                    </div>
                </td>
            </tr>
        `;
        updatePaginationControls();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    tbody.innerHTML = pageBatches.map(batch => `
        <tr class="table-row">
            <td class="px-4 py-3">
                <span class="font-mono text-xs font-semibold text-gray-900">${batch.batchId || '-'}</span>
            </td>
            <td class="px-4 py-3">
                <span class="text-gray-900">${batch.application || '-'}</span>
            </td>
            <td class="px-4 py-3 text-center">
                ${getStatusBadge(batch.status)}
            </td>
            <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                    <div class="w-7 h-7 rounded-full bg-brand-light flex items-center justify-center text-brand-primary font-bold text-xs">
                        ${(batch.uploadedBy || 'U').charAt(0).toUpperCase()}
                    </div>
                    <span class="text-sm font-medium text-gray-900">${batch.uploadedBy || '-'}</span>
                </div>
            </td>
            <td class="px-4 py-3">
                ${batch.validatedBy ? `
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">
                            ${batch.validatedBy.charAt(0).toUpperCase()}
                        </div>
                        <span class="text-sm font-medium text-gray-900">${batch.validatedBy}</span>
                    </div>
                ` : '<span class="text-gray-400 text-sm">Non validé</span>'}
            </td>
            <td class="px-4 py-3 text-center">
                ${batch.country ? `
                    <div class="flex items-center justify-center gap-1">
                        ${getCountryFlag(batch.country)}
                        <span class="text-xs font-medium">${batch.country}</span>
                    </div>
                ` : '-'}
            </td>
            <td class="px-4 py-3 text-center">
                <span class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-gray-100 text-gray-700">
                    ${batch.department || '-'}
                </span>
            </td>
            <td class="px-4 py-3 text-center font-semibold text-gray-900">
                ${(batch.totalRecords || 0).toLocaleString()}
            </td>
            <td class="px-4 py-3 text-center">
                ${batch.errorCount > 0
                    ? `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">${batch.errorCount}</span>`
                    : `<span class="text-gray-400">0</span>`
                }
            </td>
            <td class="px-4 py-3 text-center text-xs text-gray-600">
                ${batch.uploadedAt ? new Date(batch.uploadedAt).toLocaleString('fr-FR') : '-'}
            </td>
            <td class="px-4 py-3 text-center text-xs text-gray-600">
                ${batch.validatedAt ? new Date(batch.validatedAt).toLocaleString('fr-FR') : '-'}
            </td>
        </tr>
    `).join('');

    updatePaginationControls();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updatePaginationControls() {
    const totalPages = Math.ceil(filteredBatches.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredBatches.length);

    document.getElementById('showingFrom').textContent = filteredBatches.length > 0 ? startIndex + 1 : 0;
    document.getElementById('showingTo').textContent = endIndex;
    document.getElementById('totalItems').textContent = filteredBatches.length;
    document.getElementById('currentPage').textContent = currentPage;
    document.getElementById('totalPages').textContent = totalPages || 1;

    document.getElementById('prevPageBtn').disabled = currentPage === 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        renderBatchTable();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function nextPage() {
    const totalPages = Math.ceil(filteredBatches.length / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        renderBatchTable();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function searchInTable() {
    const searchTerm = document.getElementById('searchTable').value.toLowerCase();
    const rows = document.querySelectorAll('#batchTableBody tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
}

function exportTableToCSV() {
    const headers = ['Batch ID', 'Application', 'Statut', 'Inputter', 'Validateur', 'Pays', 'Département', 'Records', 'Erreurs', 'Date Upload', 'Date Validation'];

    const rows = filteredBatches.map(batch => [
        batch.batchId || '',
        batch.application || '',
        batch.status || '',
        batch.uploadedBy || '',
        batch.validatedBy || '',
        batch.country || '',
        batch.department || '',
        batch.totalRecords || 0,
        batch.errorCount || 0,
        batch.uploadedAt ? new Date(batch.uploadedAt).toLocaleString('fr-FR') : '',
        batch.validatedAt ? new Date(batch.validatedAt).toLocaleString('fr-FR') : ''
    ]);

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => {
            const str = String(cell);
            return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `batches_report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();

    showSnackbar('Export CSV réussi !', 'success');
}

function exportToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');

    // Title and Header
    doc.setFontSize(20);
    doc.setTextColor(255, 121, 0);
    doc.text('RAPPORT DÉTAILLÉ DES BATCHS', 14, 20);

    // Date range and filters info
    doc.setFontSize(10);
    doc.setTextColor(100);
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    doc.text(`Période: ${startDate} au ${endDate}`, 14, 28);

    // Active filters
    const filters = [];
    const countryVal = document.getElementById('countryFilter').value;
    const deptVal = document.getElementById('departmentFilter').value;
    const statusVal = document.getElementById('statusFilter').value;
    const inputterVal = document.getElementById('inputterFilter').value;
    const validatorVal = document.getElementById('validatorFilter').value;

    if (countryVal) filters.push(`Pays: ${countryVal}`);
    if (deptVal) filters.push(`Département: ${deptVal}`);
    if (statusVal) filters.push(`Statut: ${statusVal}`);
    if (inputterVal) filters.push(`Inputter: ${inputterVal}`);
    if (validatorVal) filters.push(`Validateur: ${validatorVal}`);

    if (filters.length > 0) {
        doc.setFontSize(9);
        doc.setTextColor(80);
        doc.text(`Filtres appliqués: ${filters.join(' | ')}`, 14, 33);
    }

    // Summary statistics
    const processed = filteredBatches.filter(b => b.status === 'PROCESSED').length;
    const processedWithError = filteredBatches.filter(b => b.status === 'PROCESSED_WITH_ERROR').length;
    const totalRecords = filteredBatches.reduce((sum, b) => sum + (b.totalRecords || 0), 0);
    const totalErrors = filteredBatches.reduce((sum, b) => sum + (b.errorCount || 0), 0);

    doc.setFontSize(11);
    doc.setTextColor(0);
    const yPos = filters.length > 0 ? 40 : 35;
    doc.text(`Total Batchs: ${filteredBatches.length}  |  Succès: ${processed}  |  Avec Erreurs: ${processedWithError}  |  Total Records: ${totalRecords.toLocaleString()}  |  Total Erreurs: ${totalErrors}`, 14, yPos);

    // Draw a line separator
    doc.setDrawColor(255, 121, 0);
    doc.setLineWidth(0.5);
    doc.line(14, yPos + 3, 283, yPos + 3);

    // Main Table
    const tableData = filteredBatches.map(batch => [
        (batch.batchId || '-').substring(0, 20),
        (batch.application || '-').substring(0, 15),
        batch.status || '-',
        (batch.uploadedBy || '-').substring(0, 12),
        (batch.validatedBy || '-').substring(0, 12),
        batch.country || '-',
        batch.department || '-',
        (batch.totalRecords || 0).toString(),
        (batch.errorCount || 0).toString(),
        batch.uploadedAt ? new Date(batch.uploadedAt).toLocaleDateString('fr-FR') : '-',
        batch.validatedAt ? new Date(batch.validatedAt).toLocaleDateString('fr-FR') : '-'
    ]);

    doc.autoTable({
        head: [['Batch ID', 'Application', 'Statut', 'Inputter', 'Validateur', 'Pays', 'Dept', 'Records', 'Err.', 'Upload', 'Validation']],
        body: tableData,
        startY: yPos + 6,
        styles: {
            fontSize: 7,
            cellPadding: 1.5,
            overflow: 'linebreak'
        },
        headStyles: {
            fillColor: [255, 121, 0],
            textColor: 255,
            fontStyle: 'bold',
            halign: 'center'
        },
        columnStyles: {
            0: { cellWidth: 25, fontSize: 6 },  // Batch ID
            1: { cellWidth: 20 },                // Application
            2: { cellWidth: 25, halign: 'center' }, // Statut
            3: { cellWidth: 18 },                // Inputter
            4: { cellWidth: 18 },                // Validateur
            5: { cellWidth: 12, halign: 'center' }, // Pays
            6: { cellWidth: 15, halign: 'center' }, // Dept
            7: { cellWidth: 15, halign: 'right' },  // Records
            8: { cellWidth: 12, halign: 'center' }, // Err.
            9: { cellWidth: 20, fontSize: 6 },      // Upload
            10: { cellWidth: 20, fontSize: 6 }      // Validation
        },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        didDrawPage: function(data) {
            // Page number on each page
            doc.setFontSize(8);
            doc.setTextColor(120);
            doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, 14, doc.internal.pageSize.height - 10);
        }
    });

    // Footer on all pages
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);

        // Company name
        doc.text('Orange Bank - Rapport Confidentiel', 14, doc.internal.pageSize.height - 10);

        // Generation date
        const genDate = `Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`;
        doc.text(genDate, doc.internal.pageSize.width - 14 - doc.getTextWidth(genDate), doc.internal.pageSize.height - 10);

        // Page number
        const pageText = `Page ${i} / ${pageCount}`;
        const pageTextWidth = doc.getTextWidth(pageText);
        doc.text(pageText, (doc.internal.pageSize.width - pageTextWidth) / 2, doc.internal.pageSize.height - 10);
    }

    // Save the PDF
    const filename = `rapport_batches_${startDate}_${endDate}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
    showSnackbar('Export PDF réussi !', 'success');
}

function refreshAllReports() {
    showSnackbar('Actualisation en cours...', 'info');
    loadBatchData();
}

// Global functions
window.applyFilters = applyFilters;
window.clearFilter = clearFilter;
window.refreshAllReports = refreshAllReports;
window.previousPage = previousPage;
window.nextPage = nextPage;
window.searchInTable = searchInTable;
window.exportTableToCSV = exportTableToCSV;
window.exportToPDF = exportToPDF;
// closeModal is already defined in layout.html