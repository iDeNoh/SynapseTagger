document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let allMediaData = [];
    let currentGalleryFilenames = [];
    let allTagsData = [];
    let activeFilterTag = null;
    let currentSort = 'alpha';
    let selectedFilename = null;
    let currentEditorIndex = -1;
    let previewTimer = null;
    let currentPage = 1;
    let itemsPerPage = 50;
    let batchStatusInterval = null;
    let touchStartX = 0; // For swipe detection
    let touchEndX = 0;   // For swipe detection

    // --- DOM Elements ---
    const galleryViewBtn = document.getElementById('gallery-view-btn');
    const batchViewBtn = document.getElementById('batch-view-btn');
    const galleryEditorView = document.getElementById('gallery-editor-view');
    const batchView = document.getElementById('batch-view');
    const startBatchBtn = document.getElementById('start-batch-btn');
    const batchSummaryText = document.getElementById('batch-summary-text');
    const batchCustomTagInput = document.getElementById('batch-custom-tag');
    const cancelBatchBtn = document.getElementById('cancel-batch-btn');
    const batchPreviewImage = document.getElementById('batch-preview-image');
    const batchProgressContainer = document.getElementById('batch-progress-container');
    const batchProgressBar = document.getElementById('batch-progress-bar');
    const batchProgressText = document.getElementById('batch-progress-text');
    const thresholdSliderEditor = document.getElementById('autotag-threshold-editor');
    const thresholdValueEditor = document.getElementById('threshold-value-editor');
    const thresholdSliderBatch = document.getElementById('autotag-threshold-batch');
    const thresholdValueBatch = document.getElementById('threshold-value-batch');
    const autotagBtn = document.getElementById('autotag-btn');
    const sidebar = document.querySelector('.sidebar');
    const mobileTagsToggle = document.getElementById('mobile-tags-toggle');
    const imageGallery = document.getElementById('image-gallery');
    const tagListContainer = document.getElementById('tag-list-container');
    const editorView = document.getElementById('editor-view');
    const galleryView = document.getElementById('gallery-view');
    const editorImage = document.getElementById('editor-image');
    const editorImageContainer = document.getElementById('editor-image-container');
    const editorTextarea = document.getElementById('editor-textarea');
    const backToGalleryBtn = document.getElementById('back-to-gallery-btn');
    const saveBtn = document.getElementById('save-btn');
    const resetBtn = document.getElementById('reset-btn');
    const deleteImageBtn = document.getElementById('delete-image-btn');
    const prevImageBtn = document.getElementById('prev-image-btn');
    const nextImageBtn = document.getElementById('next-image-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const previewModal = document.getElementById('preview-modal');
    const previewImage = document.getElementById('preview-image');
    const sortTagsSelect = document.getElementById('sort-tags-select');
    const clearFilterBtn = document.getElementById('clear-filter-btn');
    const itemsPerPageSelect = document.getElementById('items-per-page');
    const paginationBottom = document.getElementById('pagination-bottom');
    const API_URL = '/api';

    // --- View Switching ---
    const showView = async (viewId) => {
        [galleryEditorView, batchView].forEach(view => view.classList.add('hidden'));
        [galleryViewBtn, batchViewBtn].forEach(btn => btn.classList.remove('active'));
        const viewToShow = document.getElementById(viewId);
        const btnToActivate = document.getElementById(viewId.replace('-view', '-view-btn'));
        if (viewToShow) viewToShow.classList.remove('hidden');
        if (btnToActivate) btnToActivate.classList.add('active');
        if (viewId === 'batch-view') {
            try {
                const response = await fetch(`${API_URL}/autotag-batch/status`);
                const status = await response.json();
                if (status.isRunning) {
                    startBatchBtn.classList.add('hidden');
                    batchProgressContainer.classList.remove('hidden');
                } else {
                    batchSummaryText.textContent = `This will tag all ${currentGalleryFilenames.length} currently visible images.`;
                    startBatchBtn.classList.remove('hidden');
                    batchProgressContainer.classList.add('hidden');
                }
            } catch (error) {
                console.error("Could not get batch status:", error);
                batchSummaryText.textContent = "Could not retrieve batch status.";
            }
        }
    };

    // --- Batch Processing ---
    const startBatchTagging = async () => {
        if (!confirm(`This will attempt to auto-tag all ${currentGalleryFilenames.length} currently visible images. This may take a long time. Continue?`)) return;
        startBatchBtn.classList.add('hidden');
        batchProgressContainer.classList.remove('hidden');
        batchViewBtn.classList.add('is-running');
        const threshold = parseFloat(thresholdSliderBatch.value) / 100;
        const mode = document.querySelector('input[name="batch-mode"]:checked').value;
        const customTag = batchCustomTagInput.value;
        await fetch(`${API_URL}/autotag-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filenames: currentGalleryFilenames, threshold, mode, customTag })
        });
        if (!batchStatusInterval) {
            batchStatusInterval = setInterval(checkBatchStatus, 2000);
        }
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
                batchProgressText.textContent = `Processing ${status.processed} of ${status.total}: ${status.currentFile}`;
            }
            if (!status.isRunning && status.total > 0) {
                clearInterval(batchStatusInterval);
                batchStatusInterval = null;
                batchViewBtn.classList.remove('is-running');
                if (!batchView.classList.contains('hidden')) {
                    batchProgressText.textContent = 'Batch complete! Reloading...';
                    batchProgressBar.style.width = '100%';
                    setTimeout(() => {
                        showView('gallery-editor-view');
                        reloadAllData();
                    }, 2000);
                } else {
                    alert('Batch tagging complete!');
                    reloadAllData();
                }
            }
        } catch (error) {
            console.error("Failed to check batch status:", error);
            batchViewBtn.classList.remove('is-running');
            clearInterval(batchStatusInterval);
        }
    };
    
    const cancelBatchTagging = async () => {
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
                // Corrected behavior: show indicator and poll without changing the page
                batchViewBtn.classList.add('is-running');
                batchStatusInterval = setInterval(checkBatchStatus, 2000);
            }
        } catch (error) {
            console.error("Could not resume batch state:", error);
        }
    };
    // --- Data Fetching, Rendering & Other Functions ---
    const fetchMedia = async () => { try { const response = await fetch(`${API_URL}/media`); allMediaData = await response.json(); } catch (error) { console.error('Failed to fetch media:', error); alert('Could not fetch media. Is the server running?'); } };
    const fetchTags = async () => { try { const response = await fetch(`${API_URL}/tags`); allTagsData = await response.json(); } catch (error) { console.error('Failed to fetch tags:', error); } };
    const preloadImages = (index) => { if (index < currentGalleryFilenames.length - 1) { const nextItem = allMediaData.find(m => m.filename === currentGalleryFilenames[index + 1]); if (nextItem) new Image().src = nextItem.imageUrl; } if (index > 0) { const prevItem = allMediaData.find(m => m.filename === currentGalleryFilenames[index - 1]); if (prevItem) new Image().src = prevItem.imageUrl; } };
    const renderGallery = () => { let itemsToFilter = allMediaData; if (activeFilterTag) { itemsToFilter = allMediaData.filter(item => item.content.split(',').map(t => t.trim()).includes(activeFilterTag)); clearFilterBtn.classList.remove('hidden'); } else { clearFilterBtn.classList.add('hidden'); } currentGalleryFilenames = itemsToFilter.map(item => item.filename); let pageItems = []; if (itemsPerPage === 'all') { pageItems = itemsToFilter; } else { const startIndex = (currentPage - 1) * itemsPerPage; const endIndex = startIndex + itemsPerPage; pageItems = itemsToFilter.slice(startIndex, endIndex); } imageGallery.innerHTML = ''; pageItems.forEach(item => { const div = document.createElement('div'); div.className = 'gallery-item'; div.dataset.filename = item.filename; div.innerHTML = `<img src="${item.thumbnailUrl}" alt="${item.filename}" loading="lazy"><div class="preview-icon-container" data-filename="${item.filename}"><svg viewBox="0 0 24 24" class="preview-icon"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"></path></svg><svg class="progress-circle-svg" width="32" height="32" viewBox="0 0 32 32"><circle class="progress-circle__track" r="14" cx="16" cy="16" stroke-width="3"></circle><circle class="progress-circle__value" r="14" cx="16" cy="16" stroke-width="3"></circle></svg></div>`; imageGallery.appendChild(div); }); renderPagination(); };
    const renderPagination = () => { if (itemsPerPage === 'all' || currentGalleryFilenames.length <= itemsPerPage) { paginationBottom.innerHTML = ''; return; } const totalPages = Math.ceil(currentGalleryFilenames.length / itemsPerPage); paginationBottom.innerHTML = generatePaginationHTML(totalPages); };
    const generatePaginationHTML = (totalPages) => { if (totalPages <= 1) return ''; let html = `<button class="page-btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>&laquo; Prev</button><button class="page-btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>Next &raquo;</button>`; for (let i = 1; i <= totalPages; i++) { html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`; } return html; };
    const renderTagList = () => { const sortedTags = [...allTagsData].sort((a, b) => { if (currentSort === 'count-desc') return b.count - a.count; if (currentSort === 'count-asc') return a.count - b.count; return a.name.localeCompare(b.name); }); tagListContainer.innerHTML = ''; sortedTags.forEach(tag => { const div = document.createElement('div'); div.className = `tag-item ${tag.name === activeFilterTag ? 'filtered' : ''}`; div.dataset.tag = tag.name; div.innerHTML = `<span class="tag-name">${tag.name}</span><div style="display:flex; align-items: center;"><span class="tag-count">${tag.count}</span><button class="delete-tag-btn" data-tag="${tag.name}">-</button></div>`; tagListContainer.appendChild(div); }); };
    const reloadAllData = async () => { await Promise.all([fetchMedia(), fetchTags()]); renderTagList(); renderGallery(); };
    const showEditor = (filename) => { selectedFilename = filename; currentEditorIndex = currentGalleryFilenames.indexOf(filename); if (currentEditorIndex === -1) return; const item = allMediaData.find(m => m.filename === filename); if (!item) return; editorImage.src = item.imageUrl; editorTextarea.value = item.content; prevImageBtn.disabled = currentEditorIndex === 0; nextImageBtn.disabled = currentEditorIndex === currentGalleryFilenames.length - 1; const existingIcon = editorImageContainer.querySelector('.preview-icon-container'); if (existingIcon) existingIcon.remove(); const previewIconHTML = `<div class="preview-icon-container editor-preview-icon" data-filename="${item.filename}"><svg viewBox="0 0 24 24" class="preview-icon"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"></path></svg><svg class="progress-circle-svg" width="32" height="32" viewBox="0 0 32 32"><circle class="progress-circle__track" r="14" cx="16" cy="16" stroke-width="3"></circle><circle class="progress-circle__value" r="14" cx="16" cy="16" stroke-width="3"></circle></svg></div>`; editorImageContainer.insertAdjacentHTML('beforeend', previewIconHTML); galleryView.classList.add('hidden'); editorView.classList.remove('hidden'); preloadImages(currentEditorIndex); };
    const showGallery = () => { galleryView.classList.remove('hidden'); editorView.classList.add('hidden'); selectedFilename = null; currentEditorIndex = -1; };
    const showPreview = (filename) => { const item = allMediaData.find(m => m.filename === filename); if (item) { previewImage.src = item.imageUrl; previewModal.classList.remove('hidden'); } };
    const hidePreview = () => { previewModal.classList.add('hidden'); previewImage.src = ''; };
    const handleEscapeKey = (e) => { if (e.key === 'Escape') hidePreview(); };
    const initializeTheme = () => { const isDarkMode = localStorage.getItem('theme') === 'dark'; themeToggle.checked = isDarkMode; document.body.classList.toggle('dark-mode', isDarkMode); };
    
    // --- Main Initial Load Function ---
    const loadApp = async () => {
        const initialItemsPerPage = itemsPerPageSelect.value;
        itemsPerPage = initialItemsPerPage === 'all' ? 'all' : parseInt(initialItemsPerPage, 10);
        initializeTheme();
        await reloadAllData();
        await resumeBatchState();
    };

    // --- Event Listeners ---
    galleryViewBtn.addEventListener('click', () => showView('gallery-editor-view'));
    batchViewBtn.addEventListener('click', () => showView('batch-view'));
    startBatchBtn.addEventListener('click', startBatchTagging);
    cancelBatchBtn.addEventListener('click', cancelBatchTagging);
    mobileTagsToggle.addEventListener('click', () => { sidebar.classList.toggle('is-visible'); });
    itemsPerPageSelect.addEventListener('change', (e) => { const value = e.target.value; itemsPerPage = value === 'all' ? 'all' : parseInt(value, 10); currentPage = 1; renderGallery(); });
    themeToggle.addEventListener('change', () => { document.body.classList.toggle('dark-mode'); localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light'); });
    sortTagsSelect.addEventListener('change', (e) => { currentSort = e.target.value; renderTagList(); });
    clearFilterBtn.addEventListener('click', () => { activeFilterTag = null; currentPage = 1; renderGallery(); renderTagList(); });
    paginationBottom.addEventListener('click', (e) => { const target = e.target.closest('.page-btn'); if (!target) return; const pageAction = target.dataset.page; const totalPages = Math.ceil(currentGalleryFilenames.length / itemsPerPage); if (pageAction === 'prev') { if (currentPage > 1) currentPage--; } else if (pageAction === 'next') { if (currentPage < totalPages) currentPage++; } else { currentPage = parseInt(pageAction, 10); } renderGallery(); galleryView.scrollIntoView({ behavior: 'smooth' }); });
    imageGallery.addEventListener('click', (e) => { const itemElement = e.target.closest('.gallery-item'); if (!itemElement) return; const filename = itemElement.dataset.filename; if (e.target.closest('.preview-icon-container')) { clearTimeout(previewTimer); showPreview(filename); } else { showEditor(filename); } });
    imageGallery.addEventListener('mouseover', (e) => { const iconContainer = e.target.closest('.preview-icon-container'); if (iconContainer) { previewTimer = setTimeout(() => showPreview(iconContainer.dataset.filename), 1000); } });
    imageGallery.addEventListener('mouseout', (e) => { if (e.target.closest('.preview-icon-container')) { clearTimeout(previewTimer); } });
    tagListContainer.addEventListener('click', async (e) => { sidebar.classList.remove('is-visible'); const tagItem = e.target.closest('.tag-item'); if (!tagItem) return; const tag = tagItem.dataset.tag; if (e.target.classList.contains('delete-tag-btn')) { if (confirm(`Are you sure you want to remove the tag "${tag}" from ALL files?`)) { await fetch(`${API_URL}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }); currentPage = 1; await reloadAllData(); } } else { activeFilterTag = tag; currentPage = 1; renderGallery(); renderTagList(); } });
    const setupEditorPreviewListeners = (container) => { container.addEventListener('click', (e) => { if (e.target.closest('.preview-icon-container')) { clearTimeout(previewTimer); showPreview(selectedFilename); } }); container.addEventListener('mouseover', (e) => { if (e.target.closest('.preview-icon-container')) { previewTimer = setTimeout(() => showPreview(selectedFilename), 1000); } }); container.addEventListener('mouseout', (e) => { if (e.target.closest('.preview-icon-container')) { clearTimeout(previewTimer); } }); };
    setupEditorPreviewListeners(editorImageContainer);
    prevImageBtn.addEventListener('click', () => { if (currentEditorIndex > 0) showEditor(currentGalleryFilenames[currentEditorIndex - 1]); });
    nextImageBtn.addEventListener('click', () => { if (currentEditorIndex < currentGalleryFilenames.length - 1) showEditor(currentGalleryFilenames[currentEditorIndex + 1]); });
    backToGalleryBtn.addEventListener('click', showGallery);
    previewModal.addEventListener('click', hidePreview);
    resetBtn.addEventListener('click', () => { if (!selectedFilename) return; const item = allMediaData.find(m => m.filename === selectedFilename); editorTextarea.value = item ? item.content : ''; });
    saveBtn.addEventListener('click', async () => { if (!selectedFilename) return; await fetch(`${API_URL}/media/${selectedFilename}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editorTextarea.value }), }); await reloadAllData(); alert('Changes saved!'); });
    deleteImageBtn.addEventListener('click', async () => {
        if (!selectedFilename) return;

        // Determine which image to show next
        const indexToDelete = currentGalleryFilenames.indexOf(selectedFilename);
        let nextFilenameToShow = null;

        if (currentGalleryFilenames.length > 1) {
            // If it's the last image in the list, target the one before it.
            if (indexToDelete === currentGalleryFilenames.length - 1) {
                nextFilenameToShow = currentGalleryFilenames[indexToDelete - 1];
            } else {
                // Otherwise, target the one that came after it.
                nextFilenameToShow = currentGalleryFilenames[indexToDelete + 1];
            }
        }

        if (confirm(`Are you sure you want to permanently delete ${selectedFilename}?`)) {
            // Delete the file on the server
            await fetch(`${API_URL}/media/${selectedFilename}`, { method: 'DELETE' });

            // Reload all the data to update the lists
            await reloadAllData();

            if (nextFilenameToShow) {
                // If there's another image to show, load it in the editor
                showEditor(nextFilenameToShow);
            } else {
                // If that was the last image, go back to the now-empty gallery
                showGallery();
            }
        }
    });
    thresholdSliderEditor.addEventListener('input', (e) => { thresholdValueEditor.textContent = `${e.target.value}%`; });
    thresholdSliderBatch.addEventListener('input', (e) => { thresholdValueBatch.textContent = `${e.target.value}%`; });
    autotagBtn.addEventListener('click', async () => { if (!selectedFilename || autotagBtn.classList.contains('is-loading')) return; autotagBtn.classList.add('is-loading'); autotagBtn.textContent = 'Tagging...'; const threshold = parseFloat(thresholdSliderEditor.value) / 100; const mode = document.querySelector('input[name="editor-mode"]:checked').value; try { const response = await fetch(`${API_URL}/autotag/${selectedFilename}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threshold: threshold }) }); if (!response.ok) { throw new Error(`Server responded with status: ${response.status}`); } const data = await response.json(); const existingTags = editorTextarea.value.split(',').map(t => t.trim()).filter(Boolean); const newTags = data.tags.split(',').map(t => t.trim()).filter(Boolean); let finalTags = new Set(); if (mode === 'replace') { newTags.forEach(t => finalTags.add(t)); } else if (mode === 'prepend') { newTags.forEach(t => finalTags.add(t)); existingTags.forEach(t => finalTags.add(t)); } else { existingTags.forEach(t => finalTags.add(t)); newTags.forEach(t => finalTags.add(t)); } editorTextarea.value = Array.from(finalTags).join(', '); } catch (error) { console.error('Auto-tagging failed:', error); alert('Auto-tagging failed. Check the server console for more details.'); } finally { autotagBtn.classList.remove('is-loading'); autotagBtn.textContent = 'Auto-Tag this Image'; } });
    
    // --- Swipe Navigation for Editor ---
    editorImageContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    editorImageContainer.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });

    const handleSwipe = () => {
        const swipeThreshold = 50; // Minimum distance for a swipe
        if (touchEndX < touchStartX - swipeThreshold) {
            // Swiped left
            nextImageBtn.click();
        }
        if (touchEndX > touchStartX + swipeThreshold) {
            // Swiped right
            prevImageBtn.click();
        }
    };
    
    document.addEventListener('keydown', (e) => {
        // Global handler for Escape key to close preview modal
        if ((e.key === 'Escape'|| e.key === 'f') && !previewModal.classList.contains('hidden')) {
            hidePreview();
            return;
        }

        // Editor-only shortcuts
        if (editorView.classList.contains('hidden') || e.target === editorTextarea) {
            return;
        }

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                prevImageBtn.click();
                break;
            case 'ArrowRight':
                e.preventDefault();
                nextImageBtn.click();
                break;
            case 'Delete':
                e.preventDefault();
                deleteImageBtn.click();
                break;
            case 'f':
                e.preventDefault();
                // Call the existing preview function with the current image
                showPreview(selectedFilename);
                break;
        }
    });
    // --- Initial Load ---
    loadApp();
});