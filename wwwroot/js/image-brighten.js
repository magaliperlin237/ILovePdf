document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('brightenForm');
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('imageFile');
    const chooseBtn = document.getElementById('chooseFile');
    const fileInfo = document.getElementById('fileInfo');
    const strength = document.getElementById('strength');
    const strengthValue = document.getElementById('strengthValue');
    const pdfOptions = document.getElementById('pdfOptions');
    const pdfPage = document.getElementById('pdfPage');
    const submit = document.getElementById('submitBtn');
    const alertBox = document.getElementById('alert');
    const placeholder = document.getElementById('previewPlaceholder');
    const previewWrap = document.getElementById('previewWrap');
    const beforeCanvas = document.getElementById('beforeCanvas');
    const afterCanvas = document.getElementById('afterCanvas');
    const formatBoxes = Array.from(document.querySelectorAll('.fmt'));

    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const PREVIEW_MAX = 700;
    const EXTENSIONS = ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tif', 'tiff'];

    let selectedFile = null;
    let originalData = null; // ImageData de l'aperçu (non modifié)
    let rafId = 0;

    /* ---------- courbe tonale : identique au serveur (ImageBrightenService.BuildLut) ---------- */

    function buildLut(percent) {
        const s = Math.min(100, Math.max(0, percent)) / 100;
        const gamma = 1 - 0.65 * s;
        const gain = 1 + 0.6 * s;
        const lut = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) {
            lut[i] = Math.round(Math.pow(i / 255, gamma) * gain * 255);
        }
        return lut;
    }

    function drawAfter() {
        if (!originalData) return;
        const lut = buildLut(parseInt(strength.value, 10));
        const out = new ImageData(new Uint8ClampedArray(originalData.data), originalData.width, originalData.height);
        const d = out.data;
        for (let i = 0; i < d.length; i += 4) {
            d[i] = lut[d[i]];
            d[i + 1] = lut[d[i + 1]];
            d[i + 2] = lut[d[i + 2]];
        }
        afterCanvas.getContext('2d').putImageData(out, 0, 0);
    }

    function queueDraw() {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(drawAfter);
    }

    /* ---------- réglages ---------- */

    function updateStrengthLabel() {
        const v = parseInt(strength.value, 10);
        strengthValue.textContent = v === 100 ? '100 % (maximum)' : `${v} %`;
    }

    strength.addEventListener('input', () => { updateStrengthLabel(); queueDraw(); });

    document.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            strength.value = btn.dataset.preset;
            updateStrengthLabel();
            queueDraw();
        });
    });

    function selectedFormats() {
        return formatBoxes.filter(b => b.checked).map(b => b.value);
    }

    function refreshControls() {
        pdfOptions.classList.toggle('d-none', !selectedFormats().includes('pdf'));
        submit.disabled = !selectedFile || selectedFormats().length === 0;
    }

    formatBoxes.forEach(b => b.addEventListener('change', refreshControls));

    /* ---------- sélection du fichier ---------- */

    chooseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

    ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    }));
    dropZone.addEventListener('drop', e => {
        if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
    });

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} octets`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
        return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
    }

    async function setFile(file) {
        hideAlert();
        const ext = file.name.toLowerCase().split('.').pop();

        if (!EXTENSIONS.includes(ext)) {
            showAlert('Format non supporté. Utilisez JPG, PNG, BMP, WebP ou TIFF.', 'danger');
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            showAlert('Le fichier dépasse la taille maximale de 50 Mo.', 'danger');
            return;
        }

        selectedFile = file;
        fileInfo.textContent = `${file.name} (${formatBytes(file.size)})`;
        fileInfo.classList.remove('d-none');

        await loadPreview(file);
        refreshControls();
    }

    function loadPreview(file) {
        return new Promise(resolve => {
            const url = URL.createObjectURL(file);
            const img = new Image();

            img.onload = () => {
                const scale = Math.min(1, PREVIEW_MAX / Math.max(img.naturalWidth, img.naturalHeight));
                const w = Math.max(1, Math.round(img.naturalWidth * scale));
                const h = Math.max(1, Math.round(img.naturalHeight * scale));

                beforeCanvas.width = afterCanvas.width = w;
                beforeCanvas.height = afterCanvas.height = h;

                const ctx = beforeCanvas.getContext('2d', { willReadFrequently: true });
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                originalData = ctx.getImageData(0, 0, w, h);

                placeholder.classList.add('d-none');
                previewWrap.classList.remove('d-none');
                drawAfter();
                URL.revokeObjectURL(url);
                resolve();
            };

            img.onerror = () => {
                // Certains navigateurs ne savent pas afficher le TIFF : le serveur, lui, sait le traiter.
                originalData = null;
                previewWrap.classList.add('d-none');
                placeholder.classList.remove('d-none');
                showAlert('Aperçu indisponible pour ce fichier, mais l’éclaircissement fonctionnera à l’export.', 'warning');
                URL.revokeObjectURL(url);
                resolve();
            };

            img.src = url;
        });
    }

    /* ---------- envoi et téléchargement ---------- */

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const formats = selectedFormats();
        if (!selectedFile || formats.length === 0) return;

        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Traitement...';
        hideAlert();

        try {
            const data = new FormData();
            data.append('file', selectedFile);
            data.append('formats', formats.join(','));
            data.append('strength', strength.value);
            data.append('pdfPage', pdfPage.value);

            const response = await fetch('/api/image/brighten', { method: 'POST', body: data });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' }));
                throw new Error(error.message);
            }

            const blob = await response.blob();
            const base = selectedFile.name.replace(/\.[^.]+$/, '') || 'image';
            const extension = formats.length === 1 ? formats[0] : 'zip';

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${base}_eclairci.${extension}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showAlert(formats.length === 1
                ? 'Votre image éclaircie a été générée.'
                : 'Votre archive ZIP contenant tous les formats a été générée.', 'success');
        } catch (err) {
            showAlert(err.message || 'Une erreur est survenue.', 'danger');
        } finally {
            submit.innerHTML = '<i class="bi bi-download me-2"></i>Éclaircir et télécharger';
            refreshControls();
        }
    });

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-4 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-4 mb-0'; }

    updateStrengthLabel();
    refreshControls();
});
