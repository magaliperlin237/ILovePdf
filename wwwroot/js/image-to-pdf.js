document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('image-drop-zone');
    const fileInput = document.getElementById('image-file-input');
    const listContainer = document.getElementById('image-list-container');
    const imageList = document.getElementById('image-list');
    const convertBtn = document.getElementById('image-to-pdf-btn');
    const alertMessage = document.getElementById('image-alert-message');
    const loadingOverlay = document.getElementById('image-loading-overlay');
    const compressionLevel = document.getElementById('compression-level');
    const compressionDescription = document.getElementById('compression-description');
    const watermarkEnabled = document.getElementById('watermark-enabled');
    const watermarkOptions = document.getElementById('watermark-options');
    const watermarkText = document.getElementById('watermark-text');
    const watermarkOpacity = document.getElementById('watermark-opacity');
    const watermarkOpacityValue = document.getElementById('watermark-opacity-value');
    const watermarkFontSize = document.getElementById('watermark-font-size');
    const watermarkPosition = document.getElementById('watermark-position');

    let selectedImages = [];

    const compressionDescriptions = {
        None: 'Aucune compression : la qualité et la résolution originales sont conservées.',
        Low: 'Faible : jusqu’à 2 500 px, qualité JPEG 85 %. Bon choix si vous voulez surtout conserver la qualité.',
        Medium: 'Moyenne : jusqu’à 1 800 px, qualité JPEG 75 %. Recommandé pour un bon équilibre taille / qualité.',
        High: 'Forte : jusqu’à 1 400 px, qualité JPEG 60 %. Réduit davantage la taille du PDF.',
        Extreme: 'Extrême : jusqu’à 1 000 px, qualité JPEG 45 %. Priorité à la taille minimale du fichier.'
    };

    function updateCompressionDescription() {
        if (compressionDescription && compressionLevel) {
            compressionDescription.textContent = compressionDescriptions[compressionLevel.value] || '';
        }
    }

    compressionLevel?.addEventListener('change', updateCompressionDescription);
    updateCompressionDescription();

    watermarkEnabled?.addEventListener('change', () => {
        watermarkOptions?.classList.toggle('d-none', !watermarkEnabled.checked);
    });

    watermarkOpacity?.addEventListener('input', () => {
        if (watermarkOpacityValue) watermarkOpacityValue.textContent = watermarkOpacity.value;
    });

    const sortable = new Sortable(imageList, {
        handle: '.image-drag-handle',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: reorderImages
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        });
    });

    dropZone.addEventListener('drop', e => {
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', e => {
        handleFiles(e.target.files);
        fileInput.value = '';
    });

    function showAlert(message) {
        alertMessage.textContent = message;
        alertMessage.classList.remove('d-none');
    }

    function hideAlert() {
        alertMessage.textContent = '';
        alertMessage.classList.add('d-none');
    }

    function formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 Octets';
        const k = 1024;
        const sizes = ['Octets', 'Ko', 'Mo', 'Go'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    }

    function isSupportedImage(file) {
        const extension = file.name.toLowerCase().split('.').pop();
        return ['jpg', 'jpeg', 'png', 'bmp'].includes(extension)
            && ['image/jpeg', 'image/png', 'image/bmp'].includes(file.type);
    }

    async function handleFiles(files) {
        hideAlert();

        const incomingFiles = Array.from(files);

        if (selectedImages.length + incomingFiles.length > window.imageToPdfConfig.maxFiles) {
            showAlert(`Vous ne pouvez pas ajouter plus de ${window.imageToPdfConfig.maxFiles} images au total.`);
            return;
        }

        for (const file of incomingFiles) {
            if (!isSupportedImage(file)) {
                showAlert(`"${file.name}" n'est pas une image supportée. Utilisez JPG, JPEG, PNG ou BMP.`);
                continue;
            }

            if (file.size > window.imageToPdfConfig.maxFileSizeMb * 1024 * 1024) {
                showAlert(`"${file.name}" dépasse la limite de ${window.imageToPdfConfig.maxFileSizeMb} Mo.`);
                continue;
            }

            const id = 'image-' + Math.random().toString(36).substring(2, 9);

            selectedImages.push({
                id,
                file,
                previewUrl: URL.createObjectURL(file)
            });
        }

        renderImageList();
    }

    function renderImageList() {
        imageList.innerHTML = '';

        if (selectedImages.length === 0) {
            listContainer.classList.add('d-none');
            return;
        }

        listContainer.classList.remove('d-none');

        selectedImages.forEach((item, index) => {
            const col = document.createElement('div');
            col.className = 'col-sm-6 col-md-4';
            col.dataset.id = item.id;

            col.innerHTML = `
                <div class="card h-100 shadow-sm image-card">
                    <div class="position-relative image-preview-wrapper">
                        <img src="${item.previewUrl}"
                             class="card-img-top image-preview"
                             alt="${escapeHtml(item.file.name)}">
                        <span class="position-absolute top-0 start-0 m-2 badge bg-dark">
                            ${index + 1}
                        </span>
                        <button type="button"
                                class="btn btn-light btn-sm position-absolute top-0 end-0 m-2 remove-image-btn"
                                title="Supprimer">
                            <i class="bi bi-trash text-danger"></i>
                        </button>
                    </div>
                    <div class="card-body py-2 px-3 d-flex align-items-center">
                        <i class="bi bi-grip-vertical fs-4 image-drag-handle me-2"
                           title="Déplacer"></i>
                        <div class="text-truncate">
                            <div class="fw-semibold text-truncate">${escapeHtml(item.file.name)}</div>
                            <small class="text-muted">${formatBytes(item.file.size)}</small>
                        </div>
                    </div>
                </div>
            `;

            col.querySelector('.remove-image-btn').addEventListener('click', () => {
                removeImage(item.id);
            });

            imageList.appendChild(col);
        });
    }

    function removeImage(id) {
        const item = selectedImages.find(x => x.id === id);
        if (item) URL.revokeObjectURL(item.previewUrl);

        selectedImages = selectedImages.filter(x => x.id !== id);
        renderImageList();
    }

    function reorderImages() {
        const ids = Array.from(imageList.children).map(x => x.dataset.id);
        selectedImages.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        renderImageList();
    }

    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    convertBtn.addEventListener('click', async () => {
        hideAlert();

        if (selectedImages.length === 0) {
            showAlert('Veuillez sélectionner au moins une image.');
            return;
        }

        const formData = new FormData();
        selectedImages.forEach(item => {
            formData.append('files', item.file);
        });
        formData.append('compressionLevel', compressionLevel?.value || 'Medium');

        if (watermarkEnabled?.checked && watermarkText?.value.trim()) {
            formData.append('watermarkText', watermarkText.value.trim());
            formData.append('watermarkOpacity', watermarkOpacity?.value || '25');
            formData.append('watermarkFontSize', watermarkFontSize?.value || '42');
            formData.append('watermarkPosition', watermarkPosition?.value || 'Center');
        }

        dropZone.classList.add('d-none');
        listContainer.classList.add('d-none');
        loadingOverlay.classList.remove('d-none');
        convertBtn.disabled = true;

        try {
            const response = await fetch('/api/pdf/image-to-pdf', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                let message = 'Erreur lors de la conversion.';
                try {
                    const errorData = await response.json();
                    message = errorData.message || message;
                } catch {
                }
                throw new Error(message);
            }

            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');

            link.href = downloadUrl;
            link.download = getDownloadFileName(response) || 'images_vers_pdf.pdf';
            document.body.appendChild(link);
            link.click();
            link.remove();

            URL.revokeObjectURL(downloadUrl);

            selectedImages.forEach(item => URL.revokeObjectURL(item.previewUrl));
            selectedImages = [];
            renderImageList();
        } catch (error) {
            showAlert(error.message || 'Une erreur est survenue.');
        } finally {
            loadingOverlay.classList.add('d-none');
            dropZone.classList.remove('d-none');
            convertBtn.disabled = false;

            if (selectedImages.length > 0) {
                listContainer.classList.remove('d-none');
            }
        }
    });

    function getDownloadFileName(response) {
        const disposition = response.headers.get('Content-Disposition');
        if (!disposition) return null;

        const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
        if (utf8Match) {
            return decodeURIComponent(utf8Match[1]);
        }

        const match = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i.exec(disposition);
        return match?.[1]?.replace(/['"]/g, '') || null;
    }
});
