class AdminDashboard {
    constructor() {
        this.REFRESH_INTERVAL = 60000;
        this.autoRefreshInterval = null;
        this.currentBatchId = null;
        this.currentLogs = [];
        this._allUsers = [];

        this.elements = {
            refreshBtn:            document.getElementById('refreshStats'),
            refreshIcon:           document.getElementById('refreshIcon'),
            toggleAutoRefreshBtn:  document.getElementById('toggleAutoRefresh'),
            autoRefreshBg:         document.getElementById('autoRefreshBg'),
            autoRefreshKnob:       document.getElementById('autoRefreshKnob'),
            autoRefreshIndicator:  document.getElementById('autoRefreshIndicator'),
            featuresList:          document.getElementById('featuresList'),
            featuresLoader:        document.getElementById('featuresLoader'),
            featuresError:         document.getElementById('featuresError'),
            batchSelector:         document.getElementById('batchSelector'),
            levelFilter:           document.getElementById('levelFilter'),
            refreshLogsBtn:        document.getElementById('refreshLogsBtn'),
            exportLogsBtn:         document.getElementById('exportLogsBtn'),
            processingLogsList:    document.getElementById('processingLogsList'),
            processingLogsLoader:  document.getElementById('processingLogsLoader'),
            processingLogsEmpty:   document.getElementById('processingLogsEmpty'),
            processingLogsError:   document.getElementById('processingLogsError'),
            usersLoader:           document.getElementById('users-loader'),
            usersTableWrapper:     document.getElementById('users-table-wrapper'),
            usersTbody:            document.getElementById('users-tbody'),
            usersEmpty:            document.getElementById('users-empty'),
            usersError:            document.getElementById('users-error'),
            usersCount:            document.getElementById('users-count'),
            statTotal:             document.getElementById('stat-total-batches'),
            statPending:           document.getElementById('stat-pending'),
            statProcessed:         document.getElementById('stat-validated'),
            detailUploaded:        document.getElementById('detail-uploaded'),
            detailValidated:       document.getElementById('detail-validated'),
            detailProcessing:      document.getElementById('detail-processing'),
            detailProcessed:       document.getElementById('detail-processed'),
            detailErrors:          document.getElementById('detail-errors'),
        };

        this.initEventListeners();
    }

    initEventListeners() {
        this.elements.refreshBtn?.addEventListener('click', () => {
            this.elements.refreshIcon?.classList.add('animate-spin');
            this.refreshAllData().finally(() => {
                this.elements.refreshIcon?.classList.remove('animate-spin');
            });
        });
        this.elements.toggleAutoRefreshBtn?.addEventListener('click', () => this.toggleAutoRefresh());
        this.elements.batchSelector?.addEventListener('change', () => this.applyFilters());
        this.elements.levelFilter?.addEventListener('change', () => this.applyFilters());
        this.elements.refreshLogsBtn?.addEventListener('click', () => this.applyFilters());
        this.elements.exportLogsBtn?.addEventListener('click', () => this.exportLogsToCSV());
    }

    async refreshAllData() {
        await Promise.all([
            this.loadStats(),
            this.loadFeatures(),
            this.loadRecentBatchesForSelector(),
            this.loadUsers()
        ]);
        this.applyFilters();
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    async loadStats() {
        try {
            const response = await secureFetch(`${API_BASE}/batches/counts`);
            if (!response || !response.ok) return;
            const counts = await response.json();

            const total     = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
            const pending   = (counts.UPLOADED || 0) + (counts.VALIDATED || 0);
            const processed = (counts.PROCESSED || 0) + (counts.PROCESSED_WITH_ERROR || 0);
            const errors    = (counts.UPLOADED_FAILED || 0) + (counts.VALIDATED_FAILED || 0)
                            + (counts.PROCESSED_FAILED || 0) + (counts.PROCESSED_WITH_ERROR || 0);

            this.animateNumber(this.elements.statTotal,     total);
            this.animateNumber(this.elements.statPending,   pending);
            this.animateNumber(this.elements.statProcessed, processed);

            this.elements.detailUploaded.textContent   = counts.UPLOADED    || 0;
            this.elements.detailValidated.textContent  = counts.VALIDATED   || 0;
            this.elements.detailProcessing.textContent = counts.PROCESSING  || 0;
            this.elements.detailProcessed.textContent  = counts.PROCESSED   || 0;
            this.elements.detailErrors.textContent     = errors;
        } catch (err) {
            console.error('Erreur stats:', err);
        }
    }

    /** Animate a number counting up from its current value to target */
    animateNumber(el, target) {
        if (!el) return;
        const start  = parseInt(el.textContent) || 0;
        const change = target - start;
        if (change === 0) return;
        const duration = 600;
        const startTime = performance.now();
        const tick = (now) => {
            const elapsed = Math.min(now - startTime, duration);
            const progress = elapsed / duration;
            const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
            el.textContent = Math.round(start + change * ease);
            if (elapsed < duration) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    // ── Features ──────────────────────────────────────────────────────────────

    async loadFeatures() {
        this.elements.featuresLoader?.classList.remove('hidden');
        if (this.elements.featuresList) this.elements.featuresList.innerHTML = '';
        this.elements.featuresError?.classList.add('hidden');

        try {
            const response = await secureFetch(`${API_BASE}/admin/features`);
            if (!response || !response.ok) throw new Error('Erreur réseau');
            const features = await response.json();

            if (!features.length) {
                this.elements.featuresList.innerHTML = '<p class="text-gray-500 text-sm italic">Aucune fonctionnalité configurée.</p>';
                return;
            }

            this.elements.featuresList.innerHTML = '';
            features.forEach((feature, idx) => {
                const enabled = feature.isEnabled === true;
                const item = document.createElement('div');
                item.style.cssText = 'opacity:0;transform:translateY(8px);transition:opacity .25s ease,transform .25s ease;';
                item.className = 'flex items-center justify-between p-4 rounded-lg border border-gray-100 bg-gray-50 hover:bg-white hover:border-gray-200 transition-all';
                item.innerHTML = `
                    <div class="flex-1 min-w-0 mr-4">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}" id="feat-badge-${feature.configKey}">
                                ${enabled ? 'Actif' : 'Inactif'}
                            </span>
                            <h4 class="font-semibold text-gray-900 text-sm">${feature.configKey}</h4>
                        </div>
                        <p class="text-xs text-gray-500">${feature.description || 'Pas de description'}</p>
                        <p class="text-[10px] text-gray-400 mt-1">Mis à jour : ${feature.lastUpdated ? new Date(feature.lastUpdated).toLocaleString('fr-FR') : '—'}</p>
                    </div>
                    <button data-key="${feature.configKey}" data-enabled="${enabled}" aria-pressed="${enabled}"
                            class="feature-toggle-btn relative inline-flex h-7 w-14 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1 ${enabled ? 'bg-orange-600' : 'bg-gray-300'}">
                        <span class="absolute left-0.5 h-6 w-6 transform rounded-full bg-white shadow transition-transform duration-200 ${enabled ? 'translate-x-7' : ''}"></span>
                    </button>
                `;
                this.elements.featuresList.appendChild(item);
                setTimeout(() => { item.style.opacity = '1'; item.style.transform = 'translateY(0)'; }, idx * 60);
            });

            document.querySelectorAll('.feature-toggle-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const key     = btn.dataset.key;
                    const current = btn.dataset.enabled === 'true';
                    const newState = !current;

                    btn.disabled = true;
                    btn.style.opacity = '0.6';

                    try {
                        const res = await secureFetch(`/api/v1/admin/features/toggle/${key}?enabled=${newState}`, {method: 'POST'});
                        if (!res || !res.ok) throw new Error('Échec');

                        btn.dataset.enabled = String(newState);
                        btn.setAttribute('aria-pressed', String(newState));

                        const knob  = btn.querySelector('span');
                        const badge = document.getElementById(`feat-badge-${key}`);

                        btn.classList.toggle('bg-orange-600', newState);
                        btn.classList.toggle('bg-gray-300', !newState);
                        knob.classList.toggle('translate-x-7', newState);

                        if (badge) {
                            badge.textContent = newState ? 'Actif' : 'Inactif';
                            badge.className = `inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${newState ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`;
                        }

                        showSnackbar(`${key} ${newState ? 'activé' : 'désactivé'}`, 'success');
                    } catch (err) {
                        showSnackbar(`Échec de la mise à jour de ${key}`, 'error');
                    } finally {
                        btn.disabled = false;
                        btn.style.opacity = '1';
                    }
                });
            });

        } catch (err) {
            console.error('Erreur features:', err);
            this.elements.featuresError?.classList.remove('hidden');
        } finally {
            this.elements.featuresLoader?.classList.add('hidden');
        }
    }

    // ── Batch selector for logs ───────────────────────────────────────────────

    async loadRecentBatchesForSelector() {
        try {
            const response = await secureFetch(`${API_BASE}/batches/recent-batches`);
            if (!response || !response.ok) return;
            const batches = await response.json();

            const selector = this.elements.batchSelector;
            if (!selector) return;
            selector.innerHTML = '<option value="">Tous les batches récents</option>';
            batches.forEach(batch => {
                const opt = document.createElement('option');
                opt.value = batch.id;
                opt.textContent = `#${batch.id.slice(-8)} (${batch.status || 'N/A'}) — ${batch.uploadedAt ? new Date(batch.uploadedAt).toLocaleDateString('fr-FR') : ''}`;
                selector.appendChild(opt);
            });
        } catch (err) {
            console.error('Erreur selector batches:', err);
        }
    }

    // ── Processing logs ───────────────────────────────────────────────────────

    async loadProcessingLogs(batchId = null) {
        const { processingLogsLoader, processingLogsList, processingLogsEmpty, processingLogsError } = this.elements;
        processingLogsLoader?.classList.remove('hidden');
        if (processingLogsList) processingLogsList.innerHTML = '';
        processingLogsEmpty?.classList.add('hidden');
        processingLogsError?.classList.add('hidden');

        try {
            const url = batchId ? `/api/v1/batches/processing-logs?batchId=${batchId}` : '/api/v1/batches/processing-logs';
            const response = await secureFetch(url);
            if (!response || !response.ok) throw new Error('Erreur réseau');
            const logs = await response.json();
            this.currentLogs    = logs;
            this.currentBatchId = batchId;
            this.renderLogs(logs);
        } catch (err) {
            console.error('Erreur logs:', err);
            processingLogsError?.classList.remove('hidden');
        } finally {
            processingLogsLoader?.classList.add('hidden');
        }
    }

    renderLogs(logs) {
        const list = this.elements.processingLogsList;
        if (!list) return;
        list.innerHTML = '';

        if (!logs.length) {
            this.elements.processingLogsEmpty?.classList.remove('hidden');
            return;
        }
        this.elements.processingLogsEmpty?.classList.add('hidden');

        const fragment = document.createDocumentFragment();
        logs.forEach(log => {
            const time  = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('fr-FR') : '??:??:??';
            const level = log.level || 'INFO';

            const styles = {
                ERROR: { time: 'color:#555e6d', level: 'color:#f85149;font-weight:400', msg: 'color:#ffd7d5' },
                WARN:  { time: 'color:#555e6d', level: 'color:#d29922;font-weight:400', msg: 'color:#f0e2c0' },
                INFO:  { time: 'color:#555e6d', level: 'color:#58a6ff;font-weight:400', msg: 'color:#c9d1d9' },
            };
            const s = styles[level] || styles.INFO;

            const line = document.createElement('div');
            line.style.cssText = `display:flex;align-items:flex-start;gap:.85rem;padding:.1rem 0;font-size:.74rem;line-height:1.85;`;
            line.innerHTML = `
                <span style="${s.time};font-variant-numeric:tabular-nums;flex-shrink:0;">${time}</span>
                <span style="${s.level};flex-shrink:0;min-width:3.5rem;">[${level}]</span>
                <span style="${s.msg};word-break:break-all;">${this.escapeHtml(log.message || '')}</span>
            `;
            fragment.appendChild(line);
        });

        list.appendChild(fragment);
        const container = document.getElementById('processingLogsContainer');
        if (container) container.scrollTop = container.scrollHeight;
    }

    applyFilters() {
        const batchId = this.elements.batchSelector?.value || null;
        const level   = this.elements.levelFilter?.value   || null;

        if (batchId !== this.currentBatchId) {
            this.loadProcessingLogs(batchId);
            return;
        }

        const filtered = level ? this.currentLogs.filter(l => l.level === level) : this.currentLogs;
        this.renderLogs(filtered);
    }

    exportLogsToCSV() {
        if (!this.currentLogs.length) {
            showSnackbar('Aucun log à exporter', 'info');
            return;
        }
        const rows = [['Timestamp', 'Level', 'Message'].join(',')];
        this.currentLogs.forEach(log => {
            const esc = s => { const str = String(s||''); return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str.replace(/"/g,'""')}"` : str; };
            const time = log.timestamp ? new Date(log.timestamp).toLocaleString('fr-FR') : '';
            rows.push([esc(time), esc(log.level), esc(log.message)].join(','));
        });
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `logs_${new Date().toISOString().slice(0,10)}.csv`;
        link.click();
        showSnackbar('Export CSV réussi !', 'success');
    }

    // ── Users ─────────────────────────────────────────────────────────────────

    async loadUsers() {
        const { usersLoader, usersTableWrapper, usersTbody, usersEmpty, usersError, usersCount } = this.elements;
        usersLoader?.classList.remove('hidden');
        usersTableWrapper?.classList.add('hidden');
        usersEmpty?.classList.add('hidden');
        usersError?.classList.add('hidden');

        try {
            const res = await secureFetch(`${API_BASE}/users/list`);
            if (!res || !res.ok) throw new Error('HTTP ' + (res?.status || '?'));
            this._allUsers = await res.json();
            this.renderUsersTable(this._allUsers);
        } catch (err) {
            console.error('Erreur chargement users:', err);
            usersError?.classList.remove('hidden');
        } finally {
            usersLoader?.classList.add('hidden');
        }
    }

    filterUsers(search) {
        if (!this._allUsers) return;
        const q = (search || '').trim().toLowerCase();
        const statusFilter = document.getElementById('users-status-filter')?.value || '';
        const filtered = this._allUsers.filter(u => {
            const matchQ = !q || u.username.toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q) || (u.role||'').toLowerCase().includes(q);
            const matchS = !statusFilter || u.status === statusFilter;
            return matchQ && matchS;
        });
        this.renderUsersTable(filtered);
    }

    renderUsersTable(users) {
        const { usersTableWrapper, usersTbody, usersEmpty, usersCount } = this.elements;
        if (usersCount) usersCount.textContent = users.length + ' utilisateur' + (users.length !== 1 ? 's' : '');

        if (!users.length) {
            usersTableWrapper?.classList.add('hidden');
            usersEmpty?.classList.remove('hidden');
            return;
        }
        usersEmpty?.classList.add('hidden');
        usersTableWrapper?.classList.remove('hidden');

        const statusBadge = s => {
            const m = { ACTIVE:'bg-green-100 text-green-800', PENDING:'bg-yellow-100 text-yellow-800', LOCKED:'bg-red-100 text-red-800' };
            return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${m[s]||'bg-gray-100 text-gray-600'}">${s||'ACTIVE'}</span>`;
        };
        const roleBadge = r => {
            const m = { ADMIN:'bg-purple-100 text-purple-800', INPUTTER:'bg-blue-100 text-blue-800', AUTHORISER:'bg-teal-100 text-teal-800' };
            return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${m[r]||'bg-gray-100 text-gray-600'}">${r||'—'}</span>`;
        };

        if (usersTbody) {
            usersTbody.innerHTML = users.map(u => {
                const locked = u.status === 'LOCKED';
                const pwdWarn = u.mustChangePassword ? `<span class="ml-1 text-[9px] text-orange-600 bg-orange-50 px-1 py-0.5 rounded">pwd requis</span>` : '';
                const action  = locked
                    ? `<button onclick="dashboard.unlockUser('${u.username}')" class="inline-flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-medium rounded transition">🔓 Déverrouiller</button>`
                    : `<span class="text-gray-300 text-[10px]">—</span>`;
                const deleteBtn = `<button onclick="dashboard.deleteUser('${u.username}')" title="Supprimer l'utilisateur" class="inline-flex items-center gap-1 px-2 py-1 bg-white border border-red-300 hover:bg-red-50 text-red-600 text-[10px] font-medium rounded transition">🗑 Supprimer</button>`;
                return `<tr class="hover:bg-gray-50 transition-colors ${locked ? 'bg-red-50/40' : ''}">
                    <td class="px-3 py-2.5">
                        <div class="font-semibold text-gray-900 text-xs">${this.escapeHtml(u.username)}${pwdWarn}</div>
                        ${u.email ? `<div class="text-gray-400 text-[10px]">${this.escapeHtml(u.email)}</div>` : ''}
                    </td>
                    <td class="px-3 py-2.5">${roleBadge(u.role)}</td>
                    <td class="px-3 py-2.5 text-xs text-gray-600">${this.escapeHtml(u.countryCode||'—')}</td>
                    <td class="px-3 py-2.5 text-center">${statusBadge(u.status)}</td>
                    <td class="px-3 py-2.5 text-center"><span class="${u.failedLoginCount > 0 ? 'text-red-600 font-bold' : 'text-gray-400'} text-xs">${u.failedLoginCount ?? 0}</span></td>
                    <td class="px-3 py-2.5 text-xs text-gray-500">${this.escapeHtml(u.createdBy||'—')}</td>
                    <td class="px-3 py-2.5 text-center">${action}</td>
                    <td class="px-3 py-2.5 text-center">${deleteBtn}</td>
                </tr>`;
            }).join('');
        }
    }

    async unlockUser(username) {
        if (!confirm(`Déverrouiller le compte de ${username} ?`)) return;
        try {
            const res = await secureFetch(`/api/v1/auth/unlock/${encodeURIComponent(username)}`, {method: 'POST'});
            if (!res) return;
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                showSnackbar(`✓ Compte ${username} déverrouillé.`, 'success');
                await this.loadUsers();
            } else {
                showSnackbar(data.message || 'Échec du déverrouillage.', 'error');
            }
        } catch { showSnackbar('Erreur réseau.', 'error'); }
    }

    async deleteUser(username) {
        if (!confirm(`Supprimer définitivement l'utilisateur ${username} ?\nCette action est irréversible.`)) return;
        try {
            const res = await secureFetch(`/api/v1/users/${encodeURIComponent(username)}`, {method: 'DELETE'});
            if (!res) return;
            if (res.ok) {
                showSnackbar(`✓ Utilisateur ${username} supprimé.`, 'success');
                await this.loadUsers();
            } else {
                const data = await res.json().catch(() => ({}));
                showSnackbar(data.message || 'Échec de la suppression.', 'error');
            }
        } catch {
            showSnackbar('Erreur réseau.', 'error');
        }
    }

    // ── Auto refresh ──────────────────────────────────────────────────────────

    updateAutoRefreshUI() {
        const isOn = !!this.autoRefreshInterval;
        const bg   = this.elements.autoRefreshBg;
        const knob = this.elements.autoRefreshKnob;
        const ind  = this.elements.autoRefreshIndicator;
        if (bg)   { bg.style.background = isOn ? '#e86e00' : '#d1d5db'; }
        if (knob) { knob.style.transform = isOn ? 'translateX(14px)' : 'translateX(0)'; }
        if (ind)  { ind.textContent = isOn ? 'ON' : 'OFF'; ind.style.color = isOn ? '#e86e00' : '#6b7280'; }
    }

    startAutoRefresh() {
        if (this.autoRefreshInterval) return;
        this.autoRefreshInterval = setInterval(() => this.refreshAllData(), this.REFRESH_INTERVAL);
        this.updateAutoRefreshUI();
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        this.autoRefreshInterval = null;
        this.updateAutoRefreshUI();
    }

    toggleAutoRefresh() {
        this.autoRefreshInterval ? this.stopAutoRefresh() : this.startAutoRefresh();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text || '');
        return div.innerHTML;
    }
}

let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new AdminDashboard();
    dashboard.startAutoRefresh();
    dashboard.refreshAllData().then(() => {
        const sel = dashboard.elements.batchSelector;
        if (sel && sel.options.length > 1) {
            sel.selectedIndex = 1;
            dashboard.loadProcessingLogs(sel.value);
        } else {
            dashboard.loadProcessingLogs();
        }
    });
    window.addEventListener('beforeunload', () => dashboard.stopAutoRefresh());
});

