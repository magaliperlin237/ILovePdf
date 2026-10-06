document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const form = $('extractForm');
    const dropZone = $('dropZone');
    const fileInput = $('pdfFile');
    const fileInfo = $('fileInfo');
    const pagesInput = $('pagesInput');
    const pagesHelp = $('pagesHelp');
    const grid = $('pageGrid');
    const gridPlaceholder = $('gridPlaceholder');
    const selectionCount = $('selectionCount');
    const submit = $('submitBtn');
    const alertBox = $('alert');

    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const THUMB_WIDTH = 170;

    let selectedFile = null;
    let pdfDoc = null;
    let pageCount = 0;
    let selected = new Set();
    let observer = null;
    let lastClicked = null;

    /* ---------- sélection du fichier ---------- */

    $('chooseFile').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

    ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
        e.preventDefault(); dropZone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
        e.preventDefault(); dropZone.classList.remove('dragover');
    }));
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
            selected = new Set();
            lastClicked = null;

            fileInfo.textContent = `${file.name} — ${(file.size / 1024 / 1024).toFixed(2)} Mo · ${pageCount} page(s)`;
            fileInfo.classList.remove('d-none');
            pagesInput.disabled = false;
            pagesInput.value = '';

            buildGrid();
            refresh();
        } catch (err) {
            console.error(err);
            showAlert('Impossible de lire ce PDF. Il est peut-être corrompu ou protégé par mot de passe.', 'danger');
        }
    }

    /* ---------- grille de miniatures (rendu à la demande) ---------- */

    function buildGrid() {
        observer?.disconnect();
        grid.innerHTML = '';

        observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                observer.unobserve(entry.target);
                renderThumb(entry.target);
            }
        }, { rootMargin: '300px' });

        for (let n = 1; n <= pageCount; n++) {
            const card = document.createElement('div');
            card.className = 'ext-card';
            card.dataset.page = n;
            card.innerHTML =
                '<div class="ext-thumb"><canvas></canvas></div>' +
                `<div class="ext-label">${n}</div>` +
                '<i class="bi bi-check-circle-fill ext-check"></i>';
            card.addEventListener('click', e => onCardClick(n, e));
            grid.appendChild(card);
            observer.observe(card);
        }

        gridPlaceholder.classList.add('d-none');
        grid.classList.remove('d-none');
    }

    async function renderThumb(card) {
        const doc = pdfDoc;
        try {
            const page = await doc.getPage(parseInt(card.dataset.page, 10));
            if (doc !== pdfDoc) return;
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
            const canvas = card.querySelector('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        } catch (err) {
            console.error(err);
        }
    }

    function onCardClick(n, e) {
        // Maj + clic : sélectionne tout l'intervalle depuis le dernier clic.
        if (e.shiftKey && lastClicked !== null) {
            const [a, b] = [Math.min(lastClicked, n), Math.max(lastClicked, n)];
            for (let p = a; p <= b; p++) selected.add(p);
        } else if (selected.has(n)) {
            selected.delete(n);
        } else {
            selected.add(n);
        }
        lastClicked = n;
        pagesInput.value = toSpec(selected);
        pagesHelp.className = 'form-text';
        pagesHelp.textContent = 'Astuce : Maj + clic sélectionne un intervalle.';
        refresh();
    }

    /* ---------- sélection <-> texte ---------- */

    function toSpec(set) {
        const sorted = [...set].sort((a, b) => a - b);
        const parts = [];
        for (let i = 0; i < sorted.length; i++) {
            let j = i;
            while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
            parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
            i = j;
        }
        return parts.join(',');
    }

    // Renvoie { pages } ou { error }.
    function parseSpec(text) {
        const result = new Set();
        const tokens = text.split(/[,;]/).map(t => t.trim()).filter(Boolean);
        for (const token of tokens) {
            const m = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!m) return { error: `« ${token} » n'est pas valide. Exemple : 1,3,5-8.` };
            const start = parseInt(m[1], 10);
            const end = m[2] ? parseInt(m[2], 10) : start;
            if (start > end) return { error: `L'intervalle « ${token} » est inversé.` };
            if (start < 1 || end > pageCount) return { error: `Le document contient ${pageCount} page(s).` };
            for (let p = start; p <= end; p++) result.add(p);
        }
        return { pages: result };
    }

    pagesInput.addEventListener('input', () => {
        const parsed = parseSpec(pagesInput.value);
        if (parsed.error) {
            pagesHelp.className = 'form-text text-danger';
            pagesHelp.textContent = parsed.error;
            submit.disabled = true;
            return;
        }
        pagesHelp.className = 'form-text';
        pagesHelp.textContent = 'Cliquez sur les miniatures ou saisissez les numéros.';
        selected = parsed.pages;
        refresh(false);
    });

    document.querySelectorAll('[data-select]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!pdfDoc) return;
            const all = Array.from({ length: pageCount }, (_, i) => i + 1);
            switch (btn.dataset.select) {
                case 'all': selected = new Set(all); break;
                case 'none': selected = new Set(); break;
                case 'odd': selected = new Set(all.filter(p => p % 2 === 1)); break;
                case 'even': selected = new Set(all.filter(p => p % 2 === 0)); break;
                case 'invert': selected = new Set(all.filter(p => !selected.has(p))); break;
            }
            pagesInput.value = toSpec(selected);
            pagesHelp.className = 'form-text';
            pagesHelp.textContent = 'Cliquez sur les miniatures ou saisissez les numéros.';
            refresh();
        });
    });

    function refresh(updateInput = true) {
        grid.querySelectorAll('.ext-card').forEach(card => {
            card.classList.toggle('selected', selected.has(parseInt(card.dataset.page, 10)));
        });

        if (pdfDoc) {
            selectionCount.textContent = `${selected.size} / ${pageCount} sélectionnée(s)`;
            selectionCount.className = `badge ${selected.size ? 'text-bg-danger' : 'text-bg-secondary'}`;
        }
        submit.disabled = !selectedFile || selected.size === 0;
    }

    /* ---------- envoi et téléchargement ---------- */

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!selectedFile || selected.size === 0) return;

        const separate = $('modeSeparate').checked;
        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Traitement...';
        hideAlert();

        try {
            const data = new FormData();
            data.append('file', selectedFile);
            data.append('pages', toSpec(selected));
            data.append('separate', separate.toString());

            const response = await fetch('/api/pdf/extract', { method: 'POST', body: data });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' }));
                throw new Error(error.message);
            }

            const blob = await response.blob();
            const base = selectedFile.name.replace(/\.pdf$/i, '') || 'document';
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = separate ? `${base}_pages.zip` : `${base}_extrait.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showAlert(separate
                ? `${selected.size} page(s) extraite(s) dans une archive ZIP.`
                : `${selected.size} page(s) extraite(s) dans un nouveau PDF.`, 'success');
        } catch (err) {
            showAlert(err.message || 'Une erreur est survenue.', 'danger');
        } finally {
            submit.innerHTML = '<i class="bi bi-scissors me-2"></i>Extraire et télécharger';
            refresh();
        }
    });

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-4 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-4 mb-0'; }
});
