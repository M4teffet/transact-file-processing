class AdminDashboard {
    constructor() {
        this.REFRESH_INTERVAL = 30000;
        this.autoRefreshInterval = null;
        this.currentBatchId = null;
        this.currentLogs = [];

        this.elements = {
            refreshBtn: document.getElementById('refreshStats'),
            refreshIcon: document.getElementById('refreshIcon'),
            toggleAutoRefreshBtn: document.getElementById('toggleAutoRefresh'),
            autoRefreshBg: document.getElementById('autoRefreshBg'),
            autoRefreshKnob: document.getElementById('autoRefreshKnob'),
            autoRefreshIndicator: document.getElementById('autoRefreshIndicator'),
            featuresList: document.getElementById('featuresList'),
            featuresLoader: document.getElementById('featuresLoader'),
            featuresError: document.getElementById('featuresError'),
            batchSelector: document.getElementById('batchSelector'),
            levelFilter: document.getElementById('levelFilter'),
            refreshLogsBtn: document.getElementById('refreshLogsBtn'),
            exportLogsBtn: document.getElementById('exportLogsBtn'),
            processingLogsList: document.getElementById('processingLogsList'),
            processingLogsLoader: document.getElementById('processingLogsLoader'),
            processingLogsEmpty: document.getElementById('processingLogsEmpty'),
            processingLogsError: document.getElementById('processingLogsError'),

            // Stats
            statTotal: document.getElementById('stat-total-batches'),
            statPending: document.getElementById('stat-pending'),
            statProcessed: document.getElementById('stat-validated'),
            detailUploaded: document.getElementById('detail-uploaded'),
            detailValidated: document.getElementById('detail-validated'),
            detailProcessing: document.getElementById('detail-processing'),
            detailProcessed: document.getElementById('detail-processed'),
            detailErrors: document.getElementById('detail-errors'),
        };

        this.initEventListeners();
    }

    initEventListeners() {
        this.elements.refreshBtn?.addEventListener('click', () => {
            this.elements.refreshIcon.classList.add('animate-spin');
            this.refreshAllData().finally(() => {
                this.elements.refreshIcon.classList.remove('animate-spin');
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
            this.loadRecentBatchesForSelector()
        ]);
        this.applyFilters();
    }

    async loadStats() {
        try {
            const response = await fetch('/api/batches/counts');
            if (!response.ok) throw new Error('Erreur réseau');
            const counts = await response.json();

            const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
            const pending = (counts.UPLOADED || 0) + (counts.VALIDATED || 0);
            const processed = (counts.PROCESSED || 0) + (counts.PROCESSED_WITH_ERROR || 0);
            const errors = (counts.UPLOADED_FAILED || 0) + (counts.VALIDATED_FAILED || 0) +
                           (counts.PROCESSED_FAILED || 0) + (counts.PROCESSED_WITH_ERROR || 0);

            this.elements.statTotal.textContent = total;
            this.elements.statPending.textContent = pending;
            this.elements.statProcessed.textContent = processed;

            this.elements.detailUploaded.textContent = counts.UPLOADED || 0;
            this.elements.detailValidated.textContent = counts.VALIDATED || 0;
            this.elements.detailProcessing.textContent = counts.PROCESSING || 0;
            this.elements.detailProcessed.textContent = counts.PROCESSED || 0;
            this.elements.detailErrors.textContent = errors;

        } catch (err) {
            console.error('Erreur chargement stats:', err);
        }
    }

    async loadFeatures() {
        this.elements.featuresLoader.classList.remove('hidden');
        this.elements.featuresList.innerHTML = '';
        this.elements.featuresError.classList.add('hidden');

        try {
            const response = await fetch('/api/admin/features');
            if (!response.ok) throw new Error('Erreur réseau');
            const features = await response.json();

            if (features.length === 0) {
                this.elements.featuresList.innerHTML = '<p class="text-gray-500 text-sm">Aucune fonctionnalité configurée.</p>';
                return;
            }

            features.forEach(feature => {
                const enabled = feature.isEnabled === true;
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-4 bg-gray-50 rounded-lg';
                item.innerHTML = `
                    <div>
                        <h4 class="font-semibold text-gray-900">${feature.configKey}</h4>
                        <p class="text-sm text-gray-600 mt-1">${feature.description || 'Pas de description'}</p>
                        <p class="text-xs text-gray-500 mt-2">
                            Mis à jour : ${new Date(feature.lastUpdated).toLocaleString()}
                        </p>
                    </div>
                    <div class="flex items-center gap-4">
                        <span class="text-lg font-medium ${enabled ? 'text-green-600' : 'text-red-600'}">
                            ${enabled ? 'Actif' : 'Inactif'}
                        </span>
                        <button data-key="${feature.configKey}" data-enabled="${enabled}"
                                class="relative inline-flex h-10 w-20 items-center rounded-full transition-colors focus:outline-none focus:ring-4 focus:ring-brand-primary/30 feature-toggle-btn">
                            <span class="absolute inset-0 rounded-full transition-colors ${enabled ? 'bg-brand-primary' : 'bg-gray-300'}"></span>
                            <span class="absolute left-1 top-1 h-8 w-8 transform rounded-full bg-white shadow-md transition-transform ${enabled ? 'translate-x-10' : ''}"></span>
                        </button>
                    </div>
                `;
                this.elements.featuresList.appendChild(item);
            });

            document.querySelectorAll('.feature-toggle-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const key = btn.dataset.key;
                    const current = btn.dataset.enabled === 'true';
                    const newState = !current;

                    try {
                        const response = await fetch(`/api/admin/features/toggle/${key}?enabled=${newState}`, { method: 'POST' });
                        if (!response.ok) throw new Error('Échec');

                        btn.dataset.enabled = newState;
                        const parent = btn.closest('div.flex');
                        const status = parent.querySelector('span.text-lg');
                        const bg = btn.querySelector('span.absolute.inset-0');
                        const knob = btn.querySelector('span.h-8');

                        if (newState) {
                            status.textContent = 'Actif';
                            status.className = 'text-lg font-medium text-green-600';
                            bg.classList.replace('bg-gray-300', 'bg-brand-primary');
                            knob.classList.add('translate-x-10');
                        } else {
                            status.textContent = 'Inactif';
                            status.className = 'text-lg font-medium text-red-600';
                            bg.classList.replace('bg-brand-primary', 'bg-gray-300');
                            knob.classList.remove('translate-x-10');
                        }
                    } catch (err) {
                        alert('Échec de la mise à jour de la fonctionnalité');
                    }
                });
            });

        } catch (err) {
            console.error('Erreur features:', err);
            this.elements.featuresError.classList.remove('hidden');
        } finally {
            this.elements.featuresLoader.classList.add('hidden');
        }
    }

    async loadRecentBatchesForSelector() {
        try {
            const response = await fetch('/api/batches/recent-batches');
            if (!response.ok) return;
            const batches = await response.json();

            const selector = this.elements.batchSelector;
            selector.innerHTML = '<option value="">Tous les batches récents</option>';

            batches.forEach(batch => {
                const option = document.createElement('option');
                option.value = batch.id;
                option.textContent = `Batch #${batch.id} - ${batch.filename || 'Inconnu'} (${batch.status || 'N/A'})`;
                selector.appendChild(option);
            });
        } catch (err) {
            console.error('Erreur chargement batches pour selector:', err);
        }
    }

    async loadProcessingLogs(batchId = null) {
        const { processingLogsLoader, processingLogsList, processingLogsEmpty, processingLogsError } = this.elements;

        processingLogsLoader.classList.remove('hidden');
        processingLogsList.innerHTML = '';
        processingLogsEmpty.classList.add('hidden');
        processingLogsError.classList.add('hidden');

        try {
            const url = batchId
                ? `/api/batches/processing-logs?batchId=${batchId}`
                : '/api/batches/processing-logs';
            const response = await fetch(url);
            if (!response.ok) throw new Error('Erreur réseau');
            const logs = await response.json();

            this.currentLogs = logs;
            this.currentBatchId = batchId;

            this.renderLogs(logs);

        } catch (err) {
            console.error('Erreur processing logs:', err);
            processingLogsError.classList.remove('hidden');
        } finally {
            processingLogsLoader.classList.add('hidden');
        }
    }

    renderLogs(logsToRender) {
        const list = this.elements.processingLogsList;
        list.innerHTML = '';

        if (logsToRender.length === 0) {
            this.elements.processingLogsEmpty.classList.remove('hidden');
            return;
        }

        this.elements.processingLogsEmpty.classList.add('hidden');

        logsToRender.forEach(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();

            let timeColorClass = 'text-gray-400';
            let levelColorClass = 'text-gray-300';
            let messageColorClass = 'text-gray-200';
            let lineBgClass = 'bg-gray-800 border-gray-700';

            if (log.level === 'ERROR') {
                timeColorClass = 'text-red-400 font-medium';
                levelColorClass = 'text-red-300 font-semibold';
                messageColorClass = 'text-red-100';
                lineBgClass = 'bg-red-950/80 border-red-800';
            } else if (log.level === 'WARN') {
                timeColorClass = 'text-yellow-400 font-medium';
                levelColorClass = 'text-yellow-300 font-semibold';
                messageColorClass = 'text-yellow-100';
                lineBgClass = 'bg-yellow-950/80 border-yellow-800';
            }

            const line = document.createElement('div');
            line.className = `p-3 rounded-lg border-l-4 ${lineBgClass} flex items-start gap-4 text-sm font-mono`;

            line.innerHTML = `
                <span class="${timeColorClass} tabular-nums">[${time}]</span>
                <span class="${levelColorClass} font-bold">[${log.level || 'INFO'}]</span>
                <span class="${messageColorClass} flex-1 break-words">${this.escapeHtml(log.message || '')}</span>
            `;

            list.appendChild(line);
        });

        list.scrollTop = list.scrollHeight;
    }

    applyFilters() {
        const batchId = this.elements.batchSelector?.value || null;
        const level = this.elements.levelFilter?.value || null;

        if (batchId !== this.currentBatchId) {
            this.loadProcessingLogs(batchId);
            return;
        }

        let filtered = this.currentLogs;

        if (level) {
            filtered = filtered.filter(log => log.level === level);
        }

        this.renderLogs(filtered);
    }

    exportLogsToCSV() {
        if (this.elements.processingLogsList.children.length === 0) {
            alert('Aucun log à exporter');
            return;
        }

        let csvRows = [];
        csvRows.push(['Timestamp', 'Level', 'Message'].join(','));

        Array.from(this.elements.processingLogsList.children).forEach(line => {
            const time = line.querySelector('span.tabular-nums')?.textContent.trim() || '';
            const level = line.querySelector('span.font-bold')?.textContent.trim() || '';
            const message = line.querySelector('span.flex-1')?.textContent.trim() || '';

            const escapeCsv = (field) => {
                const str = field.toString();
                return str.includes(',') || str.includes('"') || str.includes('\n')
                    ? `"${str.replace(/"/g, '""')}"`
                    : str;
            };

            csvRows.push([time, level, message].map(escapeCsv).join(','));
        });

        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `processing_logs_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateAutoRefreshUI() {
        const isOn = !!this.autoRefreshInterval;
        if (isOn) {
            this.elements.autoRefreshBg.classList.replace('bg-gray-300', 'bg-brand-primary');
            this.elements.autoRefreshKnob.classList.add('translate-x-5');
            this.elements.autoRefreshIndicator.textContent = 'ON';
            this.elements.autoRefreshIndicator.className = 'text-sm font-semibold text-brand-primary';
        } else {
            this.elements.autoRefreshBg.classList.replace('bg-brand-primary', 'bg-gray-300');
            this.elements.autoRefreshKnob.classList.remove('translate-x-5');
            this.elements.autoRefreshIndicator.textContent = 'OFF';
            this.elements.autoRefreshIndicator.className = 'text-sm font-semibold text-gray-500';
        }
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
}

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    const dashboard = new AdminDashboard();
    dashboard.startAutoRefresh();
    dashboard.refreshAllData().then(() => {
            // Après chargement des batches, sélectionne automatiquement le premier (le plus récent)
            if (dashboard.elements.batchSelector.options.length > 1) {
                dashboard.elements.batchSelector.selectedIndex = 1; // Premier batch après "Tous"
                dashboard.loadProcessingLogs(dashboard.elements.batchSelector.value);
            } else {
                dashboard.loadProcessingLogs(); // Tous les logs
            }
        });

    window.addEventListener('beforeunload', () => dashboard.stopAutoRefresh());
});