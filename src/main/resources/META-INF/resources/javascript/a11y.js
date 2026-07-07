/* ═══════════════════════════════════════════════════════════════════
   FLUX — a11y.js  (progressive accessibility enhancement)
   Pure enhancement, no markup or handler changes required. It reads the
   ARIA attributes already present and adds the keyboard behaviour the
   WAI-ARIA patterns expect. Safe to load on every page; each block
   no-ops if its target isn't on the page.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    /* ── Tabs: roving tabindex + arrow/Home/End, and aria-selected sync ──
       Works with the existing click handler in settings.js — we only add
       keyboard movement and keep aria-selected/tabindex in step with the
       .active class the click handler toggles. */
    function enhanceTablist(list) {
        const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
        if (!tabs.length) return;

        const sync = () => tabs.forEach(t => {
            const on = t.classList.contains('active');
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
        });
        sync();

        const activate = (t) => {
            t.click();
            t.focus();
            sync();
        };

        list.addEventListener('keydown', (e) => {
            const i = tabs.indexOf(document.activeElement);
            if (i < 0) return;
            let next = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(i + 1) % tabs.length];
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(i - 1 + tabs.length) % tabs.length];
            else if (e.key === 'Home') next = tabs[0];
            else if (e.key === 'End') next = tabs[tabs.length - 1];
            if (next) {
                e.preventDefault();
                activate(next);
            }
        });

        // Keep in sync when the tab is changed by mouse too.
        list.addEventListener('click', () => setTimeout(sync, 0));
    }

    /* ── Modals: dialog semantics + focus trap + Escape ──
       Convention: any .modal-overlay is a dialog. We tag it, and while it
       is open (not .hidden) we trap Tab focus inside it and close on Esc
       via the existing overlay-click path if available. */
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function enhanceModal(overlay) {
        const dialog = overlay.querySelector(':scope > div') || overlay;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        let lastFocused = null;

        const isOpen = () => !overlay.classList.contains('hidden');

        const trap = (e) => {
            if (e.key === 'Escape') {
                // Prefer the app's own cancel path (overlay click closes it).
                overlay.click();
                return;
            }
            if (e.key !== 'Tab') return;
            const f = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        // React to open/close toggles on the .hidden class.
        new MutationObserver(() => {
            if (isOpen()) {
                lastFocused = document.activeElement;
                document.addEventListener('keydown', trap, true);
                const f = dialog.querySelector(FOCUSABLE);
                if (f) setTimeout(() => f.focus(), 0);
            } else {
                document.removeEventListener('keydown', trap, true);
                if (lastFocused && lastFocused.focus) lastFocused.focus();
            }
        }).observe(overlay, {attributes: true, attributeFilter: ['class']});
    }

    function init() {
        document.querySelectorAll('[role="tablist"]').forEach(enhanceTablist);
        document.querySelectorAll('.modal-overlay').forEach(enhanceModal);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
