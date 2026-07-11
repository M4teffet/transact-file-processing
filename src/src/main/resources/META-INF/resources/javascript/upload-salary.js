// upload-salary.js — billing (facturation) selector shown after a payroll upload.
// Talks to GET/POST /api/v1/batches/{id}/billing (preview + persist).
(function () {
    const API = "/api/v1";
    const sfetch = window.secureFetch || ((u, o) => fetch(u, Object.assign({credentials: "same-origin"}, o || {})));

    let batchId = null;
    let mode = "NONE";

    const $ = (id) => document.getElementById(id);
    const fmt = (v) => {
        if (v === null || v === undefined || v === "") return "—";
        const n = Number(v);
        return isNaN(n) ? String(v) : n.toLocaleString("fr-FR");
    };

    function setMsg(text, ok) {
        const el = $("billingMsg");
        if (!el) return;
        el.textContent = text || "";
        el.style.color = ok ? "var(--status-success-text)" : "var(--ink-3)";
    }

    function highlightActive() {
        document.querySelectorAll(".billing-mode-btn").forEach((b) => {
            const on = b.dataset.mode === mode;
            b.classList.toggle("btn-flux-primary", on);
        });
        $("flatFeeWrap")?.classList.toggle("hidden", mode !== "FLAT");
    }

    async function preview() {
        if (!batchId) return;
        const flat = $("flatFeeInput")?.value;
        const params = new URLSearchParams({mode});
        if (mode === "FLAT" && flat) params.set("flatFee", flat);
        try {
            const res = await sfetch(`${API}/batches/${batchId}/billing?${params}`);
            if (!res || !res.ok) throw new Error("preview failed");
            const b = await res.json();
            $("bpZ").textContent = fmt(b.netTotalZ);
            $("bpX").textContent = fmt(b.externalCount);
            $("bpFees").textContent = fmt(b.feesTotal);
            $("bpA").textContent = fmt(b.grandTotalA);
            // Confirm allowed unless FLAT with no positive fee
            const flatOk = mode !== "FLAT" || (Number(flat) > 0);
            $("confirmBillingBtn").disabled = !flatOk;
        } catch (e) {
            setMsg("Impossible de calculer l'aperçu.", false);
        }
    }

    async function confirm() {
        if (!batchId) return;
        const btn = $("confirmBillingBtn");
        const flat = $("flatFeeInput")?.value;
        const body = {billingMode: mode};
        if (mode === "FLAT") body.flatFeeAmount = Number(flat);
        btn.disabled = true;
        try {
            const res = await sfetch(`${API}/batches/${batchId}/billing`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || data.detail || "Erreur");
            setMsg("Mode de facturation enregistré (" + mode + "). Le lot peut être validé.", true);
        } catch (e) {
            setMsg("Échec de l'enregistrement : " + e.message, false);
            btn.disabled = false;
        }
    }

    function wire() {
        document.querySelectorAll(".billing-mode-btn").forEach((b) => {
            b.addEventListener("click", () => {
                mode = b.dataset.mode;
                highlightActive();
                preview();
            });
        });
        let t;
        $("flatFeeInput")?.addEventListener("input", () => {
            clearTimeout(t);
            t = setTimeout(preview, 350);
        });
        $("confirmBillingBtn")?.addEventListener("click", confirm);
    }

    document.addEventListener("flux:uploaded", (e) => {
        if (!e.detail || e.detail.application !== "VIREMENT_SALAIRE") return;
        batchId = e.detail.batchId;
        mode = "NONE";
        highlightActive();
        preview();
        setMsg("");
        if (window.lucide) window.lucide.createIcons();
    });

    document.addEventListener("DOMContentLoaded", wire);
})();
