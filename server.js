const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const cliProgress = require('cli-progress');
const { spawn } = require('child_process');
const logger = require('./logger');

const app = express();
const PORT = 3000;

const userMediaDir = process.argv[2];
if (!userMediaDir) {
    logger.error("Please provide a folder path by dragging a folder onto the start.bat or start.sh script.");
    process.exit(1);
}

const thumbnailDir = path.join(userMediaDir, '.thumbnails');

// --- Batch Processing State ---
let batchState = { isRunning: false, total: 0, processed: 0, currentFile: '', operationType: 'autotag' };

// --- Global AutoTagger Process Management ---
let autotaggerProcess = null;
let autotaggerReadyPromise = null;
let autotaggerOutputBuffer = '';
let autotaggerOutputCallbacks = []; // Queue for promises waiting for output lines

/**
 * Ensures the autotagger Python process is running and ready.
 * If not running, it spawns it and waits for initialization signal.
 * @param {number} threshold - The probability threshold for auto-tagging.
 * @returns {Promise<void>} A promise that resolves when the autotagger is ready.
 */
const ensureAutotaggerReady = (threshold) => {
    if (autotaggerReadyPromise) {
        return autotaggerReadyPromise; // Return existing promise if already starting/ready
    }

    autotaggerReadyPromise = new Promise((resolve, reject) => {
        logger.info(`Spawning autotag.py with threshold: ${threshold}`);
        autotaggerProcess = spawn('python', ['autotag.py', String(threshold)]);

        autotaggerProcess.stdout.on('data', (data) => {
            autotaggerOutputBuffer += data.toString();
            // Process lines as they become available
            let newlineIndex;
            while ((newlineIndex = autotaggerOutputBuffer.indexOf('\n')) !== -1) {
                const line = autotaggerOutputBuffer.substring(0, newlineIndex).trim();
                autotaggerOutputBuffer = autotaggerOutputBuffer.substring(newlineIndex + 1);
                if (autotaggerOutputCallbacks.length > 0) {
                    const callback = autotaggerOutputCallbacks.shift();
                    callback.resolve(line); // Resolve the oldest waiting promise with the line
                }
            }
        });

        autotaggerProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message) {
                logger.info(`[AutoTagger]: ${message}`);
                if (message.includes("Tagger initialized and ready.")) {
                    resolve(); // Resolve the ready promise when initialization is confirmed
                }
            }
        });

        autotaggerProcess.on('close', (code) => {
            logger.warn(`Autotagger process exited with code ${code}`);
            // Added null check for autotaggerReadyPromise
            if (code !== 0 && autotaggerReadyPromise && !autotaggerReadyPromise._resolved) { // If it exited with error before resolving ready promise
                reject(new Error(`Autotagger exited prematurely with code ${code}`));
            }
            autotaggerProcess = null; // Clear process reference
            autotaggerReadyPromise = null; // Clear promise reference
            // Reject any remaining waiting callbacks
            autotaggerOutputCallbacks.forEach(cb => cb.reject(new Error("Autotagger process closed prematurely.")));
            autotaggerOutputCallbacks = [];
        });

        autotaggerProcess.on('error', (err) => {
            logger.error(`Failed to start autotagger process: ${err.message}`);
            if (autotaggerReadyPromise && !autotaggerReadyPromise._resolved) { // If it failed before resolving ready promise
                reject(err);
            }
            autotaggerProcess = null;
            autotaggerReadyPromise = null;
            autotaggerOutputCallbacks.forEach(cb => cb.reject(err));
            autotaggerOutputCallbacks = [];
        });
    });

    // Mark promise as not yet resolved to handle premature exits
    autotaggerReadyPromise._resolved = false;
    autotaggerReadyPromise.then(() => { autotaggerReadyPromise._resolved = true; }).catch(() => { autotaggerReadyPromise._resolved = true; });

    return autotaggerReadyPromise;
};

/**
 * Sends an image path to the autotagger process and waits for tags.
 * @param {string} imagePath - The full path to the image.
 * @returns {Promise<string>} A promise that resolves with the generated tags.
 */
const getTagsFromAutotagger = (imagePath) => {
    return new Promise((resolve, reject) => {
        if (!autotaggerProcess || !autotaggerProcess.stdin.writable) {
            return reject(new Error("Autotagger process is not running or not writable."));
        }

        // Queue this promise's resolve/reject functions
        autotaggerOutputCallbacks.push({ resolve, reject });

        // Write the image path to stdin
        autotaggerProcess.stdin.write(`${imagePath}\n`);
    });
};

// Cleanup function to kill the autotagger process when the server exits
const cleanupAutotagger = () => {
    if (autotaggerProcess) {
        logger.info("Terminating autotagger process...");
        autotaggerProcess.kill(); // Send SIGTERM
        autotaggerProcess = null;
        autotaggerReadyPromise = null;
    }
};

process.on('exit', cleanupAutotagger);
process.on('SIGINT', () => { cleanupAutotagger(); process.exit(); }); // Ctrl+C
process.on('SIGTERM', cleanupAutotagger); // kill command

// --- Thumbnail Generation Logic ---
const generateThumbnails = async () => {
    try {
        await fs.mkdir(thumbnailDir, { recursive: true });
        logger.info('Checking for new images to thumbnail...');
        const files = await fs.readdir(userMediaDir);
        const imageFiles = files.filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file));
        const imagesToProcess = [];
        for (const imageFile of imageFiles) {
            const thumbPath = path.join(thumbnailDir, imageFile);
            try {
                await fs.access(thumbPath);
            } catch (error) {
                imagesToProcess.push(imageFile);
            }
        }
        if (imagesToProcess.length > 0) {
            logger.info(`Found ${imagesToProcess.length} new images to process.`);
            const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
            progressBar.start(imagesToProcess.length, 0);
            for (const imageFile of imagesToProcess) {
                const sourcePath = path.join(userMediaDir, imageFile);
                const thumbPath = path.join(thumbnailDir, imageFile);
                try {
                    await sharp(sourcePath).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(thumbPath);
                } catch (error) {
                    logger.error(`Failed to generate thumbnail for ${imageFile}: ${error.message}`);
                }
                progressBar.increment();
            }
            progressBar.stop();
            logger.info('Thumbnail generation complete.');
        } else {
            logger.info('All thumbnails are up to date.');
        }
    } catch (error) {
        logger.error(`Error during thumbnail generation: ${error.message}`);
    }
};

// --- Server Setup & Middleware ---
logger.info(`Serving media from: ${userMediaDir}`);
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/user-images', express.static(userMediaDir));
app.use('/thumbnails', express.static(thumbnailDir));

// --- Helper Functions ---
const getTextFilePath = (imageFile, directory) => {
    const { name } = path.parse(imageFile);
    return path.join(directory, `${name}.txt`);
};

// --- API Routes ---
app.get('/api/media', async (req, res) => {
    try {
        const files = await fs.readdir(userMediaDir);
        const imageFiles = files.filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file));
        const mediaData = await Promise.all(imageFiles.map(async (file) => {
            const txtPath = getTextFilePath(file, userMediaDir);
            let content = '';
            try { content = await fs.readFile(txtPath, 'utf8'); } catch (error) { /* ignore */ }
            return {
                filename: file,
                content: content.trim(),
                imageUrl: `/user-images/${encodeURIComponent(file)}`,
                thumbnailUrl: `/thumbnails/${encodeURIComponent(file)}`
            };
        }));
        res.json(mediaData);
    } catch (error) {
        logger.error(`API Error on /api/media: ${error.message}`);
        res.status(500).send('Error reading media directory.');
    }
});

app.get('/api/tags', async (req, res) => {
    try {
        const files = await fs.readdir(userMediaDir);
        const txtFiles = files.filter(file => file.endsWith('.txt'));
        const tagCounts = new Map();
        for (const file of txtFiles) {
            const content = await fs.readFile(path.join(userMediaDir, file), 'utf8');
            const uniqueTagsInFile = new Set(content.split(',').map(tag => tag.trim()).filter(Boolean));
            uniqueTagsInFile.forEach(tag => {
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            });
        }
        const tagsArray = Array.from(tagCounts, ([name, count]) => ({ name, count }));
        res.json(tagsArray);
    } catch (error) {
        logger.error(`API Error on /api/tags: ${error.message}`);
        res.status(500).send('Error reading tags.');
    }
});

app.put('/api/media/:filename', async (req, res) => {
    const txtFile = getTextFilePath(req.params.filename, userMediaDir);
    try {
        await fs.writeFile(txtFile, req.body.content);
        res.json({ message: 'File updated successfully' });
    } catch (error) {
        logger.error(`API Error on PUT /api/media: ${error.message}`);
        res.status(500).send('Error saving file.');
    }
});

app.delete('/api/media/:filename', async (req, res) => {
    const filename = req.params.filename;
    const imageFile = path.join(userMediaDir, filename);
    const txtFile = getTextFilePath(filename, userMediaDir);
    const thumbFile = path.join(thumbnailDir, filename);
    try {
        await fs.unlink(imageFile);
        try { await fs.unlink(txtFile); } catch (e) { /* ignore if no txt file */ logger.warn(`No text file to delete for ${filename}`); }
        try { await fs.unlink(thumbFile); } catch (e) { /* ignore if no thumb file */ logger.warn(`No thumbnail to delete for ${filename}`); }
        res.json({ message: 'Files deleted successfully' });
    } catch (error) {
        logger.error(`API Error on DELETE /api/media: ${error.message}`);
        res.status(500).send('Error deleting files.');
    }
});

app.delete('/api/tags/:tag', async (req, res) => {
    const tagToRemove = decodeURIComponent(req.params.tag);
    try {
        const files = await fs.readdir(userMediaDir);
        const txtFiles = files.filter(file => file.endsWith('.txt'));
        for (const file of txtFiles) {
            const filePath = path.join(userMediaDir, file);
            let content = '';
            try {
                content = await fs.readFile(filePath, 'utf8');
            } catch (readError) {
                logger.warn(`Could not read text file ${file} for tag removal: ${readError.message}`);
                continue; // Skip to next file if read fails
            }
            
            const tags = content.split(',').map(t => t.trim()).filter(Boolean);
            if (tags.some(t => t.toLowerCase() === tagToRemove.toLowerCase())) {
                const newTags = tags.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase());
                try {
                    await fs.writeFile(filePath, newTags.join(', '));
                } catch (writeError) {
                    logger.error(`Failed to write to text file ${file} during tag removal: ${writeError.message}`);
                }
            }
        }
        res.json({ message: `Tag '${tagToRemove}' removed from all files.` });
    } catch (error) {
        logger.error(`API Error on DELETE /api/tags: ${error.message}`);
        res.status(500).send('Error removing tag.');
    }
});

// Single image auto-tagging using the persistent autotagger process
app.post('/api/autotag/:filename', async (req, res) => {
    const filename = req.params.filename;
    const imagePath = path.join(userMediaDir, filename);
    const threshold = req.body.threshold || 0.3; // This threshold will initialize or re-initialize the global process

    logger.info(`Single auto-tagging request for: ${filename} with threshold: ${threshold}`);
    try {
        await ensureAutotaggerReady(threshold); // Ensure process is ready
        const tags = await getTagsFromAutotagger(imagePath);
        logger.info(`Successfully generated tags for: ${filename}`);
        res.json({ tags });
    } catch (error) {
        logger.error(`Auto-tagging script failed for ${filename}: ${error.message}`);
        res.status(500).json({ error: 'Failed to generate tags.', details: error.message });
    }
});

// Modified batch tagging endpoint to handle multiple operation types and use persistent autotagger
app.post('/api/autotag-batch', async (req, res) => {
    if (batchState.isRunning) {
        return res.status(409).json({ message: "A batch job is already in progress." });
    }
    const { filenames, operationType, threshold, mode, customTag, tagToFind, tagToReplace } = req.body;
    if (!filenames || filenames.length === 0) {
        return res.status(400).json({ message: "No filenames provided for batch operation." });
    }

    batchState = { isRunning: true, total: filenames.length, processed: 0, currentFile: '', operationType: operationType || 'autotag' };
    res.status(202).json({ message: "Batch operation process started." });

    // Start autotagger process if operation is autotag and it's not already running
    if (batchState.operationType === 'autotag') {
        try {
            await ensureAutotaggerReady(threshold);
        } catch (error) {
            logger.error(`Failed to start autotagger for batch: ${error.message}`);
            batchState.isRunning = false;
            return;
        }
    }

    // Process files in the background
    (async () => {
        for (const filename of filenames) {
            if (!batchState.isRunning) {
                logger.info("Batch operation process was cancelled by user.");
                break;
            }
            batchState.currentFile = filename;
            const txtPath = getTextFilePath(filename, userMediaDir);
            const imagePath = path.join(userMediaDir, filename);

            try {
                let currentContent = await fs.readFile(txtPath, 'utf8').catch(() => '');
                let existingTags = currentContent.split(',').map(t => t.trim()).filter(Boolean);
                let finalTags = new Set(existingTags);

                if (batchState.operationType === 'autotag') {
                    try {
                        // Check if image file exists before requesting tags from autotagger
                        await fs.access(imagePath);
                        const generatedTags = await getTagsFromAutotagger(imagePath); // Use persistent autotagger
                        let newTags = generatedTags.split(',').map(t => t.trim()).filter(Boolean);
                        const customTagClean = customTag ? customTag.trim() : null;
    
                        if (mode === 'replace') {
                            finalTags.clear();
                            newTags.forEach(t => finalTags.add(t));
                            if (customTagClean) finalTags.add(customTagClean);
                        } else if (mode === 'prepend') {
                            const tempTags = new Set();
                            newTags.forEach(t => tempTags.add(t));
                            if (customTagClean) tempTags.add(customTagClean);
                            existingTags.forEach(t => tempTags.add(t));
                            finalTags = tempTags;
                        } else { // Append by default
                            if (customTagClean) finalTags.add(customTagClean);
                            newTags.forEach(t => finalTags.add(t));
                        }
                    } catch (autotagError) {
                        if (autotagError.message.includes('No such file or directory') || autotagError.message.includes('Image file not found')) {
                            logger.warn(`Skipping autotag for ${filename}: image file not found. ${autotagError.message}`);
                            // Do not update the text file if image is missing
                            batchState.processed++;
                            continue; // Move to next file
                        } else {
                            throw autotagError;
                        }
                    }
                } else if (batchState.operationType === 'find-replace') {
                    const findTag = tagToFind.toLowerCase();
                    const replaceTag = tagToReplace ? tagToReplace.trim() : null;

                    const tempTags = new Set();
                    existingTags.forEach(tag => {
                        if (tag.toLowerCase() === findTag) {
                            if (replaceTag) {
                                tempTags.add(replaceTag);
                            }
                        } else {
                            tempTags.add(tag);
                        }
                    });
                    finalTags = tempTags;
                }

                try {
                    await fs.writeFile(txtPath, Array.from(finalTags).join(', '));
                } catch (writeError) {
                    logger.error(`Failed to write tags for ${filename}: ${writeError.message}`);
                }
            } catch (error) {
                logger.error(`Error processing ${filename} in batch: ${error.message}`);
            }
            batchState.processed++;
        }
        batchState.isRunning = false;
        logger.info("Batch operation process finished.");
        cleanupAutotagger(); // Terminate autotagger process after batch completion
    })();
});

app.get('/api/autotag-batch/status', (req, res) => {
    res.json(batchState);
});

app.post('/api/autotag-batch/cancel', (req, res) => {
    if (batchState.isRunning) {
        batchState.isRunning = false;
        logger.info("Received request to cancel batch job.");
        cleanupAutotagger(); // Terminate autotagger process on cancel
        res.status(200).json({ message: "Batch job cancellation requested." });
    } else {
        res.status(404).json({ message: "No batch job is currently running." });
    }
});

// --- Start Server ---
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server started. Listening on all network interfaces.`);
    logger.info(`Open your browser to http://localhost:${PORT} on this machine.`);
    logger.info(`On other devices, connect to this machine's local IP address on port ${PORT}.`);
    generateThumbnails();
});