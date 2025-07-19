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

let userMediaDir = process.argv[2] || "./media";
const rejectedDir = path.join(userMediaDir, 'rejected');
const finalDir = path.join(userMediaDir, 'final');
const thumbnailDir = path.join(userMediaDir, '.thumbnails');
const rejectedThumbnailDir = path.join(rejectedDir, '.thumbnails');

let batchState = { isRunning: false, total: 0, processed: 0, currentFile: '', operationType: 'autotag' };
let autotaggerProcess = null;
let autotaggerReadyPromise = null;
let autotaggerOutputBuffer = '';
let autotaggerOutputCallbacks = [];

const ensureAutotaggerReady = (threshold) => {
    if (autotaggerReadyPromise) return autotaggerReadyPromise;
    autotaggerReadyPromise = new Promise((resolve, reject) => {
        logger.info(`Spawning autotag.py with threshold: ${threshold}`);
        autotaggerProcess = spawn('python', ['autotag.py', String(threshold)]);
        autotaggerProcess.stdout.on('data', (data) => {
            autotaggerOutputBuffer += data.toString();
            let newlineIndex;
            while ((newlineIndex = autotaggerOutputBuffer.indexOf('\n')) !== -1) {
                const line = autotaggerOutputBuffer.substring(0, newlineIndex).trim();
                autotaggerOutputBuffer = autotaggerOutputBuffer.substring(newlineIndex + 1);
                if (autotaggerOutputCallbacks.length > 0) autotaggerOutputCallbacks.shift().resolve(line);
            }
        });
        autotaggerProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message) {
                logger.info(`[AutoTagger]: ${message}`);
                if (message.includes("Tagger initialized and ready.")) resolve();
            }
        });
        autotaggerProcess.on('close', (code) => {
            logger.warn(`Autotagger process exited with code ${code}`);
            autotaggerProcess = null;
            autotaggerReadyPromise = null;
        });
    });
    return autotaggerReadyPromise;
};

const getTagsFromAutotagger = (imagePath) => {
    return new Promise((resolve, reject) => {
        if (!autotaggerProcess || !autotaggerProcess.stdin.writable) return reject(new Error("Autotagger process is not running or not writable."));
        autotaggerOutputCallbacks.push({ resolve, reject });
        autotaggerProcess.stdin.write(`${imagePath}\n`);
    });
};

const cleanupAutotagger = () => {
    if (autotaggerProcess) {
        logger.info("Terminating autotagger process...");
        autotaggerProcess.kill();
        autotaggerProcess = null;
        autotaggerReadyPromise = null;
    }
};

const generateThumbnails = async (sourceDir, thumbDir) => {
    try {
        await fs.mkdir(thumbDir, { recursive: true });
        const files = await fs.readdir(sourceDir);
        const imageFiles = files.filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file));
        for (const imageFile of imageFiles) {
            const thumbPath = path.join(thumbDir, imageFile);
            try { await fs.access(thumbPath); } catch (error) {
                const sourcePath = path.join(sourceDir, imageFile);
                await sharp(sourcePath).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(thumbPath);
            }
        }
    } catch (error) {
        if (error.code !== 'ENOENT') logger.error(`Error during thumbnail generation in ${sourceDir}: ${error.message}`);
    }
};

const getTextFilePath = (imageFile, directory) => {
    const { name } = path.parse(imageFile);
    return path.join(directory, `${name}.txt`);
};

const moveFile = async (filename, fromDir, toDir) => {
    await fs.mkdir(toDir, { recursive: true });
    const fromThumbDir = path.join(fromDir, '.thumbnails');
    const toThumbDir = path.join(toDir, '.thumbnails');
    await fs.mkdir(toThumbDir, { recursive: true });
    const sourceImg = path.join(fromDir, filename);
    const destImg = path.join(toDir, filename);
    const sourceTxt = getTextFilePath(filename, fromDir);
    const destTxt = getTextFilePath(filename, toDir);
    const sourceThumb = path.join(fromThumbDir, filename);
    const destThumb = path.join(toThumbDir, filename);
    await fs.rename(sourceImg, destImg).catch(e => logger.warn(`Could not move image: ${filename}`));
    await fs.rename(sourceTxt, destTxt).catch(e => {});
    await fs.rename(sourceThumb, destThumb).catch(e => {});
};

logger.info(`Serving media from: ${userMediaDir}`);
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/user-images', express.static(userMediaDir));
app.use('/thumbnails', express.static(thumbnailDir));
app.use('/rejected-images', express.static(rejectedDir));
app.use('/rejected-thumbnails', express.static(rejectedThumbnailDir));

app.get('/api/media', async (req, res) => {
    const view = req.query.view || 'active';
    const mediaDir = view === 'rejected' ? rejectedDir : userMediaDir;
    const thumbUrlPrefix = view === 'rejected' ? '/rejected-thumbnails' : '/thumbnails';
    const imageUrlPrefix = view === 'rejected' ? '/rejected-images' : '/user-images';
    try {
        await fs.mkdir(mediaDir, { recursive: true });
        const files = await fs.readdir(mediaDir);
        const imageFiles = files.filter(file => /\.(jpe?g|png|gif|webp)$/i.test(file));
        const mediaData = await Promise.all(imageFiles.map(async (file) => {
            const txtPath = getTextFilePath(file, mediaDir);
            let content = '', metadata = {}, rating = 0, aesthetic_score = null;
            try {
                content = await fs.readFile(txtPath, 'utf8');
                const ratingMatch = content.match(/rating:(\d)/);
                if (ratingMatch) rating = parseInt(ratingMatch[1], 10);
                const scoreMatch = content.match(/aesthetic_score:([\d.]+)/);
                if (scoreMatch) aesthetic_score = parseFloat(scoreMatch[1]);
            } catch (error) {}
            try {
                const imageMetadata = await sharp(path.join(mediaDir, file)).metadata();
                metadata = { width: imageMetadata.width, height: imageMetadata.height, format: imageMetadata.format };
            } catch (error) { logger.error(`Could not read metadata for ${file}: ${error.message}`); }
            return { filename: file, content: content.trim(), imageUrl: `${imageUrlPrefix}/${encodeURIComponent(file)}`, thumbnailUrl: `${thumbUrlPrefix}/${encodeURIComponent(file)}`, metadata, rating, aesthetic_score };
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
    const isRejected = req.body.isRejected || false;
    const mediaDir = isRejected ? rejectedDir : userMediaDir;
    const txtFile = getTextFilePath(req.params.filename, mediaDir);
    try {
        await fs.writeFile(txtFile, req.body.content);
        res.json({ message: 'File updated successfully' });
    } catch (error) {
        logger.error(`API Error on PUT /api/media: ${error.message}`);
        res.status(500).send('Error saving file.');
    }
});

app.post('/api/reject/:filename', async (req, res) => {
    await moveFile(req.params.filename, userMediaDir, rejectedDir);
    res.json({ message: 'File rejected successfully' });
});

app.post('/api/restore/:filename', async (req, res) => {
    await moveFile(req.params.filename, rejectedDir, userMediaDir);
    res.json({ message: 'File restored successfully' });
});

app.delete('/api/tags/:tag', async (req, res) => {
    const tagToRemove = decodeURIComponent(req.params.tag);
    try {
        const files = await fs.readdir(userMediaDir);
        const txtFiles = files.filter(file => file.endsWith('.txt'));
        for (const file of txtFiles) {
            const filePath = path.join(userMediaDir, file);
            let content = await fs.readFile(filePath, 'utf8').catch(() => '');
            const tags = content.split(',').map(t => t.trim()).filter(Boolean);
            if (tags.some(t => t.toLowerCase() === tagToRemove.toLowerCase())) {
                const newTags = tags.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase());
                await fs.writeFile(filePath, newTags.join(', '));
            }
        }
        res.json({ message: `Tag '${tagToRemove}' removed from all files.` });
    } catch (error) {
        logger.error(`API Error on DELETE /api/tags: ${error.message}`);
        res.status(500).send('Error removing tag.');
    }
});

app.post('/api/autotag/:filename', async (req, res) => {
    const filename = req.params.filename;
    const imagePath = path.join(userMediaDir, filename);
    const threshold = req.body.threshold || 0.3;
    try {
        await ensureAutotaggerReady(threshold);
        const tags = await getTagsFromAutotagger(imagePath);
        res.json({ tags });
    } catch (error) {
        logger.error(`Auto-tagging script failed for ${filename}: ${error.message}`);
        res.status(500).json({ error: 'Failed to generate tags.', details: error.message });
    }
});

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
    let childProcess = null;
    let outputBuffer = '';
    let outputCallbacks = [];
    const cleanupChildProcess = () => {
        if (childProcess) {
            childProcess.kill();
            childProcess = null;
        }
        cleanupAutotagger();
    };
    const runProcessAndGetOutput = (imagePath) => {
        return new Promise((resolve, reject) => {
            if (!childProcess || !childProcess.stdin.writable) return reject(new Error("Child process is not running or not writable."));
            outputCallbacks.push({ resolve, reject });
            childProcess.stdin.write(`${imagePath}\n`);
        });
    };
    const initializeProcess = (script, args = []) => {
        return new Promise((resolve, reject) => {
            childProcess = spawn('python', [script, ...args]);
            childProcess.stdout.on('data', (data) => {
                outputBuffer += data.toString();
                let newlineIndex;
                while ((newlineIndex = outputBuffer.indexOf('\n')) !== -1) {
                    const line = outputBuffer.substring(0, newlineIndex).trim();
                    outputBuffer = outputBuffer.substring(newlineIndex + 1);
                    if (outputCallbacks.length > 0) outputCallbacks.shift().resolve(line);
                }
            });
            childProcess.stderr.on('data', (data) => {
                const message = data.toString().trim();
                if (message) {
                    logger.info(`[${script}]: ${message}`);
                    if (message.includes("initialized and ready.")) resolve();
                }
            });
            childProcess.on('close', (code) => {
                logger.warn(`${script} exited with code ${code}`);
                childProcess = null;
            });
        });
    };
    (async () => {
        try {
            if (operationType === 'autotag') await initializeProcess('autotag.py', [String(threshold)]);
            else if (operationType === 'rate_general') await initializeProcess('aesthetic_rater_general.py');
            else if (operationType === 'rate_anime') await initializeProcess('aesthetic_rater_anime.py');
            for (const filename of filenames) {
                if (!batchState.isRunning) break;
                batchState.currentFile = filename;
                const txtPath = getTextFilePath(filename, userMediaDir);
                const imagePath = path.join(userMediaDir, filename);
                let currentContent = await fs.readFile(txtPath, 'utf8').catch(() => '');
                let existingTags = new Set(currentContent.split(',').map(t => t.trim()).filter(Boolean));
                if (operationType === 'autotag') {
                    const generatedTagsText = await runProcessAndGetOutput(imagePath);
                    let newTags = generatedTagsText.split(',').map(t => t.trim()).filter(Boolean);
                    if (mode === 'replace') {
                        const ratingTag = Array.from(existingTags).find(t => t.startsWith('rating:'));
                        const scoreTag = Array.from(existingTags).find(t => t.startsWith('aesthetic_score:'));
                        existingTags.clear();
                        newTags.forEach(t => existingTags.add(t));
                        if(ratingTag) existingTags.add(ratingTag);
                        if(scoreTag) existingTags.add(scoreTag);
                    } else if (mode === 'prepend') {
                        const tempTags = new Set(newTags);
                        existingTags.forEach(t => tempTags.add(t));
                        existingTags = tempTags;
                    } else {
                        newTags.forEach(t => existingTags.add(t));
                    }
                    if (customTag) existingTags.add(customTag.trim());
                } else if (operationType === 'rate_general' || operationType === 'rate_anime') {
                    const score = await runProcessAndGetOutput(imagePath);
                    existingTags.forEach(tag => { if (tag.startsWith('aesthetic_score:')) existingTags.delete(tag); });
                    existingTags.add(`aesthetic_score:${score}`);
                } else if (operationType === 'find_replace') {
                    const findTagLower = tagToFind.toLowerCase();
                    const tagsToReplace = Array.from(existingTags).filter(t => t.toLowerCase() === findTagLower);
                    if (tagsToReplace.length > 0) {
                        tagsToReplace.forEach(t => existingTags.delete(t));
                        if (tagToReplace) existingTags.add(tagToReplace.trim());
                    }
                }
                await fs.writeFile(txtPath, Array.from(existingTags).join(', '));
                batchState.processed++;
            }
        } catch (error) {
            logger.error(`Error during batch operation: ${error.message}`);
        } finally {
            batchState.isRunning = false;
            logger.info("Batch operation finished.");
            cleanupChildProcess();
        }
    })();
});

app.get('/api/autotag-batch/status', (req, res) => res.json(batchState));
app.post('/api/autotag-batch/cancel', (req, res) => {
    if (batchState.isRunning) {
        batchState.isRunning = false;
        logger.info("Received request to cancel batch job.");
        cleanupAutotagger();
        res.status(200).json({ message: "Batch job cancellation requested." });
    } else {
        res.status(404).json({ message: "No batch job is currently running." });
    }
});

const clearTagsByType = async (res, tagPrefix) => {
    try {
        const files = await fs.readdir(userMediaDir);
        const txtFiles = files.filter(file => file.endsWith('.txt'));
        for (const file of txtFiles) {
            const filePath = path.join(userMediaDir, file);
            let content = await fs.readFile(filePath, 'utf8').catch(() => '');
            let tags = content.split(',').map(t => t.trim()).filter(Boolean);
            const newTags = tags.filter(t => !t.startsWith(tagPrefix));
            await fs.writeFile(filePath, newTags.join(', '));
        }
        res.json({ message: `Successfully cleared all tags starting with '${tagPrefix}'.` });
    } catch (error) {
        logger.error(`API Error on clearing tags: ${error.message}`);
        res.status(500).send('Error clearing tag data.');
    }
};

app.post('/api/clear-ratings', async (req, res) => {
    await clearTagsByType(res, 'rating:');
});

app.post('/api/clear-aesthetic-scores', async (req, res) => {
    await clearTagsByType(res, 'aesthetic_score:');
});

app.post('/api/reject-by-score', async (req, res) => {
    const { filenames } = req.body;
    let rejectedCount = 0;
    try {
        for (const filename of filenames) {
            await moveFile(filename, userMediaDir, rejectedDir);
            rejectedCount++;
        }
        res.json({ message: `Successfully rejected ${rejectedCount} images.` });
    } catch (error) {
        logger.error(`API Error on rejecting by score: ${error.message}`);
        res.status(500).send('Error during rejection process.');
    }
});

app.post('/api/export-final-dataset', async (req, res) => {
    const { filenames } = req.body;
    let exportedCount = 0;
    try {
        await fs.mkdir(finalDir, { recursive: true });
        for (const filename of filenames) {
            const sourceImgPath = path.join(userMediaDir, filename);
            const destImgPath = path.join(finalDir, filename);
            await fs.copyFile(sourceImgPath, destImgPath);

            const sourceTxtPath = getTextFilePath(filename, userMediaDir);
            const destTxtPath = getTextFilePath(filename, finalDir);
            try {
                let content = await fs.readFile(sourceTxtPath, 'utf8');
                let tags = content.split(',').map(t => t.trim()).filter(Boolean);
                const sanitizedTags = tags.filter(t => !t.startsWith('rating:') && !t.startsWith('aesthetic_score:'));
                await fs.writeFile(destTxtPath, sanitizedTags.join(', '));
            } catch (error) {
                // If source txt doesn't exist, just ignore it and don't create one in final.
            }
            exportedCount++;
        }
        res.json({ message: `Successfully exported ${exportedCount} images to the 'final' folder.` });
    } catch (error) {
        logger.error(`API Error on exporting dataset: ${error.message}`);
        res.status(500).send('Error during export process.');
    }
});

app.listen(PORT, '0.0.0.0', async () => {
    logger.info(`Server started. Listening on http://localhost:${PORT}`);
    await fs.mkdir(rejectedDir, { recursive: true });
    await fs.mkdir(finalDir, { recursive: true });
    await generateThumbnails(userMediaDir, thumbnailDir);
    await generateThumbnails(rejectedDir, rejectedThumbnailDir);
    await generateThumbnails(finalDir, path.join(finalDir, '.thumbnails'));
});