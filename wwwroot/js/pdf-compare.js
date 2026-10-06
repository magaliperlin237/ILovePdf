document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);

    const SCALE = 1.5;                 // pixels par point PDF pour la comparaison
    const SIZE_TOLERANCE_PT = 1;       // écart de dimensions toléré (points)
    const MAX_LCS_CELLS = 16000000;    // au-delà, le diff de texte devient grossier

    const alertBox = $('cmp-alert');
    const runBtn = $('cmp-run');
    const swapBtn = $('cmp-swap');
    const progress = $('cmp-progress');
    const results = $('cmp-results');
    const tableBody = $('cmp-table-body');
    const detail = $('cmp-detail');
    const tolerance = $('cmp-tolerance');
    const threshold = $('cmp-threshold');

    const slots = { A: { file: null, doc: null }, B: { file: null, doc: null } };
    let report = null;        // résultat de la dernière comparaison
    let currentPage = null;   // page affichée en détail
    let currentView = 'diff';
    let detailToken = 0;

    /* ---------- utilitaires ---------- */

    const showAlert = m => { alertBox.textContent = m; alertBox.classList.remove('d-none'); };
    const hideAlert = () => { alertBox.textContent = ''; alertBox.classList.add('d-none'); };
    const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    function formatBytes(bytes) {
        if (!bytes) return '0 Octets';
        const k = 1024, sizes = ['Octets', 'Ko', 'Mo', 'Go'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function formatPercent(p) {
        if (p === 0) return '0 %';
        if (p < 0.01) return '< 0,01 %';
        return p.toFixed(2).replace('.', ',') + ' %';
    }

    /* ---------- chargement des fichiers ---------- */

    document.querySelectorAll('[data-choose]').forEach(btn =>
        btn.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelector(`[data-input="${btn.dataset.choose}"]`).click();
        }));

    document.querySelectorAll('[data-input]').forEach(input =>
        input.addEventListener('change', () => {
            loadSlot(input.dataset.input, input.files[0]);
            input.value = '';
        }));

    document.querySelectorAll('.cmp-slot').forEach(zone => {
        ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
            e.preventDefault(); zone.classList.add('dragover');
        }));
        ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
            e.preventDefault(); zone.classList.remove('dragover');
        }));
        zone.addEventListener('drop', e => loadSlot(zone.dataset.slot, e.dataTransfer.files[0]));
    });

    async function loadSlot(key, file) {
        hideAlert();
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.pdf')) {
            showAlert('Veuillez sélectionner un fichier PDF.'); return;
        }
        if (file.size > window.compareConfig.maxFileSizeMb * 1024 * 1024) {
            showAlert(`"${file.name}" dépasse la limite de ${window.compareConfig.maxFileSizeMb} Mo.`); return;
        }

        try {
            const data = await file.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data }).promise;
            slots[key].doc?.destroy?.();
            slots[key] = { file, doc };
            invalidateResults();
            refreshSlots();
        } catch (err) {
            console.error(err);
            showAlert(`Impossible de lire "${file.name}". Il est peut-être corrompu ou protégé par mot de passe.`);
        }
    }

    function refreshSlots() {
        ['A', 'B'].forEach(key => {
            const info = document.querySelector(`[data-info="${key}"]`);
            const s = slots[key];
            if (s.file) {
                info.textContent = `${s.file.name} · ${formatBytes(s.file.size)} · ${s.doc.numPages} page(s)`;
                info.classList.remove('d-none');
            } else {
                info.classList.add('d-none');
            }
        });
        const ready = !!(slots.A.doc && slots.B.doc);
        runBtn.disabled = !ready;
        swapBtn.disabled = !ready;
    }

    function invalidateResults() {
        report = null;
        currentPage = null;
        results.classList.add('d-none');
        detail.classList.add('d-none');
        tableBody.innerHTML = '';
    }

    swapBtn.addEventListener('click', () => {
        [slots.A, slots.B] = [slots.B, slots.A];
        invalidateResults();
        refreshSlots();
    });

    tolerance.addEventListener('input', () => { $('cmp-tolerance-value').textContent = tolerance.value; });

    /* ---------- rendu et comparaison des pixels ---------- */

    function pageSize(page) {
        const vp = page.getViewport({ scale: 1 });
        return { w: vp.width, h: vp.height };
    }

    async function renderInto(canvas, page, W, H) {
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: SCALE }) }).promise;
        return ctx;
    }

    function canvasSizeFor(pa, pb) {
        const a = pageSize(pa), b = pageSize(pb);
        return {
            W: Math.ceil(Math.max(a.w, b.w) * SCALE),
            H: Math.ceil(Math.max(a.h, b.h) * SCALE),
            sizeDiffers: Math.abs(a.w - b.w) > SIZE_TOLERANCE_PT || Math.abs(a.h - b.h) > SIZE_TOLERANCE_PT
        };
    }

    /**
     * Compare deux canvas de même taille. Retourne le nombre de pixels différents et,
     * si `out` est fourni, y dessine l'image des différences (rouge = seulement dans A, vert = seulement dans B).
     */
    function comparePixels(ctxA, ctxB, W, H, tol, out) {
        const a = ctxA.getImageData(0, 0, W, H).data;
        const b = ctxB.getImageData(0, 0, W, H).data;
        let outData = null, outImage = null;

        if (out) {
            out.width = W; out.height = H;
            const octx = out.getContext('2d');
            outImage = octx.createImageData(W, H);
            outData = outImage.data;
        }

        let count = 0;
        for (let i = 0; i < a.length; i += 4) {
            const dr = Math.abs(a[i] - b[i]);
            const dg = Math.abs(a[i + 1] - b[i + 1]);
            const db = Math.abs(a[i + 2] - b[i + 2]);
            const different = (dr > tol || dg > tol || db > tol);

            if (different) count++;

            if (outData) {
                if (different) {
                    const lumA = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
                    const lumB = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
                    if (lumA < lumB) { outData[i] = 220; outData[i + 1] = 53; outData[i + 2] = 69; }     // supprimé dans B
                    else { outData[i] = 25; outData[i + 1] = 135; outData[i + 2] = 84; }                  // ajouté dans B
                } else {
                    // Fond : page B très estompée pour garder le contexte
                    const lumB = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
                    const v = 255 - (255 - lumB) * 0.22;
                    outData[i] = outData[i + 1] = outData[i + 2] = v;
                }
                outData[i + 3] = 255;
            }
        }

        if (out) out.getContext('2d').putImageData(outImage, 0, 0);
        return count;
    }

    /* ---------- texte ---------- */

    async function pageWords(page) {
        const content = await page.getTextContent();
        const text = content.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('');
        return text.split(/\s+/).filter(Boolean);
    }

    function diffWords(a, b) {
        let start = 0;
        while (start < a.length && start < b.length && a[start] === b[start]) start++;
        let endA = a.length, endB = b.length;
        while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

        const A = a.slice(start, endA), B = b.slice(start, endB);
        const ops = [];
        for (let i = 0; i < start; i++) ops.push({ t: 'eq', w: a[i] });

        const n = A.length, m = B.length;
        if (n === 0) {
            B.forEach(w => ops.push({ t: 'ins', w }));
        } else if (m === 0) {
            A.forEach(w => ops.push({ t: 'del', w }));
        } else if (n * m > MAX_LCS_CELLS) {
            A.forEach(w => ops.push({ t: 'del', w }));
            B.forEach(w => ops.push({ t: 'ins', w }));
        } else {
            const cols = m + 1;
            const dp = new Uint16Array((n + 1) * cols);
            for (let i = n - 1; i >= 0; i--) {
                for (let j = m - 1; j >= 0; j--) {
                    dp[i * cols + j] = A[i] === B[j]
                        ? dp[(i + 1) * cols + j + 1] + 1
                        : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
                }
            }
            let i = 0, j = 0;
            while (i < n && j < m) {
                if (A[i] === B[j]) { ops.push({ t: 'eq', w: A[i] }); i++; j++; }
                else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) { ops.push({ t: 'del', w: A[i] }); i++; }
                else { ops.push({ t: 'ins', w: B[j] }); j++; }
            }
            while (i < n) ops.push({ t: 'del', w: A[i++] });
            while (j < m) ops.push({ t: 'ins', w: B[j++] });
        }

        for (let i = endA; i < a.length; i++) ops.push({ t: 'eq', w: a[i] });

        return {
            ops,
            added: ops.filter(o => o.t === 'ins').length,
            removed: ops.filter(o => o.t === 'del').length
        };
    }

    /* ---------- lancement de la comparaison ---------- */

    runBtn.addEventListener('click', runComparison);

    async function runComparison() {
        hideAlert();
        if (!slots.A.doc || !slots.B.doc) return;

        const tol = parseInt(tolerance.value, 10);
        const thr = parseFloat(threshold.value);
        const nA = slots.A.doc.numPages, nB = slots.B.doc.numPages;
        const total = Math.max(nA, nB);

        invalidateResults();
        progress.classList.remove('d-none');
        runBtn.disabled = swapBtn.disabled = true;

        const cA = document.createElement('canvas');
        const cB = document.createElement('canvas');
        const pages = [];

        try {
            for (let p = 1; p <= total; p++) {
                $('cmp-progress-text').textContent = `Comparaison de la page ${p} / ${total}...`;
                await new Promise(r => setTimeout(r));   // laisse le navigateur respirer

                const entry = { page: p };
                const pa = p <= nA ? await slots.A.doc.getPage(p) : null;
                const pb = p <= nB ? await slots.B.doc.getPage(p) : null;

                if (!pa || !pb) {
                    entry.missing = pa ? 'B' : 'A';
                    const only = pa || pb;
                    entry.words = (await pageWords(only)).length;
                    pages.push(entry);
                    continue;
                }

                const { W, H, sizeDiffers } = canvasSizeFor(pa, pb);
                const ctxA = await renderInto(cA, pa, W, H);
                const ctxB = await renderInto(cB, pb, W, H);
                const diffPixels = comparePixels(ctxA, ctxB, W, H, tol, null);
                const diffPercent = diffPixels / (W * H) * 100;

                const wordsA = await pageWords(pa);
                const wordsB = await pageWords(pb);
                const td = diffWords(wordsA, wordsB);

                Object.assign(entry, {
                    sizeDiffers,
                    diffPixels,
                    diffPercent,
                    visualDiff: sizeDiffers || diffPercent > thr,
                    wordsA: wordsA.length,
                    wordsB: wordsB.length,
                    added: td.added,
                    removed: td.removed,
                    textDiff: td.added + td.removed > 0
                });
                pages.push(entry);
            }
        } catch (err) {
            console.error(err);
            showAlert('La comparaison a échoué sur ce document.');
            return;
        } finally {
            progress.classList.add('d-none');
            cA.width = cA.height = cB.width = cB.height = 0;
            runBtn.disabled = swapBtn.disabled = false;
        }

        report = { tol, thr, nA, nB, pages };
        renderSummary();
    }

    /* ---------- tableau de synthèse ---------- */

    const isIdentical = e => !e.missing && !e.visualDiff && !e.textDiff;

    function renderSummary() {
        const { pages, nA, nB } = report;
        const identical = pages.filter(isIdentical).length;
        const allSame = identical === pages.length && nA === nB;

        const verdict = $('cmp-verdict');
        verdict.className = `alert shadow-sm d-flex flex-wrap justify-content-between align-items-center gap-2 ${allSame ? 'alert-success' : 'alert-warning'}`;
        verdict.innerHTML = `
            <div>
                <i class="bi ${allSame ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} me-2"></i>
                <strong>${allSame ? 'Les deux documents sont identiques.' : 'Des différences ont été détectées.'}</strong>
                <span class="ms-2">${identical} page(s) identique(s) sur ${pages.length}${nA !== nB ? ` · A : ${nA} page(s), B : ${nB} page(s)` : ''}</span>
            </div>
            <button type="button" id="cmp-download-report" class="btn btn-sm btn-outline-dark">
                <i class="bi bi-filetype-json me-1"></i>Télécharger le rapport (JSON)
            </button>`;
        $('cmp-download-report').addEventListener('click', downloadReport);

        tableBody.innerHTML = '';
        pages.forEach(e => {
            const tr = document.createElement('tr');
            tr.dataset.page = e.page;

            let visual, text;
            if (e.missing) {
                visual = `<span class="badge bg-secondary">Page absente de ${e.missing}</span>`;
                text = `<span class="text-muted small">${e.words} mot(s) dans ${e.missing === 'A' ? 'B' : 'A'}</span>`;
            } else {
                visual = e.visualDiff
                    ? `<span class="badge bg-danger">Différent</span> <span class="small text-muted">${e.sizeDiffers ? 'dimensions différentes' : formatPercent(e.diffPercent)}</span>`
                    : `<span class="badge bg-success">Identique</span>`;

                if (e.wordsA === 0 && e.wordsB === 0) text = `<span class="badge bg-light text-dark border">Aucun texte</span>`;
                else if (e.textDiff) text = `<span class="badge bg-danger">Différent</span> <span class="small"><span class="text-success">+${e.added}</span> <span class="text-danger">−${e.removed}</span></span>`;
                else text = `<span class="badge bg-success">Identique</span>`;
            }

            tr.innerHTML = `
                <td class="fw-bold">${e.page}</td>
                <td>${visual}</td>
                <td>${text}</td>
                <td class="text-end">${e.missing ? '' : '<button type="button" class="btn btn-sm btn-outline-danger">Détails</button>'}</td>`;

            if (!e.missing) {
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => openDetail(e.page));
            }
            tableBody.appendChild(tr);
        });

        results.classList.remove('d-none');

        // Ouvre directement la première page qui diffère (ou la première page)
        const firstDiff = pages.find(e => !e.missing && !isIdentical(e)) || pages.find(e => !e.missing);
        if (firstDiff) openDetail(firstDiff.page, false);
    }

    function downloadReport() {
        if (!report) return;
        const data = {
            fichierA: slots.A.file.name,
            fichierB: slots.B.file.name,
            pagesA: report.nA,
            pagesB: report.nB,
            toleranceCouleur: report.tol,
            seuilPourcent: report.thr,
            identique: report.pages.every(isIdentical) && report.nA === report.nB,
            pages: report.pages.map(e => e.missing
                ? { page: e.page, statut: `absente_de_${e.missing}` }
                : {
                    page: e.page,
                    visuelDifferent: e.visualDiff,
                    dimensionsDifferentes: e.sizeDiffers,
                    pixelsDifferents: e.diffPixels,
                    pourcentageDifferent: Number(e.diffPercent.toFixed(4)),
                    texteDifferent: e.textDiff,
                    motsAjoutes: e.added,
                    motsSupprimes: e.removed
                })
        };
        downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'rapport_comparaison.json');
    }

    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    }

    /* ---------- détail d'une page ---------- */

    const cvA = $('cmp-canvas-a'), cvB = $('cmp-canvas-b');
    const cvDiff = $('cmp-canvas-diff'), cvBlend = $('cmp-canvas-blend');
    const blendSlider = $('cmp-blend');

    document.querySelectorAll('[data-view]').forEach(btn =>
        btn.addEventListener('click', () => setView(btn.dataset.view)));

    function setView(view) {
        currentView = view;
        document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
        document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('d-none', p.dataset.pane !== view));
    }

    $('cmp-prev').addEventListener('click', () => stepPage(-1));
    $('cmp-next').addEventListener('click', () => stepPage(1));

    function stepPage(delta) {
        if (!report || currentPage == null) return;
        const candidates = report.pages.filter(e => !e.missing).map(e => e.page);
        const idx = candidates.indexOf(currentPage) + delta;
        if (idx >= 0 && idx < candidates.length) openDetail(candidates[idx]);
    }

    async function openDetail(pageNumber, scroll = true) {
        if (!report) return;
        const token = ++detailToken;
        currentPage = pageNumber;

        tableBody.querySelectorAll('tr').forEach(tr =>
            tr.classList.toggle('table-active', Number(tr.dataset.page) === pageNumber));

        detail.classList.remove('d-none');
        $('cmp-page-label').textContent = `Page ${pageNumber} / ${Math.max(report.nA, report.nB)}`;
        $('cmp-detail-loading').classList.remove('d-none');
        setView(currentView);
        if (scroll) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });

        const pa = await slots.A.doc.getPage(pageNumber);
        const pb = await slots.B.doc.getPage(pageNumber);
        const { W, H } = canvasSizeFor(pa, pb);

        const ctxA = await renderInto(cvA, pa, W, H);
        const ctxB = await renderInto(cvB, pb, W, H);
        if (token !== detailToken) return;

        comparePixels(ctxA, ctxB, W, H, report.tol, cvDiff);
        drawBlend();

        const [wa, wb] = await Promise.all([pageWords(pa), pageWords(pb)]);
        if (token !== detailToken) return;
        renderTextDiff(diffWords(wa, wb), wa.length + wb.length === 0);

        $('cmp-detail-loading').classList.add('d-none');
    }

    function drawBlend() {
        if (!cvA.width) return;
        cvBlend.width = cvA.width;
        cvBlend.height = cvA.height;
        const ctx = cvBlend.getContext('2d');
        const t = parseInt(blendSlider.value, 10) / 100;
        ctx.globalAlpha = 1;
        ctx.drawImage(cvA, 0, 0);
        ctx.globalAlpha = t;
        ctx.drawImage(cvB, 0, 0);
        ctx.globalAlpha = 1;
    }
    blendSlider.addEventListener('input', drawBlend);

    function renderTextDiff(td, noText) {
        const summary = $('cmp-text-summary');
        const box = $('cmp-text-diff');

        if (noText) {
            summary.textContent = '';
            box.innerHTML = '<span class="text-muted">Aucun texte extractible sur cette page (page scannée ou composée d’images).</span>';
            return;
        }

        summary.innerHTML = td.added + td.removed === 0
            ? '<span class="text-success"><i class="bi bi-check-circle me-1"></i>Le texte est identique.</span>'
            : `<span class="text-success">+${td.added} mot(s) ajouté(s)</span> · <span class="text-danger">−${td.removed} mot(s) supprimé(s)</span>`;

        box.innerHTML = td.ops.map(o => {
            const w = escapeHtml(o.w);
            if (o.t === 'del') return `<del>${w}</del>`;
            if (o.t === 'ins') return `<ins>${w}</ins>`;
            return w;
        }).join(' ');
    }

    $('cmp-download-diff').addEventListener('click', () => {
        if (!cvDiff.width) return;
        cvDiff.toBlob(blob => blob && downloadBlob(blob, `differences_page_${currentPage}.png`), 'image/png');
    });

    refreshSlots();
});
