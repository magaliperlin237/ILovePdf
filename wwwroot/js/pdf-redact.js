document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);

    const dropZone = $('redact-drop-zone');
    const fileInput = $('redact-file-input');
    const editor = $('redact-editor');
    const pagesHost = $('redact-pages');
    const alertBox = $('redact-alert');
    const loading = $('redact-loading');
    const loadingText = $('redact-loading-text');
    const applyBtn = $('redact-apply-btn');
    const countLabel = $('redact-count');

    const DISPLAY_WIDTH = 820;          // largeur logique de rendu à l'écran (px)
    const MAX_PIXELS = 4200;            // plus grande dimension autorisée pour l'image d'une page caviardée
    const PADDING = 2;                  // marge (px écran) ajoutée autour des mots détectés

    const presets = {
        'preset-email': /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
        'preset-phone': /(?:(?:\+|00)33[\s.]?|0)[1-9](?:[\s.\-]?\d{2}){4}/g,
        'preset-iban': /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g
    };

    let currentFile = null;
    let pdfDoc = null;
    let pages = [];   // { number, pdfPage, width, height, rects: [{x,y,w,h}] (normalisés 0..1), refresh() }

    /* ---------- utilitaires ---------- */

    function showAlert(msg) { alertBox.textContent = msg; alertBox.classList.remove('d-none'); }
    function hideAlert() { alertBox.textContent = ''; alertBox.classList.add('d-none'); }

    function formatBytes(bytes) {
        if (!bytes) return '0 Octets';
        const k = 1024, sizes = ['Octets', 'Ko', 'Mo', 'Go'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function totalRects() { return pages.reduce((n, p) => n + p.rects.length, 0); }

    function updateCount() {
        const n = totalRects();
        countLabel.textContent = n;
        applyBtn.disabled = n === 0;
    }

    function setLoading(on, title, text) {
        loading.classList.toggle('d-none', !on);
        editor.classList.toggle('d-none', on || !pdfDoc);
        dropZone.classList.toggle('d-none', on || !!pdfDoc);
        if (title) $('redact-loading-title').textContent = title;
        if (text) loadingText.textContent = text;
    }

    /* ---------- chargement du fichier ---------- */

    ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover');
    }));
    dropZone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
    fileInput.addEventListener('change', e => { loadFile(e.target.files[0]); fileInput.value = ''; });
    $('redact-change-file').addEventListener('click', resetAll);

    function resetAll() {
        pdfDoc?.destroy?.();
        pdfDoc = null; currentFile = null; pages = [];
        pagesHost.innerHTML = '';
        $('redact-search-result').textContent = '';
        hideAlert();
        editor.classList.add('d-none');
        dropZone.classList.remove('d-none');
        updateCount();
    }

    async function loadFile(file) {
        hideAlert();
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.pdf')) {
            showAlert('Veuillez sélectionner un fichier PDF.'); return;
        }
        if (file.size > window.redactConfig.maxFileSizeMb * 1024 * 1024) {
            showAlert(`Le fichier dépasse la limite de ${window.redactConfig.maxFileSizeMb} Mo.`); return;
        }

        setLoading(true, 'Ouverture du PDF...', 'Préparation de l’aperçu des pages.');
        try {
            const data = await file.arrayBuffer();
            pdfDoc = await pdfjsLib.getDocument({ data }).promise;
            currentFile = file;
            pages = [];
            pagesHost.innerHTML = '';

            $('redact-file-name').textContent = file.name;
            $('redact-file-meta').textContent = `${formatBytes(file.size)} · ${pdfDoc.numPages} page(s)`;

            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        observer.unobserve(entry.target);
                        entry.target._render?.();
                    }
                });
            }, { rootMargin: '600px 0px' });

            for (let n = 1; n <= pdfDoc.numPages; n++) {
                const pdfPage = await pdfDoc.getPage(n);
                const vp = pdfPage.getViewport({ scale: 1 });
                const page = { number: n, pdfPage, width: vp.width, height: vp.height, rects: [] };
                pages.push(page);
                buildPageElement(page, observer);
            }
        } catch (err) {
            console.error(err);
            pdfDoc = null; currentFile = null; pages = [];
            showAlert('Impossible de lire ce PDF. Il est peut-être corrompu ou protégé par mot de passe.');
        } finally {
            setLoading(false);
            updateCount();
        }
    }

    /* ---------- affichage et dessin des zones ---------- */

    function buildPageElement(page, observer) {
        const wrap = document.createElement('div');
        wrap.className = 'redact-page';
        wrap.style.aspectRatio = `${page.width} / ${page.height}`;

        const label = document.createElement('span');
        label.className = 'badge bg-dark redact-page-label';
        label.textContent = `Page ${page.number}`;

        const canvas = document.createElement('canvas');
        const overlay = document.createElement('div');
        overlay.className = 'redact-overlay';

        wrap.append(canvas, overlay, label);
        pagesHost.appendChild(wrap);

        wrap._render = async () => {
            const scale = (DISPLAY_WIDTH / page.width) * Math.min(window.devicePixelRatio || 1, 2);
            const vp = page.pdfPage.getViewport({ scale });
            canvas.width = Math.floor(vp.width);
            canvas.height = Math.floor(vp.height);
            await page.pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        };
        observer.observe(wrap);

        page.overlay = overlay;
        page.refresh = () => {
            overlay.querySelectorAll('.redact-rect').forEach(el => el.remove());
            page.rects.forEach((r, idx) => {
                const el = document.createElement('div');
                el.className = 'redact-rect';
                el.style.left = (r.x * 100) + '%';
                el.style.top = (r.y * 100) + '%';
                el.style.width = (r.w * 100) + '%';
                el.style.height = (r.h * 100) + '%';

                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'redact-rect-remove';
                del.title = 'Supprimer cette zone';
                del.innerHTML = '&times;';
                del.addEventListener('pointerdown', e => e.stopPropagation());
                del.addEventListener('click', e => {
                    e.stopPropagation();
                    page.rects.splice(idx, 1);
                    page.refresh();
                    updateCount();
                });
                el.appendChild(del);
                overlay.appendChild(el);
            });
        };

        enableDrawing(page, overlay);
    }

    function enableDrawing(page, overlay) {
        let start = null;
        let draft = null;

        const point = e => {
            const b = overlay.getBoundingClientRect();
            return {
                x: Math.min(Math.max((e.clientX - b.left) / b.width, 0), 1),
                y: Math.min(Math.max((e.clientY - b.top) / b.height, 0), 1)
            };
        };

        overlay.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target !== overlay) return;
            start = point(e);
            draft = document.createElement('div');
            draft.className = 'redact-draft';
            overlay.appendChild(draft);
            overlay.setPointerCapture(e.pointerId);
        });

        overlay.addEventListener('pointermove', e => {
            if (!start) return;
            const p = point(e);
            draft.style.left = Math.min(start.x, p.x) * 100 + '%';
            draft.style.top = Math.min(start.y, p.y) * 100 + '%';
            draft.style.width = Math.abs(p.x - start.x) * 100 + '%';
            draft.style.height = Math.abs(p.y - start.y) * 100 + '%';
        });

        const finish = e => {
            if (!start) return;
            const p = point(e);
            const b = overlay.getBoundingClientRect();
            const rect = {
                x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
                w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y)
            };
            draft.remove();
            draft = null; start = null;

            // Ignore les simples clics / rectangles minuscules (< 6 px à l'écran)
            if (rect.w * b.width >= 6 && rect.h * b.height >= 6) {
                page.rects.push(rect);
                page.refresh();
                updateCount();
            }
        };
        overlay.addEventListener('pointerup', finish);
        overlay.addEventListener('pointercancel', () => { draft?.remove(); draft = null; start = null; });
    }

    $('redact-clear-btn').addEventListener('click', () => {
        if (totalRects() === 0) return;
        if (!confirm('Supprimer toutes les zones marquées ?')) return;
        pages.forEach(p => { p.rects = []; p.refresh?.(); });
        updateCount();
    });

    /* ---------- recherche automatique ---------- */

    $('redact-search-btn').addEventListener('click', async () => {
        hideAlert();
        if (!pdfDoc) return;

        const regexes = [];
        $('redact-terms').value.split('\n').map(s => s.trim()).filter(Boolean).forEach(term => {
            regexes.push(new RegExp(escapeRegex(term), 'gi'));
        });
        Object.entries(presets).forEach(([id, re]) => {
            if ($(id).checked) regexes.push(new RegExp(re.source, re.flags));
        });

        if (regexes.length === 0) {
            showAlert('Saisissez au moins un mot ou cochez une détection automatique.'); return;
        }

        const btn = $('redact-search-btn');
        btn.disabled = true;
        $('redact-search-result').textContent = 'Recherche en cours...';

        let added = 0;
        try {
            const measure = document.createElement('canvas').getContext('2d');
            for (const page of pages) {
                const found = await findMatchesOnPage(page, regexes, measure);
                found.forEach(r => {
                    if (!isDuplicate(page, r)) { page.rects.push(r); added++; }
                });
                page.refresh();
            }
            updateCount();
            $('redact-search-result').textContent = added > 0
                ? `${added} zone(s) ajoutée(s). Vérifiez-les avant de valider.`
                : 'Aucune occurrence trouvée (la recherche ne fonctionne pas sur les PDF scannés).';
        } catch (err) {
            console.error(err);
            showAlert('La recherche a échoué sur ce document.');
            $('redact-search-result').textContent = '';
        } finally {
            btn.disabled = false;
        }
    });

    function isDuplicate(page, r) {
        return page.rects.some(o => Math.abs(o.x - r.x) < 0.003 && Math.abs(o.y - r.y) < 0.003
            && Math.abs(o.w - r.w) < 0.003 && Math.abs(o.h - r.h) < 0.003);
    }

    async function findMatchesOnPage(page, regexes, ctx) {
        const scale = DISPLAY_WIDTH / page.width;
        const vp = page.pdfPage.getViewport({ scale });
        const content = await page.pdfPage.getTextContent();
        const out = [];

        for (const item of content.items) {
            if (!item.str || !item.str.trim()) continue;

            const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
            const fontH = Math.hypot(tx[2], tx[3]);
            if (!fontH) continue;

            const family = content.styles?.[item.fontName]?.fontFamily || 'sans-serif';
            ctx.font = `${fontH}px ${family}`;
            const fullMeasured = ctx.measureText(item.str).width;
            const trueWidth = item.width * scale;
            const ratio = fullMeasured > 0 ? trueWidth / fullMeasured : 1;

            const ux = tx[0], uy = tx[1];   // sens du texte
            const vx = tx[2], vy = tx[3];   // sens « vers le haut » de la police
            const ul = Math.hypot(ux, uy) || 1, vl = Math.hypot(vx, vy) || 1;

            for (const re of regexes) {
                re.lastIndex = 0;
                let m;
                while ((m = re.exec(item.str)) !== null) {
                    if (m[0].length === 0) { re.lastIndex++; continue; }

                    const a0 = ctx.measureText(item.str.slice(0, m.index)).width * ratio;
                    const a1 = a0 + ctx.measureText(m[0]).width * ratio;

                    // Coins du rectangle (avec marge) → boîte englobante en pixels écran
                    const xs = [], ys = [];
                    for (const a of [a0 - PADDING, a1 + PADDING]) {
                        for (const b of [-0.28 * fontH - PADDING, 1.0 * fontH + PADDING]) {
                            xs.push(tx[4] + (ux / ul) * a + (vx / vl) * b);
                            ys.push(tx[5] + (uy / ul) * a + (vy / vl) * b);
                        }
                    }
                    const x0 = Math.max(Math.min(...xs), 0), x1 = Math.min(Math.max(...xs), vp.width);
                    const y0 = Math.max(Math.min(...ys), 0), y1 = Math.min(Math.max(...ys), vp.height);
                    if (x1 > x0 && y1 > y0) {
                        out.push({ x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height });
                    }
                }
            }
        }
        return out;
    }

    /* ---------- application du caviardage ---------- */

    applyBtn.addEventListener('click', async () => {
        hideAlert();
        const targets = pages.filter(p => p.rects.length > 0);
        if (!currentFile || targets.length === 0) return;

        const quality = parseFloat($('redact-quality').value) || 2;
        setLoading(true, 'Caviardage en cours...', 'Aplatissement des pages concernées.');
        applyBtn.disabled = true;

        try {
            const form = new FormData();
            form.append('file', currentFile);

            let done = 0;
            for (const page of targets) {
                loadingText.textContent = `Page ${page.number} (${++done}/${targets.length})...`;

                let scale = quality;
                const longest = Math.max(page.width, page.height) * scale;
                if (longest > MAX_PIXELS) scale *= MAX_PIXELS / longest;

                const vp = page.pdfPage.getViewport({ scale });
                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(vp.width);
                canvas.height = Math.floor(vp.height);
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;

                // Les rectangles sont « gravés » dans les pixels : noir opaque, aucune transparence.
                ctx.fillStyle = '#000';
                page.rects.forEach(r => {
                    ctx.fillRect(
                        Math.floor(r.x * canvas.width) - 1,
                        Math.floor(r.y * canvas.height) - 1,
                        Math.ceil(r.w * canvas.width) + 2,
                        Math.ceil(r.h * canvas.height) + 2);
                });

                const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88));
                if (!blob) throw new Error('Impossible de générer l’image de la page ' + page.number + '.');

                form.append('pageNumbers', String(page.number));
                form.append('widths', String(page.width));
                form.append('heights', String(page.height));
                form.append('images', blob, `page-${page.number}.jpg`);

                canvas.width = canvas.height = 0; // libère la mémoire
            }

            loadingText.textContent = 'Envoi et assemblage du PDF...';
            const response = await fetch('/api/pdf/redact', { method: 'POST', body: form });

            if (!response.ok) {
                let message = 'Erreur lors du caviardage.';
                try { message = (await response.json()).message || message; } catch { }
                throw new Error(message);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = currentFile.name.replace(/\.pdf$/i, '') + '_caviarde.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            showAlert(err.message || 'Une erreur est survenue.');
        } finally {
            setLoading(false);
            updateCount();
        }
    });
});
