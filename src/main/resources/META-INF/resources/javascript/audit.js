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
// Map an action to a semantic badge tone. These names match the .badge-*
// classes (propertyBadge only accepts these); returning old colour names
// like 'blue'/'amber' would silently fall through to a neutral badge.
const _actionTone = (action = '') => {
    if (!action) return 'pending';
    const a = action.toUpperCase();
    if (a.includes('DELETE') || a.includes('LOCK')) return 'error';
    if (a.includes('CREATE') || a.includes('UNLOCK')) return 'success';
    if (a.includes('UPDATE') || a.includes('CHANGE') || a.includes('RESET') || a.includes('TOGGLE')) return 'warning';
    if (a.includes('VALID')) return 'success';
    if (a.includes('LOGIN')) return 'validated';
    return 'pending';
};

// ── Load ─────────────────────────────────────────────────────────────────────
async function _fetchAudit() {
    const tbody = document.getElementById('auditTbody');
    tbody.innerHTML = loadingStateRow(5, 'Chargement…');

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
            tbody.innerHTML = emptyStateRow(5, 'Aucun événement trouvé', {icon: 'search-x'});
            createIcons(tbody);
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

            return `<tr>
                <td style="white-space:nowrap">
                    <div style="font-size:var(--text-xs);color:var(--ink)">${date}</div>
                    <div style="font-size:var(--text-2xs);color:var(--ink-3)">${time}</div>
                </td>
                <td>${actionBadge}</td>
                <td style="font-size:var(--text-xs);color:var(--ink);font-weight:700">
                    ${_esc(e.performedBy || '—')}
                </td>
                <td class="mono" style="font-size:var(--text-xs);color:var(--ink-2)">
                    ${_esc(e.target || '—')}
                </td>
                <td style="font-size:var(--text-xs);color:var(--ink-2);max-width:320px">
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(e.description || '')}">
                        ${_esc(e.description || '—')}
                    </div>
                </td>
            </tr>`;
        }).join('');

        createIcons(tbody);
        _renderAuditPagination();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding:2rem;text-align:center;font-size:var(--text-xs);color:var(--status-error-text)">
            Erreur de chargement : ${_esc(err.message)}
        </td></tr>`;
        console.error('[audit]', err);
    }
}

// ── Pagination ────────────────────────────────────────────────────────────────
const _renderAuditPagination = () => {
    // Uses the shared renderPagination (1-based). _auditGo converts back to 0-based.
    renderPagination('auditPagination', {
        page: _auditPage + 1,
        totalPages: _auditPages,
        totalItems: _auditTotal,
        itemLabel: 'événements',
        pageSize: AUDIT_SIZE,
        onGo: '_auditGo'
    });
};

window._auditGo = (page) => {
    // page is 1-based from the shared control
    const zeroBased = page - 1;
    if (zeroBased < 0 || zeroBased >= _auditPages) return;
    _auditPage = zeroBased;
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

        const escH = (v) => String(v ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        const rows = items.map(e => {
            const dt = e.timestamp ? new Date(e.timestamp) : null;
            const date = dt ? dt.toLocaleDateString('fr-FR') : '—';
            const time = dt ? dt.toLocaleTimeString('fr-FR') : '';
            return `<tr>
                <td class="nowrap"><span class="d">${escH(date)}</span><span class="t">${escH(time)}</span></td>
                <td><span class="act">${escH((e.action || '—').replace(/_/g, ' '))}</span></td>
                <td class="b">${escH(e.performedBy || '—')}</td>
                <td class="mono">${escH(e.target || '—')}</td>
                <td>${escH(e.description || '—')}</td>
            </tr>`;
        }).join('');

        const now = new Date();
        const periode = (from || to) ? `${escH(from || '…')} au ${escH(to || '…')}` : 'toutes dates';
        const filters = [];
        if (action) filters.push(`Action : ${escH(action.replace(/_/g, ' '))}`);
        if (performedBy) filters.push(`Effectué par : ${escH(performedBy)}`);
        if (target) filters.push(`Cible : ${escH(target)}`);

        const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<title>Journal d'audit — Orange Bank</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #1B1B1B; margin: 0; padding: 32px; font-size: 12px; }
  .head { background: #0a0a0a; color: #fff; padding: 18px 22px; border-top: 3px solid #FF7900; margin: -32px -32px 24px; display: flex; justify-content: space-between; align-items: baseline; }
  .head h1 { font-size: 17px; margin: 0; letter-spacing: -.01em; }
  .head .brand { color: #9aa3af; font-size: 12px; }
  .meta { color: #767676; margin-bottom: 4px; }
  .meta b { color: #1B1B1B; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #767676; border-bottom: 1px solid #E8E8E8; padding: 8px 10px; }
  td { border-bottom: 1px solid #F0F0F0; padding: 8px 10px; vertical-align: top; }
  .nowrap { white-space: nowrap; }
  .d { display: block; } .t { display: block; color: #767676; font-size: 10px; }
  .act { display: inline-block; border: 1px solid #E0E0E0; padding: 2px 7px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .b { font-weight: 700; }
  .mono { font-family: "Courier New", monospace; color: #595959; font-size: 11px; word-break: break-all; }
  .foot { margin-top: 20px; padding-top: 10px; border-top: 1px solid #E8E8E8; color: #767676; font-size: 10px; display: flex; justify-content: space-between; }
  .no-print { text-align: right; margin-bottom: 16px; }
  .no-print button { background: #FF7900; color: #fff; border: 0; padding: 9px 18px; font-size: 12px; font-weight: 700; cursor: pointer; }
  @media print { .no-print { display: none; } body { padding: 0; } .head { margin: 0 0 24px; } }
</style></head>
<body>
  <div class="no-print"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="head"><h1>Journal d'audit</h1><span class="brand">Orange Bank — FLUX</span></div>
  <div class="meta">Période : <b>${periode}</b></div>
  ${filters.length ? `<div class="meta">Filtres : ${filters.join(' &nbsp;·&nbsp; ')}</div>` : ''}
  <div class="meta"><b>${items.length}</b> événement${items.length !== 1 ? 's' : ''}</div>
  <table>
    <thead><tr><th>Date</th><th>Action</th><th>Effectué par</th><th>Cible</th><th>Description</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot">
    <span>Orange Bank — Rapport confidentiel</span>
    <span>Généré le ${escH(now.toLocaleDateString('fr-FR'))} à ${escH(now.toLocaleTimeString('fr-FR'))}</span>
  </div>
</body></html>`;

        const win = window.open('', '_blank');
        if (!win) {
            showSnackbar('Autorisez les fenêtres pop-up pour exporter', 'error');
            return;
        }
        win.document.write(html);
        win.document.close();
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

    // Load distinct performers for the "Effectué par" dropdown
    try {
        const res = await secureFetch(`${API_BASE}/admin/audit/performers`);
        if (res && res.ok) {
            const performers = await res.json();
            const sel = document.getElementById('auditPerformedBy');
            if (sel) {
                performers.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = p;
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
