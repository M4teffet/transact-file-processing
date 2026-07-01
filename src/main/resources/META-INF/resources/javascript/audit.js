/**
 * audit.js — Admin audit trail page
 *
 * Loads paginated AdminAuditLog entries from GET /api/v1/admin/audit,
 * renders them with unified badge system, supports filter + pagination.
 */

let _auditPage = 0;
let _auditTotal = 0;
let _auditPages = 1;
const AUDIT_SIZE = 25;

// ── Action colour mapping ─────────────────────────────────────────────────────
const _actionTone = (action = '') => {
    if (!action) return 'gray';
    const a = action.toUpperCase();
    if (a.includes('DELETE') || a.includes('LOCK')) return 'red';
    if (a.includes('CREATE') || a.includes('UNLOCK')) return 'green';
    if (a.includes('UPDATE') || a.includes('CHANGE') || a.includes('RESET') || a.includes('TOGGLE')) return 'amber';
    if (a.includes('VALID') || a.includes('LOGIN')) return 'blue';
    return 'gray';
};

// ── Load ─────────────────────────────────────────────────────────────────────
async function _fetchAudit() {
    const tbody = document.getElementById('auditTbody');
    tbody.innerHTML = `<tr><td colspan="5" style="padding:3rem;text-align:center;font-size:12px;color:#9ca3af">
        <i data-lucide="loader-2" style="width:16px;height:16px;animation:spin 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:6px"></i>Chargement…
    </td></tr>`;
    createIcons(tbody);

    const params = new URLSearchParams({
        page: _auditPage,
        size: AUDIT_SIZE,
    });

    const action = document.getElementById('auditActionFilter')?.value;
    const performedBy = document.getElementById('auditPerformedBy')?.value?.trim();
    const target = document.getElementById('auditTarget')?.value?.trim();
    const from = document.getElementById('auditFrom')?.value;
    const to = document.getElementById('auditTo')?.value;

    if (action) params.set('action', action);
    if (performedBy) params.set('performedBy', performedBy);
    if (target) params.set('target', target);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
        const res = await secureFetch(`${API_BASE}/admin/audit?${params}`);
        if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);

        const data = await res.json();
        _auditTotal = data.total ?? 0;
        _auditPages = data.totalPages ?? 1;
        const items = data.items ?? [];

        const count = document.getElementById('auditCount');
        if (count) count.textContent = `${_auditTotal.toLocaleString('fr-FR')} événement${_auditTotal !== 1 ? 's' : ''}`;

        if (!items.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding:3rem;text-align:center;font-size:12px;color:#9ca3af">Aucun événement trouvé</td></tr>`;
            _renderAuditPagination();
            return;
        }

        tbody.innerHTML = items.map(e => {
            const dt = e.timestamp ? new Date(e.timestamp) : null;
            const date = dt ? dt.toLocaleDateString('fr-FR') : '—';
            const time = dt ? dt.toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }) : '';
            const tone = _actionTone(e.action);
            const actionBadge = propertyBadge(e.action?.replace(/_/g, ' ') || '—', tone);

            return `<tr style="border-bottom:0.5px solid #f3f4f6">
                <td style="padding:10px 16px;white-space:nowrap">
                    <div style="font-size:12px;color:#374151">${date}</div>
                    <div style="font-size:10px;color:#9ca3af">${time}</div>
                </td>
                <td style="padding:10px 16px">${actionBadge}</td>
                <td style="padding:10px 16px;font-size:12px;color:#374151;font-weight:500">
                    ${_esc(e.performedBy || '—')}
                </td>
                <td style="padding:10px 16px;font-size:12px;color:#374151;font-family:monospace">
                    ${_esc(e.target || '—')}
                </td>
                <td style="padding:10px 16px;font-size:12px;color:#6b7280;max-width:320px">
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(e.description || '')}">
                        ${_esc(e.description || '—')}
                    </div>
                </td>
            </tr>`;
        }).join('');

        createIcons(tbody);
        _renderAuditPagination();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding:2rem;text-align:center;font-size:12px;color:#dc2626">
            Erreur de chargement : ${_esc(err.message)}
        </td></tr>`;
        console.error('[audit]', err);
    }
}

// ── Pagination ────────────────────────────────────────────────────────────────
const _renderAuditPagination = () => {
    const el = document.getElementById('auditPagination');
    if (!el || _auditPages <= 1) {
        if (el) el.innerHTML = '';
        return;
    }

    const btn = (label, page, disabled) =>
        `<button onclick="_auditGo(${page})" ${disabled ? 'disabled' : ''}
                 style="padding:5px 14px;font-size:11px;border:0.5px solid #e5e7eb;
                        background:${disabled ? '#f8fafc' : '#fff'};color:${disabled ? '#9ca3af' : '#374151'};
                        cursor:${disabled ? 'default' : 'pointer'}">${label}</button>`;

    el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 16px;border-top:0.5px solid #e5e7eb">
            ${btn('← Précédent', _auditPage - 1, _auditPage === 0)}
            <span style="font-size:12px;color:#9ca3af">
                Page ${_auditPage + 1} / ${_auditPages}
                &nbsp;·&nbsp; ${_auditTotal.toLocaleString('fr-FR')} événement${_auditTotal !== 1 ? 's' : ''}
            </span>
            ${btn('Suivant →', _auditPage + 1, _auditPage >= _auditPages - 1)}
        </div>`;
};

window._auditGo = (page) => {
    if (page < 0 || page >= _auditPages) return;
    _auditPage = page;
    _fetchAudit();
};

// ── Filter helpers ────────────────────────────────────────────────────────────
window.clearAuditFilters = () => {
    document.getElementById('auditActionFilter').value = '';
    document.getElementById('auditPerformedBy').value = '';
    document.getElementById('auditTarget').value = '';
    document.getElementById('auditFrom').value = '';
    document.getElementById('auditTo').value = '';
    _auditPage = 0;
    _fetchAudit();
};

window.loadAudit = () => {
    _auditPage = 0;
    _fetchAudit();
};

// Debounce text inputs — wait 400ms before firing
let _debounceTimer;
window.debouncedLoad = () => {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
        _auditPage = 0;
        _fetchAudit();
    }, 400);
};

// ── Export ────────────────────────────────────────────────────────────────────
window.exportAudit = async () => {
    showSnackbar('Préparation de l\'export…', 'info');

    const params = new URLSearchParams({page: 0, size: 1000});
    const action = document.getElementById('auditActionFilter')?.value;
    const performedBy = document.getElementById('auditPerformedBy')?.value?.trim();
    const target = document.getElementById('auditTarget')?.value?.trim();
    const from = document.getElementById('auditFrom')?.value;
    const to = document.getElementById('auditTo')?.value;
    if (action) params.set('action', action);
    if (performedBy) params.set('performedBy', performedBy);
    if (target) params.set('target', target);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    try {
        const res = await secureFetch(`${API_BASE}/admin/audit?${params}`);
        if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
        const data = await res.json();
        const items = data.items ?? [];

        if (!items.length) {
            showSnackbar('Aucun événement à exporter', 'info');
            return;
        }

        const headers = ['Date', 'Heure', 'Action', 'Effectué par', 'Cible', 'Description'];
        const rows = items.map(e => {
            const dt = e.timestamp ? new Date(e.timestamp) : null;
            const date = dt ? dt.toLocaleDateString('fr-FR') : '';
            const time = dt ? dt.toLocaleTimeString('fr-FR') : '';
            return [
                date,
                time,
                e.action || '',
                e.performedBy || '',
                e.target || '',
                (e.description || '').replace(/"/g, '""'),
            ].map(v => `"${v}"`).join(',');
        });

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_${from || 'all'}_${to || 'all'}.csv`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSnackbar(`${items.length} événement${items.length !== 1 ? 's' : ''} exporté${items.length !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
        showSnackbar('Erreur export : ' + err.message, 'error');
    }
};

// ── Init ─────────────────────────────────────────────────────────────────────
function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function initAudit() {
    // Load action types for the filter dropdown
    try {
        const res = await secureFetch(`${API_BASE}/admin/audit/actions`);
        if (res && res.ok) {
            const actions = await res.json();
            const sel = document.getElementById('auditActionFilter');
            if (sel) {
                actions.forEach(a => {
                    const opt = document.createElement('option');
                    opt.value = a;
                    opt.textContent = a.replace(/_/g, ' ');
                    sel.appendChild(opt);
                });
            }
        }
    } catch (_) {
    }

    // Default date range: last 30 days
    const today = new Date();
    const monthAgo = new Date();
    monthAgo.setDate(today.getDate() - 30);
    const fmt = d => d.toISOString().slice(0, 10);
    const fromEl = document.getElementById('auditFrom');
    const toEl = document.getElementById('auditTo');
    if (fromEl && !fromEl.value) fromEl.value = fmt(monthAgo);
    if (toEl && !toEl.value) toEl.value = fmt(today);

    _fetchAudit();
}

document.addEventListener('DOMContentLoaded', initAudit);
