document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);

    const form = $('watermarkForm');
    const input = $('pdfFile');
    const drop = $('dropZone');
    const info = $('fileInfo');
    const submit = $('submitBtn');
    const alertBox = $('alert');

    const pageCanvas = $('pageCanvas');
    const wmCanvas = $('wmCanvas');
    const previewWrap = $('previewWrap');
    const placeholder = $('previewPlaceholder');
    const pageNav = $('pageNav');
    const pageLabel = $('pageLabel');

    const MARGIN = 24;                 // identique au serveur
    const PREVIEW_WIDTH = 720;         // largeur de rendu de l'aperçu (px)
    const measureCtx = document.createElement('canvas').getContext('2d');

    const modeHelp = {
        single: 'Un seul filigrane, placé où vous le souhaitez sur chaque page.',
        tiled: 'Le filigrane est répété sur toute la surface de chaque page.'
    };

    let selectedFile = null;
    let pdfDoc = null;
    let pageNumber = 1;
    let pageSize = null;    // { w, h } en points
    let renderToken = 0;
    let redrawQueued = false;

    /* ---------- lecture des réglages ---------- */

    const mode = () => document.querySelector('input[name="wmMode"]:checked').value;

    function settings() {
        return {
            text: $('watermarkText').value,
            color: $('wmColor').value,
            fontSize: parseFloat($('fontSize').value),
            opacity: parseInt($('opacity').value, 10) / 100,
            mode: mode(),
            position: $('position').value,
            diagonal: $('diagonal').checked,
            angle: parseFloat($('angle').value),
            spacing: parseFloat($('spacing').value),
            stagger: $('stagger').checked
        };
    }

    /* ---------- mise à jour de l'interface ---------- */

    function spacingLabel(v) {
        if (v <= 25) return 'Serré';
        if (v <= 65) return 'Moyen';
        return 'Large';
    }

    function refreshControls() {
        const s = settings();
        $('fontSizeValue').textContent = s.fontSize + ' pt';
        $('opacityValue').textContent = Math.round(s.opacity * 100) + ' %';
        $('angleValue').textContent = s.angle + '°';
        $('spacingValue').textContent = spacingLabel(s.spacing);
        $('modeHelp').textContent = modeHelp[s.mode];

        const tiled = s.mode === 'tiled';
        $('singleOptions').classList.toggle('d-none', tiled);
        $('tiledOptions').classList.toggle('d-none', !tiled);

        const angleUsed = tiled || (s.position === 'center' && s.diagonal);
        $('angleGroup').classList.toggle('d-none', !angleUsed);
        $('diagonal').disabled = s.position !== 'center';
    }

    function onSettingChange() {
        refreshControls();
        queueRedraw();
    }

    ['watermarkText', 'wmColor', 'fontSize', 'opacity', 'position', 'diagonal', 'angle', 'spacing', 'stagger']
        .forEach(id => {
            $(id).addEventListener('input', onSettingChange);
            $(id).addEventListener('change', onSettingChange);
        });
    document.querySelectorAll('input[name="wmMode"]').forEach(r => r.addEventListener('change', onSettingChange));

    /* ---------- sélection du fichier ---------- */

    $('chooseFile').addEventListener('click', e => { e.stopPropagation(); input.click(); });
    drop.addEventListener('click', e => { if (e.target === drop || e.target.closest('h6,p,i')) input.click(); });
    input.addEventListener('change', () => { setFile(input.files[0]); input.value = ''; });

    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.classList.remove('dragover');
    }));
    drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

    async function setFile(file) {
        if (!file) return;
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            showAlert('Veuillez sélectionner un fichier PDF.', 'danger');
            return;
        }

        hideAlert();
        try {
            const data = await file.arrayBuffer();
            const doc = await pdfjsLib.getDocument({ data }).promise;
            pdfDoc?.destroy?.();
            pdfDoc = doc;
            selectedFile = file;
            pageNumber = 1;

            info.textContent = `${file.name} — ${(file.size / 1024 / 1024).toFixed(2)} Mo · ${doc.numPages} page(s)`;
            info.classList.remove('d-none');
            submit.disabled = false;

            placeholder.classList.add('d-none');
            previewWrap.classList.remove('d-none');
            pageNav.classList.toggle('d-none', doc.numPages < 2);

            await renderPage();
        } catch (err) {
            console.error(err);
            showAlert('Impossible de lire ce PDF. Il est peut-être corrompu ou protégé par mot de passe.', 'danger');
        }
    }

    $('prevPage').addEventListener('click', () => changePage(-1));
    $('nextPage').addEventListener('click', () => changePage(1));

    function changePage(delta) {
        if (!pdfDoc) return;
        const n = Math.min(Math.max(pageNumber + delta, 1), pdfDoc.numPages);
        if (n === pageNumber) return;
        pageNumber = n;
        renderPage();
    }

    /* ---------- aperçu ---------- */

    async function renderPage() {
        if (!pdfDoc) return;
        const token = ++renderToken;

        const page = await pdfDoc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        pageSize = { w: base.width, h: base.height };

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: (PREVIEW_WIDTH / base.width) * dpr });

        pageCanvas.width = wmCanvas.width = Math.floor(vp.width);
        pageCanvas.height = wmCanvas.height = Math.floor(vp.height);
        previewWrap.style.aspectRatio = `${base.width} / ${base.height}`;
        pageLabel.textContent = `${pageNumber} / ${pdfDoc.numPages}`;

        const ctx = pageCanvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        if (token === renderToken) drawWatermark();
    }

    function queueRedraw() {
        if (redrawQueued) return;
        redrawQueued = true;
        requestAnimationFrame(() => { redrawQueued = false; drawWatermark(); });
    }

    function drawWatermark() {
        const ctx = wmCanvas.getContext('2d');
        ctx.clearRect(0, 0, wmCanvas.width, wmCanvas.height);
        if (!pageSize) return;

        const s = settings();
        const text = s.text.trim();
        if (!text) return;

        const k = wmCanvas.width / pageSize.w;   // pixels par point

        // Dimensions du texte en points (Arial gras ; hauteur de ligne Arial ≈ 1,15 × la taille)
        measureCtx.font = `bold ${s.fontSize}px Arial, Helvetica, sans-serif`;
        const tw = measureCtx.measureText(text).width;
        const th = s.fontSize * 1.15;

        const placements = computePlacements(pageSize.w, pageSize.h, tw, th, s);

        ctx.font = `bold ${s.fontSize * k}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.opacity;

        for (const p of placements) {
            ctx.save();
            ctx.translate(p.x * k, p.y * k);
            if (Math.abs(p.angle) > 0.001) ctx.rotate(p.angle * Math.PI / 180);
            ctx.fillText(text, 0, 0);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }

    // NB : reproduit à l'identique PdfWatermarkService.ComputePlacements (C#).
    function computePlacements(w, h, tw, th, s) {
        const result = [];

        if (s.mode === 'tiled') {
            const sp = Math.min(Math.max(s.spacing, 10), 100) / 50;
            const stepX = tw + s.fontSize * 3.0 * sp;
            const stepY = th + s.fontSize * 2.5 * sp;

            const radius = Math.sqrt(w * w + h * h) / 2 + Math.max(tw, th);
            const rows = Math.ceil(radius / stepY);
            const cols = Math.ceil(radius / stepX) + 1;

            const rad = s.angle * Math.PI / 180;
            const cos = Math.cos(rad), sin = Math.sin(rad);
            const cull = Math.max(tw, th);

            for (let j = -rows; j <= rows; j++) {
                const y = j * stepY;
                const offset = s.stagger && Math.abs(j) % 2 === 1 ? stepX / 2 : 0;

                for (let i = -cols; i <= cols; i++) {
                    const x = i * stepX + offset;
                    const px = w / 2 + x * cos - y * sin;
                    const py = h / 2 + x * sin + y * cos;

                    if (px < -cull || px > w + cull || py < -cull || py > h + cull) continue;

                    result.push({ x: px, y: py, angle: s.angle });
                    if (result.length >= 5000) return result;
                }
            }
            return result;
        }

        if (s.position === 'center') {
            result.push({ x: w / 2, y: h / 2, angle: s.diagonal ? s.angle : 0 });
            return result;
        }

        const cx = s.position.endsWith('left') ? MARGIN + tw / 2 : w - MARGIN - tw / 2;
        const cy = s.position.startsWith('top') ? MARGIN + th / 2 : h - MARGIN - th / 2;
        result.push({ x: cx, y: cy, angle: 0 });
        return result;
    }

    /* ---------- envoi ---------- */

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!selectedFile) return;

        const s = settings();
        if (!s.text.trim()) {
            showAlert('Le texte du filigrane est obligatoire.', 'danger');
            return;
        }

        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Traitement...';
        hideAlert();

        try {
            const data = new FormData();
            data.append('file', selectedFile);
            data.append('text', s.text.trim());
            data.append('opacity', Math.round(s.opacity * 100));
            data.append('fontSize', s.fontSize);
            data.append('position', s.position);
            data.append('diagonal', s.diagonal.toString());
            data.append('mode', s.mode);
            data.append('angle', s.angle);
            data.append('spacing', s.spacing);
            data.append('stagger', s.stagger.toString());
            data.append('color', s.color);

            const response = await fetch('/api/pdf/watermark', { method: 'POST', body: data });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' }));
                throw new Error(error.message);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = selectedFile.name.replace(/\.pdf$/i, '') + '_filigrane.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showAlert('Le PDF filigrané a été généré.', 'success');
        } catch (err) {
            showAlert(err.message || 'Une erreur est survenue.', 'danger');
        } finally {
            submit.disabled = false;
            submit.innerHTML = '<i class="bi bi-droplet me-2"></i>Ajouter le filigrane et télécharger';
        }
    });

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-4 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-4 mb-0'; }

    refreshControls();
});
