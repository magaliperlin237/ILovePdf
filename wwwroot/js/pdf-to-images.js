document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const form = $('toImagesForm');
    const dropZone = $('dropZone');
    const fileInput = $('pdfFile');
    const fileInfo = $('fileInfo');
    const pagesInput = $('pagesInput');
    const pagesHelp = $('pagesHelp');
    const submit = $('submitBtn');
    const alertBox = $('alert');
    const progressWrap = $('progressWrap');
    const progressBar = $('progressBar');
    const progressText = $('progressText');

    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const MAX_SIDE_PX = 8000; // évite de dépasser les limites de taille des canvas

    let selectedFile = null;
    let pdfDoc = null;
    let pageCount = 0;
    let busy = false;

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
            refresh();
        } catch (err) {
            console.error(err);
            showAlert('Impossible de lire ce PDF. Il est peut-être corrompu ou protégé par mot de passe.', 'danger');
        }
    }

    /* ---------- sélection des pages ---------- */

    function parseSpec(text) {
        const result = new Set();
        const tokens = text.split(/[,;]/).map(t => t.trim()).filter(Boolean);
        if (tokens.length === 0) return { error: 'Indiquez au moins une page.' };
        for (const token of tokens) {
            const m = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!m) return { error: `« ${token} » n'est pas valide. Exemple : 1,3,5-8.` };
            const start = parseInt(m[1], 10);
            const end = m[2] ? parseInt(m[2], 10) : start;
            if (start > end) return { error: `L'intervalle « ${token} » est inversé.` };
            if (start < 1 || end > pageCount) return { error: `Le document contient ${pageCount} page(s).` };
            for (let p = start; p <= end; p++) result.add(p);
        }
        return { pages: [...result].sort((a, b) => a - b) };
    }

    function pagesToExport() {
        if (document.querySelector('input[name="pagesMode"]:checked').value === 'all') {
            return { pages: Array.from({ length: pageCount }, (_, i) => i + 1) };
        }
        return parseSpec(pagesInput.value);
    }

    document.querySelectorAll('input[name="pagesMode"]').forEach(r => r.addEventListener('change', refresh));
    pagesInput.addEventListener('input', refresh);

    function refresh() {
        const custom = document.querySelector('input[name="pagesMode"]:checked').value === 'custom';
        pagesInput.classList.toggle('d-none', !custom);
        pagesHelp.classList.toggle('d-none', !custom);

        let valid = !!pdfDoc;
        if (custom && pdfDoc) {
            const parsed = parseSpec(pagesInput.value);
            if (parsed.error) {
                valid = false;
                pagesHelp.className = pagesInput.value ? 'form-text text-danger' : 'form-text';
                pagesHelp.textContent = pagesInput.value ? parsed.error : 'Saisissez les numéros de pages à exporter.';
            } else {
                pagesHelp.className = 'form-text';
                pagesHelp.textContent = `${parsed.pages.length} page(s) sélectionnée(s).`;
            }
        }
        submit.disabled = !valid || busy;
    }

    /* ---------- conversion ---------- */

    function pad(n, width) { return String(n).padStart(width, '0'); }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!pdfDoc || busy) return;

        const selection = pagesToExport();
        if (selection.error) { showAlert(selection.error, 'danger'); return; }

        const pages = selection.pages;
        const format = document.querySelector('input[name="imgFormat"]:checked').value;
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        const baseScale = parseInt($('dpi').value, 10) / 72;
        const base = selectedFile.name.replace(/\.pdf$/i, '') || 'document';
        const width = String(pageCount).length;

        busy = true;
        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Conversion...';
        hideAlert();
        progressWrap.classList.remove('d-none');
        setProgress(0, pages.length);

        try {
            const zip = pages.length > 1 ? new JSZip() : null;
            let singleBlob = null;

            for (let i = 0; i < pages.length; i++) {
                const n = pages[i];
                const page = await pdfDoc.getPage(n);

                let viewport = page.getViewport({ scale: baseScale });
                const longest = Math.max(viewport.width, viewport.height);
                if (longest > MAX_SIDE_PX) {
                    viewport = page.getViewport({ scale: baseScale * MAX_SIDE_PX / longest });
                }

                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff'; // fond blanc (utile pour le JPEG)
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;

                const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, 0.92));
                if (!blob) throw new Error('La page est trop grande pour être convertie à cette résolution. Essayez une résolution plus basse.');

                if (zip) zip.file(`${base}_page_${pad(n, width)}.${format}`, blob);
                else singleBlob = blob;

                canvas.width = canvas.height = 0; // libère la mémoire
                page.cleanup();
                setProgress(i + 1, pages.length);
            }

            let output, filename;
            if (zip) {
                progressText.textContent = 'Création de l’archive ZIP...';
                output = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
                filename = `${base}_images.zip`;
            } else {
                output = singleBlob;
                filename = `${base}_page_${pad(pages[0], width)}.${format}`;
            }

            const url = URL.createObjectURL(output);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showAlert(`${pages.length} page(s) exportée(s) en ${format.toUpperCase()}.`, 'success');
        } catch (err) {
            console.error(err);
            showAlert(err.message || 'Une erreur est survenue pendant la conversion.', 'danger');
        } finally {
            busy = false;
            progressWrap.classList.add('d-none');
            submit.innerHTML = '<i class="bi bi-download me-2"></i>Convertir et télécharger';
            refresh();
        }
    });

    function setProgress(done, total) {
        progressBar.style.width = `${Math.round(done / total * 100)}%`;
        progressText.textContent = `Page ${done} sur ${total}`;
    }

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-4 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-4 mb-0'; }
});
