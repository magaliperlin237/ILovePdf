document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const form = $('organizeForm');
    const dropZone = $('dropZone');
    const fileInput = $('pdfFile');
    const fileInfo = $('fileInfo');
    const grid = $('pageGrid');
    const gridPlaceholder = $('gridPlaceholder');
    const badge = $('pageCountBadge');
    const submit = $('submitBtn');
    const alertBox = $('alert');

    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const THUMB_BOX = 140;

    let selectedFile = null;
    let pdfDoc = null;
    let pageCount = 0;
    let observer = null;
    const rotation = {}; // numéro de page d'origine -> 0 | 90 | 180 | 270

    new Sortable(grid, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        filter: '.ext-btn',
        preventOnFilter: false,
        onEnd: refresh
    });

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
            buildGrid();
        } catch (err) {
            console.error(err);
            showAlert('Impossible de lire ce PDF. Il est peut-être corrompu ou protégé par mot de passe.', 'danger');
        }
    }

    /* ---------- grille ---------- */

    function buildGrid() {
        observer?.disconnect();
        grid.innerHTML = '';
        Object.keys(rotation).forEach(k => delete rotation[k]);

        observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                observer.unobserve(entry.target);
                renderThumb(entry.target);
            }
        }, { rootMargin: '300px' });

        for (let n = 1; n <= pageCount; n++) {
            rotation[n] = 0;
            grid.appendChild(createCard(n));
        }

        gridPlaceholder.classList.add('d-none');
        grid.classList.remove('d-none');
        refresh();
    }

    function createCard(n) {
        const card = document.createElement('div');
        card.className = 'ext-card org-card';
        card.dataset.page = n;
        card.innerHTML =
            '<div class="ext-thumb org-thumb"><canvas></canvas></div>' +
            `<div class="ext-label">Page ${n}</div>` +
            '<div class="ext-actions">' +
            '<button type="button" class="btn btn-light btn-sm ext-btn" data-act="left" title="Pivoter à gauche"><i class="bi bi-arrow-counterclockwise"></i></button>' +
            '<button type="button" class="btn btn-light btn-sm ext-btn" data-act="right" title="Pivoter à droite"><i class="bi bi-arrow-clockwise"></i></button>' +
            '<button type="button" class="btn btn-light btn-sm ext-btn text-danger" data-act="delete" title="Supprimer la page"><i class="bi bi-trash"></i></button>' +
            '</div>';

        card.querySelector('.ext-actions').addEventListener('click', e => {
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            if (btn.dataset.act === 'delete') {
                card.remove();
                refresh();
            } else {
                rotate(card, btn.dataset.act === 'right' ? 90 : -90);
            }
        });

        observer.observe(card);
        return card;
    }

    async function renderThumb(card) {
        const doc = pdfDoc;
        try {
            const page = await doc.getPage(parseInt(card.dataset.page, 10));
            if (doc !== pdfDoc) return;
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: THUMB_BOX / Math.max(base.width, base.height) });
            const canvas = card.querySelector('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        } catch (err) {
            console.error(err);
        }
    }

    function rotate(card, delta) {
        const n = parseInt(card.dataset.page, 10);
        rotation[n] = (((rotation[n] + delta) % 360) + 360) % 360;
        applyRotation(card);
    }

    function applyRotation(card) {
        const n = parseInt(card.dataset.page, 10);
        card.querySelector('canvas').style.transform = `rotate(${rotation[n]}deg)`;
    }

    function refresh() {
        const count = grid.children.length;
        if (pdfDoc) {
            badge.textContent = `${count} / ${pageCount} page(s) conservée(s)`;
            badge.className = `badge ${count ? 'text-bg-danger' : 'text-bg-secondary'}`;
        }
        submit.disabled = !selectedFile || count === 0;
    }

    /* ---------- actions rapides ---------- */

    $('rotateAll').addEventListener('click', () => {
        grid.querySelectorAll('.org-card').forEach(card => rotate(card, 90));
    });

    $('reverseOrder').addEventListener('click', () => {
        const cards = Array.from(grid.children).reverse();
        cards.forEach(c => grid.appendChild(c));
    });

    $('resetAll').addEventListener('click', () => {
        if (pdfDoc) buildGrid();
    });

    /* ---------- envoi ---------- */

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!selectedFile || grid.children.length === 0) return;

        const operations = Array.from(grid.children).map(card => {
            const page = parseInt(card.dataset.page, 10);
            return { page, rotate: rotation[page] };
        });

        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Traitement...';
        hideAlert();

        try {
            const data = new FormData();
            data.append('file', selectedFile);
            data.append('operations', JSON.stringify(operations));

            const response = await fetch('/api/pdf/organize', { method: 'POST', body: data });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' }));
                throw new Error(error.message);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (selectedFile.name.replace(/\.pdf$/i, '') || 'document') + '_organise.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showAlert('Votre PDF réorganisé a été généré.', 'success');
        } catch (err) {
            showAlert(err.message || 'Une erreur est survenue.', 'danger');
        } finally {
            submit.innerHTML = '<i class="bi bi-download me-2"></i>Enregistrer le PDF';
            refresh();
        }
    });

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-4 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-4 mb-0'; }
});
