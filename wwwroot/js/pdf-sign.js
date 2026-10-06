document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const form = $('signForm');
    const dropZone = $('dropZone');
    const fileInput = $('pdfFile');
    const fileInfo = $('fileInfo');
    const penColor = $('penColor');
    const pad = $('drawPad');
    const typeText = $('typeText');
    const typeFont = $('typeFont');
    const typeCanvas = $('typeCanvas');
    const importFile = $('importFile');
    const importCanvas = $('importCanvas');
    const removeBg = $('removeBg');
    const activeSig = $('activeSig');
    const sigPreview = $('sigPreview');
    const remember = $('remember');
    const addBtn = $('addBtn');
    const copyAllBtn = $('copyAllBtn');
    const removeBtn = $('removeBtn');
    const clearBtn = $('clearBtn');
    const summary = $('placementSummary');
    const submit = $('submitBtn');
    const alertBox = $('alert');
    const placeholder = $('previewPlaceholder');
    const stage = $('stage');
    const stageHelp = $('stageHelp');
    const pageCanvas = $('pageCanvas');
    const layer = $('signLayer');
    const pageNav = $('pageNav');
    const pageLabel = $('pageLabel');

    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const STAGE_WIDTH = 700;
    const SIG_MAX_WIDTH = 1000;
    const STORAGE_KEY = 'pdftools.signature';

    let selectedFile = null;
    let pdfDoc = null;
    let pageCount = 0;
    let currentPage = 1;
    let renderToken = 0;
    const pageDims = {};   // numéro de page -> { w, h } (points, page affichée)
    let signature = null;  // { dataUrl, w, h }
    let placements = [];   // { id, page, x, y, w } (fractions de la page)
    let selectedId = null;
    let nextId = 1;

    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

    /* =====================  1. DOCUMENT  ===================== */

    $('chooseFile').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
    dropZone.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

    async function setFile(file) {
        if (!file) return;
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            showAlert('Veuillez sélectionner un fichier PDF.', 'danger');
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            showAlert('Le fichier dépasse la taille maximale de 50 Mo.', 'danger');
            return;
        }

        hideAlert();
        try {
            const data = await file.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data }).promise;
            pdfDoc?.destroy?.();
            pdfDoc = doc;
            pageCount = doc.numPages;
            selectedFile = file;
            currentPage = 1;
            placements = [];
            selectedId = null;
            Object.keys(pageDims).forEach(k => delete pageDims[k]);

            fileInfo.textContent = `${file.name} — ${(file.size / 1024 / 1024).toFixed(2)} Mo · ${pageCount} page(s)`;
            fileInfo.classList.remove('d-none');
            placeholder.classList.add('d-none');
            stage.classList.remove('d-none');
            stageHelp.classList.remove('d-none');
            pageNav.classList.toggle('d-none', pageCount < 2);

            await renderPage();
            refresh();
        } catch (err) {
            console.error(err);
            showAlert('Impossible de lire ce PDF. Il est peut-être corrompu ou protégé par mot de passe.', 'danger');
        }
    }

    async function ensureDims(n) {
        if (pageDims[n]) return pageDims[n];
        const page = await pdfDoc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        pageDims[n] = { w: vp.width, h: vp.height };
        return pageDims[n];
    }

    async function renderPage() {
        const token = ++renderToken;
        const page = await pdfDoc.getPage(currentPage);
        const base = page.getViewport({ scale: 1 });
        pageDims[currentPage] = { w: base.width, h: base.height };
        const viewport = page.getViewport({ scale: STAGE_WIDTH / base.width });
        if (token !== renderToken) return;
        pageCanvas.width = Math.floor(viewport.width);
        pageCanvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: pageCanvas.getContext('2d'), viewport }).promise;
        pageLabel.textContent = `${currentPage} / ${pageCount}`;
        renderOverlay();
    }

    $('prevPage').addEventListener('click', () => changePage(-1));
    $('nextPage').addEventListener('click', () => changePage(1));

    async function changePage(delta) {
        if (!pdfDoc) return;
        const n = clamp(currentPage + delta, 1, pageCount);
        if (n === currentPage) return;
        currentPage = n;
        await renderPage();
        refresh();
    }

    /* =====================  2. SIGNATURE  ===================== */

    const activeTab = () => document.querySelector('#sigTabs .nav-link.active').id;

    /* ---- onglet « Dessiner » ---- */

    const pctx = pad.getContext('2d');
    let drawing = false;
    let prev = null;
    let prevMid = null;
    let hasInk = false;

    function padPoint(e) {
        const r = pad.getBoundingClientRect();
        return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height };
    }

    pad.addEventListener('pointerdown', e => {
        e.preventDefault();
        pad.setPointerCapture(e.pointerId);
        drawing = true;
        const p = padPoint(e);
        prev = prevMid = p;
        pctx.fillStyle = penColor.value;
        pctx.beginPath();
        pctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        pctx.fill();
        hasInk = true;
    });

    pad.addEventListener('pointermove', e => {
        if (!drawing) return;
        const p = padPoint(e);
        const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
        pctx.strokeStyle = penColor.value;
        pctx.lineWidth = 4;
        pctx.lineCap = 'round';
        pctx.lineJoin = 'round';
        pctx.beginPath();
        pctx.moveTo(prevMid.x, prevMid.y);
        pctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
        pctx.stroke();
        prev = p;
        prevMid = mid;
    });

    ['pointerup', 'pointercancel'].forEach(ev => pad.addEventListener(ev, () => { drawing = false; }));

    $('clearPad').addEventListener('click', () => {
        pctx.clearRect(0, 0, pad.width, pad.height);
        hasInk = false;
    });

    /* ---- onglet « Taper » ---- */

    async function renderTyped() {
        const ctx = typeCanvas.getContext('2d');
        ctx.clearRect(0, 0, typeCanvas.width, typeCanvas.height);
        const text = typeText.value.trim();
        if (!text) return;

        const family = typeFont.value;
        try { await document.fonts.load(`600 80px "${family}"`); } catch { /* police de secours */ }

        let size = 96;
        ctx.font = `600 ${size}px "${family}", cursive`;
        const maxWidth = typeCanvas.width - 40;
        const measured = ctx.measureText(text).width;
        if (measured > maxWidth) {
            size = Math.max(24, Math.floor(size * maxWidth / measured));
            ctx.font = `600 ${size}px "${family}", cursive`;
        }
        ctx.fillStyle = penColor.value;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, typeCanvas.width / 2, typeCanvas.height / 2);
    }

    typeText.addEventListener('input', renderTyped);
    typeFont.addEventListener('change', renderTyped);
    penColor.addEventListener('change', renderTyped);

    /* ---- onglet « Importer » ---- */

    let importedImage = null;

    importFile.addEventListener('change', () => {
        const file = importFile.files[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
            showAlert('Importez une image PNG, JPEG ou WebP.', 'danger');
            return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { importedImage = img; URL.revokeObjectURL(url); renderImported(); };
        img.onerror = () => { URL.revokeObjectURL(url); showAlert('Cette image ne peut pas être lue.', 'danger'); };
        img.src = url;
    });

    removeBg.addEventListener('change', renderImported);

    function renderImported() {
        const ctx = importCanvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, importCanvas.width, importCanvas.height);
        if (!importedImage) return;

        const scale = Math.min(importCanvas.width / importedImage.naturalWidth, importCanvas.height / importedImage.naturalHeight, 1);
        const w = Math.max(1, Math.round(importedImage.naturalWidth * scale));
        const h = Math.max(1, Math.round(importedImage.naturalHeight * scale));
        const x = Math.round((importCanvas.width - w) / 2);
        const y = Math.round((importCanvas.height - h) / 2);
        ctx.drawImage(importedImage, x, y, w, h);

        if (removeBg.checked) {
            const data = ctx.getImageData(x, y, w, h);
            const d = data.data;
            for (let i = 0; i < d.length; i += 4) {
                const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
                if (lum >= 240) d[i + 3] = 0;
                else if (lum > 195) d[i + 3] = Math.round(d[i + 3] * (240 - lum) / 45);
            }
            ctx.putImageData(data, x, y);
        }
    }

    /* ---- validation de la signature ---- */

    // Recadre sur la zone dessinée ; renvoie null si le canvas est vide.
    function trimCanvas(source) {
        const ctx = source.getContext('2d', { willReadFrequently: true });
        const { width, height } = source;
        const d = ctx.getImageData(0, 0, width, height).data;
        let minX = width, minY = height, maxX = -1, maxY = -1;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (d[(y * width + x) * 4 + 3] > 12) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return null;

        const pad = 6;
        minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
        maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);

        let w = maxX - minX + 1;
        let h = maxY - minY + 1;
        const scale = Math.min(1, SIG_MAX_WIDTH / w);
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(w * scale));
        out.height = Math.max(1, Math.round(h * scale));
        out.getContext('2d').drawImage(source, minX, minY, w, h, 0, 0, out.width, out.height);
        return out;
    }

    $('useSignature').addEventListener('click', async () => {
        hideAlert();
        const tab = activeTab();
        if (tab === 'tabTypeBtn') await renderTyped();

        const source = tab === 'tabDrawBtn' ? pad : tab === 'tabTypeBtn' ? typeCanvas : importCanvas;
        const trimmed = trimCanvas(source);
        if (!trimmed) {
            showAlert(tab === 'tabDrawBtn' ? 'Dessinez votre signature dans le cadre.'
                : tab === 'tabTypeBtn' ? 'Tapez votre nom pour générer une signature.'
                : 'Importez d’abord une image de votre signature.', 'warning');
            return;
        }
        setSignature({ dataUrl: trimmed.toDataURL('image/png'), w: trimmed.width, h: trimmed.height });
    });

    function setSignature(sig) {
        signature = sig;
        sigPreview.src = sig.dataUrl;
        activeSig.classList.remove('d-none');
        if (remember.checked) saveSignature();
        renderOverlay();
        refresh();
    }

    /* ---- mémorisation locale (facultative) ---- */

    function saveSignature() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(signature)); } catch { /* stockage indisponible */ }
    }

    remember.addEventListener('change', () => {
        if (remember.checked) saveSignature();
        else { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignoré */ } }
    });

    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (stored && typeof stored.dataUrl === 'string' && stored.dataUrl.startsWith('data:image/png') && stored.w > 0 && stored.h > 0) {
            remember.checked = true;
            setSignature(stored);
        }
    } catch { /* ignoré */ }

    /* =====================  3. PLACEMENT  ===================== */

    // Hauteur (fraction de la page) pour garder le rapport largeur/hauteur de la signature.
    function heightFrac(p) {
        const d = pageDims[p.page];
        if (!signature || !d) return 0.1;
        return p.w * (signature.h / signature.w) * (d.w / d.h);
    }

    addBtn.addEventListener('click', () => {
        if (!signature || !pdfDoc) return;
        const p = { id: nextId++, page: currentPage, w: 0.28, x: 0, y: 0 };
        const h = heightFrac(p);
        p.x = clamp(0.5 - p.w / 2, 0, 1 - p.w);
        p.y = clamp(0.8 - h / 2, 0, 1 - h);
        placements.push(p);
        selectedId = p.id;
        renderOverlay();
        refresh();
    });

    copyAllBtn.addEventListener('click', async () => {
        const source = placements.find(p => p.id === selectedId);
        if (!source) return;
        for (let n = 1; n <= pageCount; n++) {
            if (placements.some(p => p.page === n)) continue;
            await ensureDims(n);
            placements.push({ id: nextId++, page: n, x: source.x, y: source.y, w: source.w });
        }
        renderOverlay();
        refresh();
    });

    removeBtn.addEventListener('click', () => removePlacement(selectedId));
    clearBtn.addEventListener('click', () => { placements = []; selectedId = null; renderOverlay(); refresh(); });

    function removePlacement(id) {
        placements = placements.filter(p => p.id !== id);
        if (selectedId === id) selectedId = null;
        renderOverlay();
        refresh();
    }

    function styleItem(el, p) {
        el.style.left = `${p.x * 100}%`;
        el.style.top = `${p.y * 100}%`;
        el.style.width = `${p.w * 100}%`;
        el.style.height = `${heightFrac(p) * 100}%`;
    }

    function renderOverlay() {
        layer.innerHTML = '';
        if (!signature) return;

        placements.filter(p => p.page === currentPage).forEach(p => {
            const el = document.createElement('div');
            el.className = 'sign-item' + (p.id === selectedId ? ' selected' : '');
            styleItem(el, p);
            el.innerHTML =
                `<img src="${signature.dataUrl}" alt="Signature" draggable="false" />` +
                '<div class="sign-handle" title="Redimensionner"></div>' +
                '<button type="button" class="sign-del" title="Supprimer">&times;</button>';

            const handle = el.querySelector('.sign-handle');
            const del = el.querySelector('.sign-del');

            del.addEventListener('pointerdown', e => e.stopPropagation());
            del.addEventListener('click', e => { e.stopPropagation(); removePlacement(p.id); });

            // Déplacement
            el.addEventListener('pointerdown', e => {
                if (e.target === handle || e.target === del) return;
                e.preventDefault();
                select(p.id, el);
                const rect = layer.getBoundingClientRect();
                const start = { px: e.clientX, py: e.clientY, x: p.x, y: p.y };
                el.setPointerCapture(e.pointerId);

                const move = ev => {
                    p.x = clamp(start.x + (ev.clientX - start.px) / rect.width, 0, 1 - p.w);
                    p.y = clamp(start.y + (ev.clientY - start.py) / rect.height, 0, 1 - heightFrac(p));
                    styleItem(el, p);
                };
                const up = () => {
                    el.removeEventListener('pointermove', move);
                    el.removeEventListener('pointerup', up);
                    el.removeEventListener('pointercancel', up);
                };
                el.addEventListener('pointermove', move);
                el.addEventListener('pointerup', up);
                el.addEventListener('pointercancel', up);
            });

            // Redimensionnement (proportions conservées)
            handle.addEventListener('pointerdown', e => {
                e.preventDefault();
                e.stopPropagation();
                select(p.id, el);
                const rect = layer.getBoundingClientRect();
                const ratio = heightFrac({ page: p.page, w: 1 });
                const start = { px: e.clientX, w: p.w };
                handle.setPointerCapture(e.pointerId);

                const move = ev => {
                    const maxW = Math.min(1 - p.x, (1 - p.y) / ratio);
                    p.w = clamp(start.w + (ev.clientX - start.px) / rect.width, 0.05, maxW);
                    styleItem(el, p);
                };
                const up = () => {
                    handle.removeEventListener('pointermove', move);
                    handle.removeEventListener('pointerup', up);
                    handle.removeEventListener('pointercancel', up);
                };
                handle.addEventListener('pointermove', move);
                handle.addEventListener('pointerup', up);
                handle.addEventListener('pointercancel', up);
            });

            layer.appendChild(el);
        });
    }

    function select(id, el) {
        selectedId = id;
        layer.querySelectorAll('.sign-item').forEach(i => i.classList.toggle('selected', i === el));
        refresh();
    }

    // Clic dans le vide : désélectionne.
    layer.addEventListener('pointerdown', e => {
        if (e.target === layer) {
            selectedId = null;
            layer.querySelectorAll('.sign-item').forEach(i => i.classList.remove('selected'));
            refresh();
        }
    });

    function refresh() {
        const hasSelection = placements.some(p => p.id === selectedId);
        addBtn.disabled = !signature || !pdfDoc;
        copyAllBtn.disabled = !hasSelection || pageCount < 2;
        removeBtn.disabled = !hasSelection;
        clearBtn.disabled = placements.length === 0;
        submit.disabled = !selectedFile || !signature || placements.length === 0;

        if (placements.length === 0) {
            summary.textContent = signature && pdfDoc
                ? 'Cliquez sur « Placer sur la page affichée ».'
                : 'Aucune signature placée.';
        } else {
            const pages = [...new Set(placements.map(p => p.page))].sort((a, b) => a - b);
            summary.textContent = `${placements.length} signature(s) placée(s) — page(s) : ${pages.join(', ')}.`;
        }
    }

    /* =====================  ENVOI  ===================== */

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!selectedFile || !signature || placements.length === 0) return;

        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signature...';
        hideAlert();

        try {
            const list = [];
            for (const p of placements) {
                await ensureDims(p.page);
                list.push({ page: p.page, x: p.x, y: p.y, width: p.w, height: heightFrac(p) });
            }

            const sigBlob = await (await fetch(signature.dataUrl)).blob();
            const data = new FormData();
            data.append('file', selectedFile);
            data.append('signature', sigBlob, 'signature.png');
            data.append('placements', JSON.stringify(list));

            const response = await fetch('/api/pdf/sign', { method: 'POST', body: data });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' }));
                throw new Error(error.message);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (selectedFile.name.replace(/\.pdf$/i, '') || 'document') + '_signe.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showAlert('Votre PDF signé a été généré.', 'success');
        } catch (err) {
            showAlert(err.message || 'Une erreur est survenue.', 'danger');
        } finally {
            submit.innerHTML = '<i class="bi bi-vector-pen me-2"></i>Signer et télécharger';
            refresh();
        }
    });

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-3 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-3 mb-0'; }

    refresh();
});
