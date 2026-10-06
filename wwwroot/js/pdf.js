document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListContainer = document.getElementById('file-list-container');
    const fileList = document.getElementById('file-list');
    const mergeBtn = document.getElementById('merge-btn');
    const alertMessage = document.getElementById('alert-message');
    const loadingOverlay = document.getElementById('loading-overlay');

    let selectedFiles = [];

    // SortableJS pour le drag & drop
    const sortable = new Sortable(fileList, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: function () {
            reorderSelectedFiles();
        }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        handleFiles(files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = '';
    });

    function showAlert(msg) {
        alertMessage.textContent = msg;
        alertMessage.classList.remove('d-none');
    }

    function hideAlert() {
        alertMessage.classList.add('d-none');
        alertMessage.textContent = '';
    }

    function formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 Octets';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Octets', 'Ko', 'Mo', 'Go'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    async function getPdfPageCount(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            return pdf.numPages;
        } catch (e) {
            return null;
        }
    }

    async function handleFiles(files) {
        hideAlert();
        const incomingFiles = Array.from(files);

        if (selectedFiles.length + incomingFiles.length > window.pdfAppConfig.maxFiles) {
            showAlert(`Vous ne pouvez pas ajouter plus de ${window.pdfAppConfig.maxFiles} fichiers au total.`);
            return;
        }

        for (const file of incomingFiles) {
            if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                showAlert(`Le fichier "${file.name}" n'est pas un document PDF.`);
                continue;
            }

            if (file.size > window.pdfAppConfig.maxFileSizeMb * 1024 * 1024) {
                showAlert(`Le fichier "${file.name}" dépasse la limite de ${window.pdfAppConfig.maxFileSizeMb} Mo.`);
                continue;
            }

            const id = 'pdf-' + Math.random().toString(36).substring(2, 9);
            const pageCount = await getPdfPageCount(file);

            selectedFiles.push({
                id: id,
                file: file,
                pageCount: pageCount
            });
        }

        renderFileList();
    }

    function renderFileList() {
        fileList.innerHTML = '';

        if (selectedFiles.length === 0) {
            fileListContainer.classList.add('d-none');
            return;
        }

        fileListContainer.classList.remove('d-none');

        selectedFiles.forEach((item) => {
            const card = document.createElement('div');
            card.className = 'list-group-item file-card d-flex align-items-center justify-content-between p-3 mb-2 border rounded shadow-sm bg-white';
            card.dataset.id = item.id;

            const pagesInfo = item.pageCount ? ` — ${item.pageCount} page${item.pageCount > 1 ? 's' : ''}` : '';

            card.innerHTML = `
                <div class="d-flex align-items-center me-3 text-truncate">
                    <i class="bi bi-grip-vertical fs-4 drag-handle me-2" title="Déplacer"></i>
                    <i class="bi bi-file-earmark-pdf-fill text-danger fs-3 me-3"></i>
                    <div class="text-truncate">
                        <h6 class="mb-0 text-truncate fw-semibold">${escapeHtml(item.file.name)}</h6>
                        <small class="text-muted">${formatBytes(item.file.size)}${pagesInfo}</small>
                    </div>
                </div>
                <button type="button" class="btn btn-outline-danger btn-sm border-0 remove-btn" title="Supprimer">
                    <i class="bi bi-trash fs-5"></i>
                </button>
            `;

            card.querySelector('.remove-btn').addEventListener('click', () => {
                removeFile(item.id);
            });

            fileList.appendChild(card);
        });
    }

    function escapeHtml(text) {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function removeFile(id) {
        selectedFiles = selectedFiles.filter(item => item.id !== id);
        renderFileList();
    }

    function reorderSelectedFiles() {
        const currentIds = Array.from(fileList.children).map(child => child.dataset.id);
        selectedFiles.sort((a, b) => currentIds.indexOf(a.id) - currentIds.indexOf(b.id));
    }

    mergeBtn.addEventListener('click', async () => {
        hideAlert();

        if (selectedFiles.length < 2) {
            showAlert("Veuillez sélectionner au moins deux fichiers PDF à fusionner.");
            return;
        }

        const formData = new FormData();
        selectedFiles.forEach(item => {
            formData.append('files', item.file);
        });

        dropZone.classList.add('d-none');
        fileListContainer.classList.add('d-none');
        loadingOverlay.classList.remove('d-none');

        try {
            const response = await fetch('/api/pdf/merge', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || "Erreur lors du traitement du fichier.");
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;

            const disposition = response.headers.get('Content-Disposition');
            let fileName = 'fusion_pdftools.pdf';
            if (disposition && disposition.indexOf('filename=') !== -1) {
                const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
                if (matches != null && matches[1]) {
                    fileName = matches[1].replace(/['"]/g, '');
                }
            }

            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);

            selectedFiles = [];
            renderFileList();

        } catch (error) {
            showAlert(error.message);
        } finally {
            loadingOverlay.classList.add('d-none');
            dropZone.classList.remove('d-none');
            if (selectedFiles.length > 0) {
                fileListContainer.classList.remove('d-none');
            }
        }
    });
});