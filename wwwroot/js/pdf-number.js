document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const form = $('numberForm');
    const dropZone = $('dropZone');
    const fileInput = $('pdfFile');
    const fileInfo = $('fileInfo');
    const formatSel = $('format');
    const positionSel = $('position');
    const startInput = $('start');
    const sizeInput = $('fontSize');
    const colorInput = $('color');
    const skipFirst = $('skipFirst');
    const submit = $('submitBtn');
    const alertBox = $('alert');
    const placeholder = $('previewPlaceholder');
    const previewWrap = $('previewWrap');
    const canvas = $('pageCanvas');
    const label = $('numLabel');

    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const MARGIN_PT = 28.35; // identique au serveur (1 cm)
    const PREVIEW_WIDTH = 520;

    let selectedFile = null;
    let pdfDoc = null;
    let pageCount = 0;
    let pageWidthPt = 595;
    let pageHeightPt = 842;
    let renderToken = 0;

    /* ---------- fichier ---------- */

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

            fileInfo.textContent = `${file.name} — ${(file.size / 1024 / 1024).toFixed(2)} Mo · ${pageCount} page(s)`;
            fileInfo.classList.remove('d-none');
            placeholder.classList.add('d-none');
            previewWrap.classList.remove('d-none');

            await renderPage();
            refresh();
        } catch (err) {
            console.error(err);
            showAlert('Impossible de lire ce PDF. Il est peut-être corrompu ou protégé par mot de passe.', 'danger');
        }
    }

    // L'aperçu montre la première page qui sera réellement numérotée.
    async function renderPage() {
        if (!pdfDoc) return;
        const token = ++renderToken;
        const number = skipFirst.checked && pageCount > 1 ? 2 : 1;
        const page = await pdfDoc.getPage(number);
        const base = page.getViewport({ scale: 1 });
        pageWidthPt = base.width;
        pageHeightPt = base.height;
        const viewport = page.getViewport({ scale: PREVIEW_WIDTH / base.width });
        if (token !== renderToken) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        updateLabel();
    }

    /* ---------- réglages et aperçu ---------- */

    // NB : même logique que PdfPageNumberService.BuildLabel côté serveur.
    function buildLabel(format, number, total) {
        switch (format) {
            case 'dash': return `- ${number} -`;
            case 'page-n': return `Page ${number}`;
            case 'n-total': return `${number} / ${total}`;
            case 'page-n-total': return `Page ${number} sur ${total}`;
            default: return String(number);
        }
    }

    function settings() {
        return {
            format: formatSel.value,
            position: positionSel.value,
            start: Math.max(0, Math.min(100000, parseInt(startInput.value, 10) || 0)),
            fontSize: Math.max(6, Math.min(48, parseFloat(sizeInput.value) || 11)),
            color: colorInput.value,
            skipFirst: skipFirst.checked
        };
    }

    function updateLabel() {
        if (!pdfDoc) return;
        const s = settings();
        const numbered = pageCount - (s.skipFirst ? 1 : 0);
        const total = s.start + Math.max(numbered, 1) - 1;
        label.textContent = buildLabel(s.format, s.start, total);

        // Conversion points PDF -> pixels d'aperçu.
        const k = canvas.clientWidth / pageWidthPt;
        label.style.fontSize = `${s.fontSize * k}px`;
        label.style.color = s.color;
        const m = MARGIN_PT * k;

        label.style.left = label.style.right = label.style.top = label.style.bottom = 'auto';
        label.style.transform = 'none';
        const [v, h] = s.position.split('-');
        if (v === 'top') label.style.top = `${m}px`; else label.style.bottom = `${m}px`;
        if (h === 'left') label.style.left = `${m}px`;
        else if (h === 'right') label.style.right = `${m}px`;
        else { label.style.left = '50%'; label.style.transform = 'translateX(-50%)'; }
    }

    [formatSel, positionSel, startInput, sizeInput, colorInput].forEach(el => {
        el.addEventListener('input', () => { updateLabel(); refresh(); });
    });
    skipFirst.addEventListener('change', async () => { await renderPage(); refresh(); });
    window.addEventListener('resize', updateLabel);

    function refresh() {
        const numbered = pageCount - (skipFirst.checked ? 1 : 0);
        submit.disabled = !selectedFile || numbered < 1;
        if (selectedFile && numbered < 1) {
            showAlert('Il n’y a aucune page à numéroter : décochez l’option « première page ».', 'warning');
        } else if (alertBox.classList.contains('alert-warning')) {
            hideAlert();
        }
    }

    /* ---------- envoi ---------- */

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!selectedFile) return;

        const s = settings();
        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Traitement...';
        hideAlert();

        try {
            const data = new FormData();
            data.append('file', selectedFile);
            data.append('position', s.position);
            data.append('format', s.format);
            data.append('start', s.start);
            data.append('skipFirst', s.skipFirst.toString());
            data.append('fontSize', s.fontSize);
            data.append('color', s.color);

            const response = await fetch('/api/pdf/number', { method: 'POST', body: data });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' }));
                throw new Error(error.message);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (selectedFile.name.replace(/\.pdf$/i, '') || 'document') + '_numerote.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showAlert('Votre PDF numéroté a été généré.', 'success');
        } catch (err) {
            showAlert(err.message || 'Une erreur est survenue.', 'danger');
        } finally {
            submit.innerHTML = '<i class="bi bi-123 me-2"></i>Numéroter et télécharger';
            submit.disabled = !selectedFile;
        }
    });

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-4 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-4 mb-0'; }
});
