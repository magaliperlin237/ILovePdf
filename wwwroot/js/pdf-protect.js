document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const form = $('protectForm');
    const dropZone = $('dropZone');
    const fileInput = $('pdfFile');
    const fileInfo = $('fileInfo');
    const pwd = $('password');
    const pwd2 = $('password2');
    const pwdHelp = $('pwdHelp');
    const submit = $('submitBtn');
    const alertBox = $('alert');

    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    let selectedFile = null;

    /* ---------- fichier ---------- */

    $('chooseFile').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
    dropZone.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

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
        selectedFile = file;
        fileInfo.textContent = `${file.name} — ${(file.size / 1024 / 1024).toFixed(2)} Mo`;
        fileInfo.classList.remove('d-none');
        refresh();
    }

    /* ---------- mots de passe ---------- */

    $('togglePwd').addEventListener('click', () => {
        const show = pwd.type === 'password';
        pwd.type = pwd2.type = show ? 'text' : 'password';
        $('togglePwd').innerHTML = `<i class="bi ${show ? 'bi-eye-slash' : 'bi-eye'}"></i>`;
    });

    [pwd, pwd2].forEach(el => el.addEventListener('input', refresh));

    function refresh() {
        const filled = pwd.value.length > 0;
        const match = pwd.value === pwd2.value;

        if (pwd2.value.length > 0 && !match) {
            pwdHelp.className = 'form-text text-danger';
            pwdHelp.textContent = 'Les mots de passe ne correspondent pas.';
        } else {
            pwdHelp.className = 'form-text';
            pwdHelp.textContent = '';
        }

        submit.disabled = !selectedFile || !filled || !match;
    }

    /* ---------- envoi ---------- */

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!selectedFile || !pwd.value || pwd.value !== pwd2.value) return;

        submit.disabled = true;
        submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Chiffrement...';
        hideAlert();

        try {
            const data = new FormData();
            data.append('file', selectedFile);
            data.append('password', pwd.value);
            data.append('ownerPassword', $('ownerPassword').value);
            data.append('allowPrint', $('allowPrint').checked.toString());
            data.append('allowCopy', $('allowCopy').checked.toString());
            data.append('allowModify', $('allowModify').checked.toString());

            const response = await fetch('/api/pdf/protect', { method: 'POST', body: data });
            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Une erreur est survenue.' }));
                throw new Error(error.message);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (selectedFile.name.replace(/\.pdf$/i, '') || 'document') + '_protege.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            showAlert('Votre PDF protégé a été généré. Conservez bien le mot de passe.', 'success');
        } catch (err) {
            showAlert(err.message || 'Une erreur est survenue.', 'danger');
        } finally {
            submit.innerHTML = '<i class="bi bi-lock me-2"></i>Protéger et télécharger';
            refresh();
        }
    });

    function showAlert(message, type) { alertBox.textContent = message; alertBox.className = `alert alert-${type} mt-4 mb-0`; }
    function hideAlert() { alertBox.className = 'alert d-none mt-4 mb-0'; }
});
