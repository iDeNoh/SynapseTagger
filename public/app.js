document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let allMediaData = [];
    let currentGalleryFilenames = [];
    let allTagsData = [];
    let activeFilters = { tags: new Set() };
    let gallerySort = { key: 'filename', direction: 'asc' };
    let currentSort = 'alpha';
    let selectedFilename = null;
    let currentEditorIndex = -1;
    let previewTimer = null;
    let currentPage = 1;
    let itemsPerPage = 50;
    let batchStatusInterval = null;
    let touchStartX = 0;
    let touchEndX = 0;
    let userRatingWeight = 0.5;
    let unratedImagesQueue = [];
    let currentView = 'active';

    // --- DOM Elements ---
    const galleryViewBtn = document.getElementById('gallery-view-btn');
    const batchViewBtn = document.getElementById('batch-view-btn');
    const settingsViewBtn = document.getElementById('settings-view-btn');
    const galleryEditorView = document.getElementById('gallery-editor-view');
    const batchView = document.getElementById('batch-view');
    const settingsView = document.getElementById('settings-view');
    const imageGallery = document.getElementById('image-gallery');
    const editorImage = document.getElementById('editor-image');
    const editorImageContainer = document.getElementById('editor-image-container');
    const imageInfoText = document.getElementById('image-info-text');
    const aestheticScoreDisplay = document.getElementById('aesthetic-score-display');
    const editorRatingContainer = document.getElementById('editor-rating');
    const userRatingWeightSlider = document.getElementById('user-rating-weight');
    const userRatingWeightValue = document.getElementById('user-rating-weight-value');
    const startBatchBtn = document.getElementById('start-batch-btn');
    const batchSummaryText = document.getElementById('batch-summary-text');
    const cancelBatchBtn = document.getElementById('cancel-batch-btn');
    const batchPreviewImage = document.getElementById('batch-preview-image');
    const batchProgressContainer = document.getElementById('batch-progress-container');
    const batchProgressBar = document.getElementById('batch-progress-bar');
    const batchProgressText = document.getElementById('batch-progress-text');
    const autotagBtn = document.getElementById('autotag-btn');
    const sidebar = document.querySelector('.sidebar');
    const mobileTagsToggle = document.getElementById('mobile-tags-toggle');
    const tagListContainer = document.getElementById('tag-list-container');
    const editorView = document.getElementById('editor-view');
    const galleryView = document.getElementById('gallery-view');
    const editorTextarea = document.getElementById('editor-textarea');
    const backToGalleryBtn = document.getElementById('back-to-gallery-btn');
    const saveBtn = document.getElementById('save-btn');
    const resetBtn = document.getElementById('reset-btn');
    const rejectImageBtn = document.getElementById('reject-image-btn');
    const restoreImageBtn = document.getElementById('restore-image-btn');
    const prevImageBtn = document.getElementById('prev-image-btn');
    const nextImageBtn = document.getElementById('next-image-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const previewModal = document.getElementById('preview-modal');
    const previewImage = document.getElementById('preview-image');
    const sortTagsSelect = document.getElementById('sort-tags-select');
    const clearFilterBtn = document.getElementById('clear-filter-btn');
    const itemsPerPageSelect = document.getElementById('items-per-page');
    const paginationBottom = document.getElementById('pagination-bottom');
    const tagSearchInput = document.getElementById('tag-search-input');
    const API_URL = '/api';
    const operationSelector = document.getElementById('operation-selector');
    const autotagOptions = document.getElementById('autotag-options');
    const findReplaceOptions = document.getElementById('find-replace-options');
    const rejectByScoreOptions = document.getElementById('reject-by-score-options');
    const rejectThresholdSlider = document.getElementById('reject-threshold-slider');
    const rejectThresholdValue = document.getElementById('reject-threshold-value');
    const batchOptionsContainer = document.getElementById('batch-options-container');
    const manualRateContainer = document.getElementById('manual-rate-container');
    const manualRateImage = document.getElementById('manual-rate-image');
    const manualRateStars = document.getElementById('manual-rate-stars');
    const manualRateCounter = document.getElementById('manual-rate-counter');
    const stopManualRateBtn = document.getElementById('stop-manual-rate-btn');
    const clearRatingsBtn = document.getElementById('clear-ratings-btn');
    const clearScoresBtn = document.getElementById('clear-scores-btn');
    const confirmationModal = document.getElementById('confirmation-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalText = document.getElementById('modal-text');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const viewRejectedToggle = document.getElementById('view-rejected-toggle');

    const calculateWeightedScore = (aestheticScore, userRating) => {
        if (aestheticScore === null || aestheticScore === undefined) return null;
        if (userRating === 0) return aestheticScore;
        const userInfluence = userRating - 2;
        const scoreChange = userInfluence * 2.5 * userRatingWeight;
        const finalScore = aestheticScore + scoreChange;
        return Math.max(0, Math.min(10, finalScore));
    };

    const showView = async (viewId) => {
        [galleryEditorView, batchView, settingsView].forEach(view => view.classList.add('hidden'));
        [galleryViewBtn, batchViewBtn, settingsViewBtn].forEach(btn => btn.classList.remove('active'));
        const viewToShow = document.getElementById(viewId);
        const btnToActivate = document.getElementById(viewId.replace('-view', '-view-btn'));
        if (viewToShow) viewToShow.classList.remove('hidden');
        if (btnToActivate) btnToActivate.classList.add('active');
        if (viewId === 'batch-view') {
            batchOptionsContainer.classList.remove('hidden');
            manualRateContainer.classList.add('hidden');
            try {
                const response = await fetch(`${API_URL}/autotag-batch/status`);
                const status = await response.json();
                if (status.isRunning) {
                    startBatchBtn.classList.add('hidden');
                    batchProgressContainer.classList.remove('hidden');
                } else {
                    batchSummaryText.textContent = `This will affect all ${currentGalleryFilenames.length} currently visible images.`;
                    startBatchBtn.classList.remove('hidden');
                    batchProgressContainer.classList.add('hidden');
                }
            } catch (error) {
                console.error("Could not get batch status:", error);
                batchSummaryText.textContent = "Could not retrieve batch status.";
            }
        }
    };

    const startBatchOperation = async () => {
        const activeOpBtn = operationSelector.querySelector('.operation-btn.active');
        const operationType = activeOpBtn ? activeOpBtn.dataset.op : 'autotag';
        if (operationType === 'manual_rate') {
            startManualRating();
            return;
        }
        if (operationType === 'export_final_dataset') {
            showConfirmation(
                'Export Final Dataset?',
                `This will copy all ${currentGalleryFilenames.length} currently visible images to the 'final' folder and sanitize their tags.`,
                async () => {
                    await fetch(`${API_URL}/export-final-dataset`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filenames: currentGalleryFilenames })
                    });
                    alert(`${currentGalleryFilenames.length} images have been exported.`);
                    reloadAllData();
                }
            );
            return;
        }
        if (operationType === 'reject_by_score') {
            const rejectThreshold = parseFloat(rejectThresholdSlider.value);
            const affectedItems = allMediaData.filter(item => {
                const finalScore = calculateWeightedScore(item.aesthetic_score, item.rating);
                return currentGalleryFilenames.includes(item.filename) && finalScore !== null && finalScore < rejectThreshold;
            });
            const numAffected = affectedItems.length;
            showConfirmation(
                'Reject Images by Score?',
                `This will move ${numAffected} of the currently visible images to the 'rejected' folder.`,
                async () => {
                    await fetch(`${API_URL}/reject-by-score`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filenames: affectedItems.map(i => i.filename) })
                    });
                    alert(`${numAffected} images have been rejected.`);
                    reloadAllData();
                }
            );
            return;
        }
        const confirmationMessage = `This will start the '${operationType}' operation on all ${currentGalleryFilenames.length} currently visible images. This may take a long time and cannot be undone. Continue?`;
        if (!confirm(confirmationMessage)) return;
        startBatchBtn.classList.add('hidden');
        batchProgressContainer.classList.remove('hidden');
        batchViewBtn.classList.add('is-running');
        const payload = { filenames: currentGalleryFilenames, operationType };
        if (operationType === 'autotag') {
            payload.threshold = parseFloat(document.getElementById('autotag-threshold-batch').value) / 100;
            payload.mode = document.querySelector('input[name="batch-mode"]:checked').value;
            payload.customTag = document.getElementById('batch-custom-tag').value;
        } else if (operationType === 'find_replace') {
            payload.tagToFind = document.getElementById('find-tag-input').value;
            payload.tagToReplace = document.getElementById('replace-tag-input').value;
            if (!payload.tagToFind) {
                alert("Please enter a tag to find.");
                startBatchBtn.classList.remove('hidden');
                batchProgressContainer.classList.add('hidden');
                batchViewBtn.classList.remove('is-running');
                return;
            }
        }
        await fetch(`${API_URL}/autotag-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!batchStatusInterval) batchStatusInterval = setInterval(checkBatchStatus, 2000);
    };
    
    const checkBatchStatus = async () => {
        try {
            const response = await fetch(`${API_URL}/autotag-batch/status`);
            if (!response.ok) return;
            const status = await response.json();
            if (!batchView.classList.contains('hidden')) {
                const currentItem = allMediaData.find(item => item.filename === status.currentFile);
                batchPreviewImage.src = currentItem ? currentItem.thumbnailUrl : '';
                const percent = status.total > 0 ? (status.processed / status.total) * 100 : 0;
                batchProgressBar.style.width = `${percent}%`;
                batchProgressText.textContent = `(${status.operationType}) Processing ${status.processed} of ${status.total}: ${status.currentFile}`;
            }
            if (!status.isRunning && status.total > 0) {
                clearInterval(batchStatusInterval);
                batchStatusInterval = null;
                batchViewBtn.classList.remove('is-running');
                const completionAction = () => { showView('gallery-editor-view'); reloadAllData(); };
                if (!batchView.classList.contains('hidden')) {
                    batchProgressText.textContent = 'Batch complete! Reloading...';
                    batchProgressBar.style.width = '100%';
                    setTimeout(completionAction, 2000);
                } else {
                    alert('Batch operation complete!');
                    completionAction();
                }
            }
        } catch (error) {
            console.error("Failed to check batch status:", error);
            batchViewBtn.classList.remove('is-running');
            clearInterval(batchStatusInterval);
        }
    };
    
    const cancelBatchOperation = async () => {
        await fetch(`${API_URL}/autotag-batch/cancel`, { method: 'POST' });
        clearInterval(batchStatusInterval);
        batchStatusInterval = null;
        batchViewBtn.classList.remove('is-running');
        showView('gallery-editor-view');
        reloadAllData();
    };
    
    const resumeBatchState = async () => {
        try {
            const response = await fetch(`${API_URL}/autotag-batch/status`);
            if (!response.ok) return;
            const status = await response.json();
            if (status.isRunning) {
                batchViewBtn.classList.add('is-running');
                batchStatusInterval = setInterval(checkBatchStatus, 2000);
            }
        } catch (error) {
            console.error("Could not resume batch state:", error);
        }
    };

    const fetchMedia = async () => { try { const response = await fetch(`${API_URL}/media?view=${currentView}`); allMediaData = await response.json(); } catch (error) { console.error('Failed to fetch media:', error); } };
    const fetchTags = async () => { try { const response = await fetch(`${API_URL}/tags`); allTagsData = await response.json(); } catch (error) { console.error('Failed to fetch tags:', error); } };
    const preloadImages = (index) => { if (index < currentGalleryFilenames.length - 1) { const nextItem = allMediaData.find(m => m.filename === currentGalleryFilenames[index + 1]); if (nextItem) new Image().src = nextItem.imageUrl; } if (index > 0) { const prevItem = allMediaData.find(m => m.filename === currentGalleryFilenames[index - 1]); if (prevItem) new Image().src = prevItem.imageUrl; } };
    
    const renderGallery = () => {
        let itemsToSort = [...allMediaData];
        itemsToSort.sort((a, b) => {
            let valA, valB;
            switch (gallerySort.key) {
                case 'resolution': valA = Math.max(a.metadata.width || 0, a.metadata.height || 0); valB = Math.max(b.metadata.width || 0, b.metadata.height || 0); break;
                case 'rating': valA = calculateWeightedScore(a.aesthetic_score, a.rating) || 0; valB = calculateWeightedScore(b.aesthetic_score, b.rating) || 0; break;
                case 'format': valA = a.metadata.format || ''; valB = b.metadata.format || ''; break;
                default: valA = a.filename.toLowerCase(); valB = b.filename.toLowerCase(); break;
            }
            let comparison = valA > valB ? 1 : (valA < valB ? -1 : 0);
            return gallerySort.direction === 'desc' ? comparison * -1 : comparison;
        });
        
        let itemsToFilter = itemsToSort;
        if (activeFilters.tags.size > 0) {
            itemsToFilter = itemsToSort.filter(item => {
                const itemTags = new Set(item.content.split(',').map(t => t.trim()));
                return [...activeFilters.tags].every(t => itemTags.has(t));
            });
        }
        
        clearFilterBtn.classList.toggle('hidden', activeFilters.tags.size === 0);
        currentGalleryFilenames = itemsToFilter.map(item => item.filename);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const pageItems = itemsPerPage === 'all' ? itemsToFilter : itemsToFilter.slice(startIndex, startIndex + itemsPerPage);
        
        imageGallery.innerHTML = pageItems.map(item => {
            const finalScore = calculateWeightedScore(item.aesthetic_score, item.rating);
            const scoreDisplay = finalScore !== null ? `<div class="aesthetic-score">${finalScore.toFixed(2)}</div>` : '';
            return `<div class="gallery-item" data-filename="${item.filename}"><img src="${item.thumbnailUrl}" alt="${item.filename}" loading="lazy">${scoreDisplay}<div class="preview-icon-container" data-filename="${item.filename}"><svg viewBox="0 0 24 24" class="preview-icon"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"></path></svg><svg class="progress-circle-svg" width="32" height="32" viewBox="0 0 32 32"><circle class="progress-circle__track" r="14" cx="16" cy="16" stroke-width="3"></circle><circle class="progress-circle__value" r="14" cx="16" cy="16" stroke-width="3"></circle></svg></div></div>`;
        }).join('');
        
        renderPagination();
    };
    
    const renderPagination = () => {
        if (itemsPerPage === 'all' || currentGalleryFilenames.length <= itemsPerPage) {
            paginationBottom.innerHTML = ''; return;
        }
        const totalPages = Math.ceil(currentGalleryFilenames.length / itemsPerPage);
        let html = `<button class="page-btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>&laquo; Prev</button>`;
        for (let i = 1; i <= totalPages; i++) {
            html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        html += `<button class="page-btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>Next &raquo;</button>`;
        paginationBottom.innerHTML = html;
    };

    const renderTagList = () => {
        const searchTerm = tagSearchInput.value.toLowerCase();
        let tagsToRender = allTagsData;
        if (searchTerm) {
            tagsToRender = allTagsData.filter(tag => tag.name.toLowerCase().includes(searchTerm));
        }
        const sortedTags = [...tagsToRender].sort((a, b) => {
            if (currentSort === 'count-desc') return b.count - a.count;
            if (currentSort === 'count-asc') return a.count - b.count;
            return a.name.localeCompare(b.name);
        });
        tagListContainer.innerHTML = sortedTags.map(tag => `
            <div class="tag-item ${activeFilters.tags.has(tag.name) ? 'filtered' : ''}" data-tag="${tag.name}">
                <span class="tag-name">${tag.name}</span>
                <div style="display:flex; align-items: center;">
                    <span class="tag-count">${tag.count}</span>
                    <button class="delete-tag-btn" data-tag="${tag.name}">-</button>
                </div>
            </div>
        `).join('');
    };

    const reloadAllData = async () => { await Promise.all([fetchMedia(), fetchTags()]); renderTagList(); renderGallery(); };
    
    const showEditor = (filename) => {
        selectedFilename = filename;
        currentEditorIndex = currentGalleryFilenames.indexOf(filename);
        if (currentEditorIndex === -1) return;
        const item = allMediaData.find(m => m.filename === filename);
        if (!item) return;
        editorImage.src = item.imageUrl;
        editorTextarea.value = item.content.split(',').filter(t => !t.trim().startsWith('rating:') && !t.trim().startsWith('aesthetic_score:')).join(', ');
        const finalScore = calculateWeightedScore(item.aesthetic_score, item.rating);
        aestheticScoreDisplay.textContent = finalScore !== null ? `Aesthetic Score: ${finalScore.toFixed(2)}` : 'Aesthetic Score: N/A';
        let positionInfo = `Image ${currentEditorIndex + 1} of ${currentGalleryFilenames.length}`;
        if (itemsPerPage !== 'all') positionInfo += ` (Page ${currentPage})`;
        const resolutionInfo = item.metadata.width ? `${item.metadata.width} x ${item.metadata.height}` : 'N/A';
        const formatInfo = item.metadata.format ? item.metadata.format.toUpperCase() : 'N/A';
        imageInfoText.innerHTML = `<span>${positionInfo}</span><span>${resolutionInfo}</span><span>${formatInfo}</span>`;
        const rating = item.rating || 0;
        const starInput = document.getElementById(`star${rating}`);
        if (starInput) { starInput.checked = true; } else { document.querySelectorAll('input[name="rating"]').forEach(radio => radio.checked = false); }
        prevImageBtn.disabled = currentEditorIndex === 0;
        nextImageBtn.disabled = currentEditorIndex === currentGalleryFilenames.length - 1;
        const isRejectedView = currentView === 'rejected';
        rejectImageBtn.classList.toggle('hidden', isRejectedView);
        restoreImageBtn.classList.toggle('hidden', !isRejectedView);
        const existingIcon = editorImageContainer.querySelector('.preview-icon-container'); 
        if (existingIcon) existingIcon.remove(); 
        const previewIconHTML = `<div class="preview-icon-container editor-preview-icon" data-filename="${item.filename}"><svg viewBox="0 0 24 24" class="preview-icon"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"></path></svg></div>`;
        editorImageContainer.insertAdjacentHTML('beforeend', previewIconHTML);
        galleryView.classList.add('hidden');
        editorView.classList.remove('hidden');
        preloadImages(currentEditorIndex);
    };
    
    const showPreview = (filename) => { const item = allMediaData.find(m => m.filename === filename); if (item) { previewImage.src = item.imageUrl; previewModal.classList.remove('hidden'); } };
    const hidePreview = () => { previewModal.classList.add('hidden'); previewImage.src = ''; };

    const loadAppSettings = () => {
        const savedWeight = localStorage.getItem('userRatingWeight');
        if (savedWeight !== null) userRatingWeight = parseFloat(savedWeight);
        userRatingWeightSlider.value = userRatingWeight;
        userRatingWeightValue.textContent = userRatingWeight;
    };
    
    const loadApp = async () => {
        loadAppSettings();
        const initialItemsPerPage = itemsPerPageSelect.value;
        itemsPerPage = initialItemsPerPage === 'all' ? 'all' : parseInt(initialItemsPerPage, 10);
        themeToggle.checked = localStorage.getItem('theme') === 'dark';
        document.body.classList.toggle('dark-mode', themeToggle.checked);
        await reloadAllData();
        await resumeBatchState();
    };

    const startManualRating = () => {
        unratedImagesQueue = allMediaData.filter(item => item.rating === 0).map(item => item.filename);
        if (unratedImagesQueue.length === 0) {
            alert("No unrated images found!");
            return;
        }
        batchOptionsContainer.classList.add('hidden');
        manualRateContainer.classList.remove('hidden');
        loadNextManualRateImage();
    };

    const stopManualRating = () => {
        unratedImagesQueue = [];
        batchOptionsContainer.classList.remove('hidden');
        manualRateContainer.classList.add('hidden');
        reloadAllData();
    };

    const loadNextManualRateImage = () => {
        if (unratedImagesQueue.length === 0) {
            alert("All images have been rated!");
            stopManualRating();
            return;
        }
        const randomIndex = Math.floor(Math.random() * unratedImagesQueue.length);
        const filename = unratedImagesQueue[randomIndex];
        const item = allMediaData.find(m => m.filename === filename);
        manualRateImage.src = item.imageUrl;
        manualRateImage.dataset.filename = filename;
        manualRateCounter.textContent = `${unratedImagesQueue.length} unrated images remaining`;
    };

    const submitManualRating = async (filename, rating) => {
        const item = allMediaData.find(m => m.filename === filename);
        if (!item) return;
        item.rating = rating;
        let tags = item.content.split(',').map(t => t.trim()).filter(Boolean);
        const nonRatingTags = tags.filter(t => !t.startsWith('rating:'));
        nonRatingTags.push(`rating:${rating}`);
        item.content = nonRatingTags.join(', ');
        await fetch(`${API_URL}/media/${filename}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: item.content, isRejected: false }) });
        unratedImagesQueue = unratedImagesQueue.filter(f => f !== filename);
        loadNextManualRateImage();
    };

    const showConfirmation = (title, text, onConfirm) => {
        modalTitle.textContent = title;
        modalText.textContent = text;
        confirmationModal.classList.remove('hidden');
        const newConfirmBtn = modalConfirmBtn.cloneNode(true);
        modalConfirmBtn.parentNode.replaceChild(newConfirmBtn, modalConfirmBtn);
        newConfirmBtn.addEventListener('click', () => {
            onConfirm();
            confirmationModal.classList.add('hidden');
        });
    };

    // --- Event Listeners ---
    galleryViewBtn.addEventListener('click', () => showView('gallery-editor-view'));
    batchViewBtn.addEventListener('click', () => showView('batch-view'));
    settingsViewBtn.addEventListener('click', () => showView('settings-view'));
    startBatchBtn.addEventListener('click', startBatchOperation);
    cancelBatchBtn.addEventListener('click', cancelBatchOperation);
    mobileTagsToggle.addEventListener('click', () => sidebar.classList.toggle('is-visible'));
    itemsPerPageSelect.addEventListener('change', (e) => { itemsPerPage = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10); currentPage = 1; renderGallery(); });
    themeToggle.addEventListener('change', () => { document.body.classList.toggle('dark-mode'); localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); });
    sortTagsSelect.addEventListener('change', (e) => { currentSort = e.target.value; renderTagList(); });
    clearFilterBtn.addEventListener('click', () => { activeFilters.tags.clear(); currentPage = 1; renderGallery(); renderTagList(); });
    backToGalleryBtn.addEventListener('click', () => { galleryView.classList.remove('hidden'); editorView.classList.add('hidden'); });
    tagSearchInput.addEventListener('input', renderTagList);
    previewModal.addEventListener('click', hidePreview);
    userRatingWeightSlider.addEventListener('input', (e) => { userRatingWeight = parseFloat(e.target.value); userRatingWeightValue.textContent = userRatingWeight; localStorage.setItem('userRatingWeight', userRatingWeight); if (!galleryView.classList.contains('hidden')) renderGallery(); if (!editorView.classList.contains('hidden')) showEditor(selectedFilename); });
    
    document.querySelector('.sort-controls').addEventListener('click', (e) => {
        const sortBtn = e.target.closest('.sort-btn');
        if (!sortBtn) return;
        const sortKey = sortBtn.dataset.sort;
        if (gallerySort.key === sortKey) {
            gallerySort.direction = gallerySort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            gallerySort.key = sortKey;
            gallerySort.direction = 'asc';
        }
        document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active', 'asc', 'desc'));
        sortBtn.classList.add('active', gallerySort.direction);
        currentPage = 1;
        renderGallery();
    });

    imageGallery.addEventListener('click', (e) => {
        if (e.target.closest('.preview-icon-container')) {
            clearTimeout(previewTimer);
            const filename = e.target.closest('.preview-icon-container').dataset.filename;
            showPreview(filename);
            return;
        }
        const item = e.target.closest('.gallery-item');
        if (item) showEditor(item.dataset.filename);
    });
    
    imageGallery.addEventListener('mouseover', (e) => { if (e.target.closest('.preview-icon-container')) { const filename = e.target.closest('.preview-icon-container').dataset.filename; previewTimer = setTimeout(() => showPreview(filename), 1000); } });
    imageGallery.addEventListener('mouseout', (e) => { if (e.target.closest('.preview-icon-container')) { clearTimeout(previewTimer); } });

    paginationBottom.addEventListener('click', (e) => {
        const button = e.target.closest('.page-btn');
        if (!button || button.disabled) return;
        const page = button.dataset.page;
        if (page === 'prev') currentPage--;
        else if (page === 'next') currentPage++;
        else currentPage = parseInt(page, 10);
        renderGallery();
    });
    
    operationSelector.addEventListener('click', (e) => {
        const opBtn = e.target.closest('.operation-btn');
        if (!opBtn) return;
        document.querySelectorAll('.operation-btn').forEach(btn => btn.classList.remove('active'));
        opBtn.classList.add('active');
        const opType = opBtn.dataset.op;
        autotagOptions.classList.toggle('hidden', opType !== 'autotag');
        findReplaceOptions.classList.toggle('hidden', opType !== 'find_replace');
        rejectByScoreOptions.classList.toggle('hidden', opType !== 'reject_by_score');
        const startBtnText = {
            'manual_rate': 'Start Manual Rating',
            'reject_by_score': 'Reject Images by Score',
            'export_final_dataset': 'Export Final Dataset'
        }[opType] || 'Start Batch Operation';
        startBatchBtn.textContent = startBtnText;
        startBatchBtn.classList.toggle('danger-btn', opType === 'reject_by_score');
    });

    tagListContainer.addEventListener('click', (e) => {
        const tagItem = e.target.closest('.tag-item');
        if (!tagItem) return;
        const tag = tagItem.dataset.tag;
        if (e.target.classList.contains('delete-tag-btn')) {
            if (confirm(`Are you sure you want to remove the tag "${tag}" from ALL files?`)) {
                fetch(`${API_URL}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }).then(reloadAllData);
            }
        } else {
            if (activeFilters.tags.has(tag)) {
                activeFilters.tags.delete(tag);
            } else {
                activeFilters.tags.add(tag);
            }
            currentPage = 1;
            renderGallery();
            renderTagList();
        }
    });

    prevImageBtn.addEventListener('click', () => { if (currentEditorIndex > 0) showEditor(currentGalleryFilenames[currentEditorIndex - 1]); });
    nextImageBtn.addEventListener('click', () => { if (currentEditorIndex < currentGalleryFilenames.length - 1) showEditor(currentGalleryFilenames[currentEditorIndex + 1]); });
    resetBtn.addEventListener('click', () => { if (!selectedFilename) return; const item = allMediaData.find(m => m.filename === selectedFilename); editorTextarea.value = item ? item.content.split(',').filter(t => !t.trim().startsWith('rating:') && !t.trim().startsWith('aesthetic_score:')).join(', ') : ''; });
    saveBtn.addEventListener('click', async () => { if (!selectedFilename) return; const item = allMediaData.find(m => m.filename === selectedFilename); let currentTags = editorTextarea.value.split(',').map(t => t.trim()).filter(Boolean); if (item.rating > 0) currentTags.push(`rating:${item.rating}`); if (item.aesthetic_score !== null) currentTags.push(`aesthetic_score:${item.aesthetic_score}`); item.content = currentTags.join(', '); await fetch(`${API_URL}/media/${selectedFilename}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: item.content, isRejected: currentView === 'rejected' }), }); await reloadAllData(); alert('Changes saved!'); });
    rejectImageBtn.addEventListener('click', async () => { if (!selectedFilename) return; if (confirm(`Are you sure you want to reject ${selectedFilename}? It will be moved to the 'rejected' folder.`)) { await fetch(`${API_URL}/reject/${selectedFilename}`, { method: 'POST' }); await reloadAllData(); showView('gallery-editor-view'); } });
    restoreImageBtn.addEventListener('click', async () => { if (!selectedFilename) return; await fetch(`${API_URL}/restore/${selectedFilename}`, { method: 'POST' }); alert(`${selectedFilename} has been restored.`); viewRejectedToggle.checked = false; currentView = 'active'; await reloadAllData(); showView('gallery-editor-view'); });
    autotagBtn.addEventListener('click', async () => { if (!selectedFilename || autotagBtn.classList.contains('is-loading')) return; autotagBtn.classList.add('is-loading'); autotagBtn.textContent = 'Tagging...'; const threshold = parseFloat(document.getElementById('autotag-threshold-editor').value) / 100; const mode = document.querySelector('input[name="editor-mode"]:checked').value; try { const response = await fetch(`${API_URL}/autotag/${selectedFilename}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threshold: threshold }) }); if (!response.ok) { throw new Error(`Server responded with status: ${response.status}`); } const data = await response.json(); const existingTags = editorTextarea.value.split(',').map(t => t.trim()).filter(Boolean); const newTags = data.tags.split(',').map(t => t.trim()).filter(Boolean); let finalTags = new Set(existingTags); if (mode === 'replace') { finalTags = new Set(newTags); } else if (mode === 'prepend') { finalTags = new Set([...newTags, ...existingTags]); } else { newTags.forEach(t => finalTags.add(t)); } editorTextarea.value = Array.from(finalTags).join(', '); } catch (error) { console.error('Auto-tagging failed:', error); alert('Auto-tagging failed. Check the server console for more details.'); } finally { autotagBtn.classList.remove('is-loading'); autotagBtn.textContent = 'Auto-Tag this Image'; } });
    editorRatingContainer.addEventListener('change', async (e) => {
        const newRating = parseInt(e.target.value, 10);
        const item = allMediaData.find(m => m.filename === selectedFilename);
        if (!item) return;
        item.rating = newRating;
        let tags = item.content.split(',').map(t => t.trim()).filter(Boolean);
        const nonRatingTags = tags.filter(t => !t.startsWith('rating:'));
        nonRatingTags.push(`rating:${newRating}`);
        item.content = nonRatingTags.join(', ');
        const finalScore = calculateWeightedScore(item.aesthetic_score, item.rating);
        aestheticScoreDisplay.textContent = finalScore !== null ? `Aesthetic Score: ${finalScore.toFixed(2)}` : 'Aesthetic Score: N/A';
        await fetch(`${API_URL}/media/${selectedFilename}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: item.content, isRejected: currentView === 'rejected' }) });
    });
    editorImageContainer.addEventListener('click', (e) => { if (e.target.closest('.preview-icon-container')) { clearTimeout(previewTimer); showPreview(selectedFilename); } });

    document.addEventListener('keydown', (e) => {
        if (!manualRateContainer.classList.contains('hidden')) {
            if (e.key >= '1' && e.key <= '3') {
                submitManualRating(manualRateImage.dataset.filename, parseInt(e.key, 10));
            }
            return;
        }
        if ((e.key === 'Escape' || e.key === 'f') && !previewModal.classList.contains('hidden')) { hidePreview(); return; }
        if (editorView.classList.contains('hidden') || e.target === editorTextarea) { return; }
        switch (e.key) {
            case 'ArrowLeft': e.preventDefault(); prevImageBtn.click(); break;
            case 'ArrowRight': e.preventDefault(); nextImageBtn.click(); break;
            case 'f': e.preventDefault(); showPreview(selectedFilename); break;
        }
    });

    editorImageContainer.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
    editorImageContainer.addEventListener('touchend', (e) => { touchEndX = e.changedTouches[0].screenX; handleSwipe(); });
    const handleSwipe = () => { if (touchEndX < touchStartX - 50) nextImageBtn.click(); if (touchEndX > touchStartX + 50) prevImageBtn.click(); };

    manualRateStars.addEventListener('click', (e) => {
        if (e.target.tagName === 'LABEL') {
            const starValue = e.target.htmlFor.slice(-1);
            submitManualRating(manualRateImage.dataset.filename, parseInt(starValue, 10));
        }
    });
    stopManualRateBtn.addEventListener('click', stopManualRating);

    modalCancelBtn.addEventListener('click', () => {
        confirmationModal.classList.add('hidden');
    });

    clearRatingsBtn.addEventListener('click', () => {
        showConfirmation('Clear All 3-Star Ratings?', 'This will permanently remove the 1-3 star rating from every image. This action cannot be undone.', async () => {
            await fetch(`${API_URL}/clear-ratings`, { method: 'POST' });
            alert('All 3-star ratings have been cleared.');
            reloadAllData();
        });
    });

    clearScoresBtn.addEventListener('click', () => {
        showConfirmation('Clear All Aesthetic Scores?', 'This will permanently remove the 0-10 aesthetic score from every image. This action cannot be undone.', async () => {
            await fetch(`${API_URL}/clear-aesthetic-scores`, { method: 'POST' });
            alert('All aesthetic scores have been cleared.');
            reloadAllData();
        });
    });

    rejectThresholdSlider.addEventListener('input', (e) => {
        rejectThresholdValue.textContent = parseFloat(e.target.value).toFixed(1);
    });
    
    viewRejectedToggle.addEventListener('change', (e) => {
        currentView = e.target.checked ? 'rejected' : 'active';
        currentPage = 1;
        reloadAllData();
    });

    loadApp();
});