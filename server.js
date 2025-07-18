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
let batchState = { isRunning: false, total: 0, processed: 0, currentFile: '' };

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
                await sharp(sourcePath).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(thumbPath);
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

const runAutoTagger = (imagePath, threshold) => {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', ['autotag.py', imagePath, String(threshold)]);
        let generatedTags = '';
        let errorOutput = '';
        pythonProcess.stdout.on('data', (data) => { generatedTags += data.toString(); });
        pythonProcess.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message) logger.info(`[AutoTagger]: ${message}`);
            errorOutput += message + '\n';
        });
        pythonProcess.on('close', (code) => {
            if (code !== 0) reject(new Error(errorOutput));
            else resolve(generatedTags.trim());
        });
    });
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
        try { await fs.unlink(txtFile); } catch (e) { /* ignore if no txt file */ }
        try { await fs.unlink(thumbFile); } catch (e) { /* ignore if no thumb file */ }
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
            const content = await fs.readFile(filePath, 'utf8');
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
    logger.info(`Auto-tagging request for: ${filename} with threshold: ${threshold}`);
    try {
        const tags = await runAutoTagger(imagePath, threshold);
        logger.info(`Successfully generated tags for: ${filename}`);
        res.json({ tags });
    } catch (error) {
        logger.error(`Auto-tagging script failed for ${filename}.`);
        res.status(500).json({ error: 'Failed to generate tags.', details: error.message });
    }
});

app.post('/api/autotag-batch', (req, res) => {
    if (batchState.isRunning) {
        return res.status(409).json({ message: "A batch job is already in progress." });
    }
    const { filenames, threshold, mode, customTag } = req.body;
    if (!filenames || filenames.length === 0) {
        return res.status(400).json({ message: "No filenames provided for batch tagging." });
    }

    batchState = { isRunning: true, total: filenames.length, processed: 0, currentFile: '' };
    res.status(202).json({ message: "Batch tagging process started." });

    (async () => {
        for (const filename of filenames) {
            if (!batchState.isRunning) {
                logger.info("Batch tagging process was cancelled by user.");
                break;
            }
            batchState.currentFile = filename;
            const txtPath = getTextFilePath(filename, userMediaDir);
            try {
                const generatedTags = await runAutoTagger(path.join(userMediaDir, filename), threshold);
                const existingContent = await fs.readFile(txtPath, 'utf8').catch(() => '');
                const existingTags = existingContent.split(',').map(t => t.trim()).filter(Boolean);
                let newTags = generatedTags.split(',').map(t => t.trim()).filter(Boolean);
                const customTagClean = customTag ? customTag.trim() : null;
                let finalTags = new Set();

                if (mode === 'replace') {
                    newTags.forEach(t => finalTags.add(t));
                    if (customTagClean) finalTags.add(customTagClean);
                } else if (mode === 'prepend') {
                    newTags.forEach(t => finalTags.add(t));
                    if (customTagClean) finalTags.add(customTagClean);
                    existingTags.forEach(t => finalTags.add(t));
                } else { // Append by default
                    existingTags.forEach(t => finalTags.add(t));
                    if (customTagClean) finalTags.add(customTagClean);
                    newTags.forEach(t => finalTags.add(t));
                }
                await fs.writeFile(txtPath, Array.from(finalTags).join(', '));
            } catch (error) {
                logger.error(`Failed to batch tag ${filename}.`);
            }
            batchState.processed++;
        }
        batchState.isRunning = false;
        logger.info("Batch auto-tagging process finished.");
    })();
});

app.get('/api/autotag-batch/status', (req, res) => {
    res.json(batchState);
});

app.post('/api/autotag-batch/cancel', (req, res) => {
    if (batchState.isRunning) {
        batchState.isRunning = false;
        logger.info("Received request to cancel batch job.");
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