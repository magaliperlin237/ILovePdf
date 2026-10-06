document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const form = $('compressForm');
    const dropZone = $('dropZone');
    const fileInput = $('pdfFile');
    const fileInfo = $('fileInfo');
    const submit = $('submitBtn');
    const alertBox = $('alert');
    const resultBox = $('resultBox');

    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    let selectedFile = null;

    $('chooseFile').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
    dropZone.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} octets`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
        return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
    }

    function setFile(file) {
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
        resultBox.classList.add('d-none');
        selectedFile = file;
        fileInfo.textContent = `${file.name} — ${formatBytes(file.size)}`;
        fileInfo.classList.remove('d-none');
        submit.disabled = false;
    }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!selectedFile) return;

        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Compression...';
        hideAlert();
        resultBox.classList.add('d-none');

        try {
            const data = new FormData();
            data.append('file', selectedFile);
            data.append('level', document.querySelector('input[name="level"]:checked').value);

            const response = await fetch('/api/pdf/compress', { method: 'POST', body: data });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' }));
                throw new Error(error.message);
            }

            const total = parseInt(response.headers.get('X-Images-Total') || '0', 10);
            const optimized = parseInt(response.headers.get('X-Images-Optimized') || '0', 10);
            const blob = await response.blob();

            if (blob.size >= selectedFile.size) {
                const why = total === 0
                    ? 'Ce PDF ne contient pas d’image à compresser.'
                    : 'Les images de ce PDF sont déjà optimisées ou ne sont pas dans un format compressible.';
                showAlert(`Aucun gain possible : ${why} Essayez un niveau plus fort, ou conservez le fichier d’origine.`, 'warning');
                return;
            }

            const gain = Math.round((1 - blob.size / selectedFile.size) * 100);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (selectedFile.name.replace(/\.pdf$/i, '') || 'document') + '_compresse.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            resultBox.innerHTML =
                `<div class="fw-bold mb-1"><i class="bi bi-check-circle me-1"></i>Réduction de ${gain} %</div>` +
                `<div>${formatBytes(selectedFile.size)} → <strong>${formatBytes(blob.size)}</strong></div>` +
                `<div class="small mt-1">${optimized} image(s) optimisée(s) sur ${total} trouvée(s).</div>`;
            resultBox.classList.remove('d-none');
        } catch (err) {
            showAlert(err.message || 'Une erreur est survenue.', 'danger');
        } finally {
            submit.disabled = !selectedFile;
            submit.innerHTML = '<i class="bi bi-file-earmark-zip me-2"></i>Compresser et télécharger';
        }
    });

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-4 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-4 mb-0'; }
});
