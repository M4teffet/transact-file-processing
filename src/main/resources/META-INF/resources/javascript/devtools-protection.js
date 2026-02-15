/**
 * ============================================================================
 * devtools-protection.js - Protection contre l'inspection
 * ============================================================================
 *
 * AVERTISSEMENT : Aucune protection côté client n'est 100% infaillible.
 * Ces mesures rendent l'inspection plus difficile mais pas impossible.
 * La vraie sécurité doit être côté serveur.
 */

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════

    const CONFIG = {
        redirectUrl: '/access-denied.html',  // Page de redirection
        showWarning: true,                    // Afficher un avertissement
        blockContextMenu: true,               // Bloquer clic droit
        blockKeyboardShortcuts: true,         // Bloquer raccourcis clavier
        blockF12: true,                       // Bloquer F12
        detectDevTools: true,                 // Détecter DevTools ouvert
        clearConsole: true,                   // Nettoyer la console
        disableDebugger: true                 // Désactiver debugger
    };

    // ═══════════════════════════════════════════════════════════
    // 1. BLOQUER CLIC DROIT (CONTEXT MENU)
    // ═══════════════════════════════════════════════════════════

    if (CONFIG.blockContextMenu) {
        document.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            if (CONFIG.showWarning) {
                showWarning('Le clic droit est désactivé');
            }
            return false;
        }, false);
    }

    // ═══════════════════════════════════════════════════════════
    // 2. BLOQUER RACCOURCIS CLAVIER
    // ═══════════════════════════════════════════════════════════

    if (CONFIG.blockKeyboardShortcuts) {
        document.addEventListener('keydown', function(e) {
            // F12 - Developer Tools
            if (e.keyCode === 123) {
                e.preventDefault();
                if (CONFIG.showWarning) {
                    showWarning('Action non autorisée');
                }
                return false;
            }

            // Ctrl+Shift+I - Inspect Element
            if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
                e.preventDefault();
                return false;
            }

            // Ctrl+Shift+J - Console
            if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
                e.preventDefault();
                return false;
            }

            // Ctrl+Shift+C - Inspect Element (alternative)
            if (e.ctrlKey && e.shiftKey && e.keyCode === 67) {
                e.preventDefault();
                return false;
            }

            // Ctrl+U - View Source
            if (e.ctrlKey && e.keyCode === 85) {
                e.preventDefault();
                return false;
            }

            // Ctrl+S - Save Page
            if (e.ctrlKey && e.keyCode === 83) {
                e.preventDefault();
                return false;
            }

            // F12 (alternative check)
            if (e.key === 'F12') {
                e.preventDefault();
                return false;
            }

            // Cmd+Option+I (Mac)
            if (e.metaKey && e.altKey && e.keyCode === 73) {
                e.preventDefault();
                return false;
            }

            // Cmd+Option+J (Mac)
            if (e.metaKey && e.altKey && e.keyCode === 74) {
                e.preventDefault();
                return false;
            }

            // Cmd+Option+C (Mac)
            if (e.metaKey && e.altKey && e.keyCode === 67) {
                e.preventDefault();
                return false;
            }
        }, false);
    }

    // ═══════════════════════════════════════════════════════════
    // 3. DÉTECTION DEVTOOLS OUVERT
    // ═══════════════════════════════════════════════════════════

    if (CONFIG.detectDevTools) {
        // Méthode 1: Détection par timing
        let devtoolsOpen = false;
        const element = new Image();

        Object.defineProperty(element, 'id', {
            get: function() {
                devtoolsOpen = true;
                handleDevToolsDetected();
                throw new Error('DevTools détecté');
            }
        });

        setInterval(function() {
            devtoolsOpen = false;
            console.log(element);
            console.clear();
        }, 1000);

        // Méthode 2: Détection par taille de fenêtre
        const threshold = 160;
        let lastWidth = window.outerWidth - window.innerWidth;
        let lastHeight = window.outerHeight - window.innerHeight;

        setInterval(function() {
            const widthDiff = window.outerWidth - window.innerWidth;
            const heightDiff = window.outerHeight - window.innerHeight;

            if (widthDiff > threshold || heightDiff > threshold) {
                if (widthDiff !== lastWidth || heightDiff !== lastHeight) {
                    handleDevToolsDetected();
                }
            }

            lastWidth = widthDiff;
            lastHeight = heightDiff;
        }, 500);

        // Méthode 3: Détection par debugger
        if (CONFIG.disableDebugger) {
            setInterval(function() {
                (function() {
                    return false;
                })['constructor']('debugger')();
            }, 50);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 4. NETTOYER LA CONSOLE
    // ═══════════════════════════════════════════════════════════

    if (CONFIG.clearConsole) {
        // Nettoyer toutes les 100ms
        setInterval(function() {
            console.clear();
        }, 100);

        // Surcharger console.log
        const noop = function() {};
        console.log = noop;
        console.warn = noop;
        console.error = noop;
        console.info = noop;
        console.debug = noop;
    }

    // ═══════════════════════════════════════════════════════════
    // 7. DÉSACTIVER DRAG & DROP (sauf pour upload)
    // ═══════════════════════════════════════════════════════════

    document.addEventListener('dragstart', function(e) {
        // Autoriser drag pour les zones d'upload
        if (e.target.closest('[data-allow-drag]')) {
            return true;
        }
        e.preventDefault();
        return false;
    }, false);

    // ═══════════════════════════════════════════════════════════
    // HANDLERS
    // ═══════════════════════════════════════════════════════════

    function handleDevToolsDetected() {
        if (CONFIG.redirectUrl) {
            // Option 1: Redirection
            window.location.href = CONFIG.redirectUrl;
        } else {
            // Option 2: Bloquer l'interface
            document.body.innerHTML = `
                <div style="
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: #1a1a1a;
                    color: #fff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: Arial, sans-serif;
                    z-index: 999999;
                ">
                    <div style="text-align: center;">
                        <h1 style="font-size: 48px; margin-bottom: 20px;">⚠️</h1>
                        <h2 style="font-size: 24px; margin-bottom: 10px;">Accès Non Autorisé</h2>
                        <p style="font-size: 16px; color: #999;">
                            Les outils de développement ne sont pas autorisés sur cette application.
                        </p>
                    </div>
                </div>
            `;
        }
    }

    function showWarning(message) {
        // Use existing snackbar system if available
        if (typeof window.showSnackbar === 'function') {
            window.showSnackbar(message, 'error');
        } else {
            // Fallback to console warning if snackbar not loaded yet
            console.warn('⚠️ ' + message);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PROTECTION CONTRE LA MODIFICATION DE CE SCRIPT
    // ═══════════════════════════════════════════════════════════

    Object.freeze(CONFIG);

    console.log('%c⚠️ AVERTISSEMENT', 'color: red; font-size: 24px; font-weight: bold;');
    console.log('%cL\'utilisation de cette console peut compromettre la sécurité de votre compte.', 'font-size: 16px;');
    console.log('%cNe collez aucun code ici sauf si vous savez exactement ce que vous faites.', 'font-size: 14px; color: orange;');

})();