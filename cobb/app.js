// Wait for the entire HTML document to be loaded before running the script.
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Global State & Constants ---
    let dirHandle;
    let allRecords = [];
    let vocabulary = new Set();
    let currentIndex = 0;
    let pendingTags = new Set();
    const RECORD_SEPARATOR_PATTERN = /={40,}/;
    const HIDDEN_TAG_NAME = "隱藏貼文";

    // --- 2. DOM Element References ---
    const startupView = document.getElementById('startup-view');
    const mainView = document.getElementById('main-view');
    const selectDirBtn = document.getElementById('btn-select-dir');
    
    const progressDisplay = document.getElementById('progress-display');
    const recordIndex = document.getElementById('record-index');
    const recordTimestamp = document.getElementById('record-timestamp');
    const recordCharCount = document.getElementById('record-char-count');
    const contentView = document.getElementById('content-view');
    
    const currentTagsContainer = document.getElementById('current-tags-container');
    const allTagsContainer = document.getElementById('all-tags-container');

    const prevBtn = document.getElementById('btn-prev');
    const addNewBtn = document.getElementById('btn-add-new');
    const saveNextBtn = document.getElementById('btn-save-next');
    const hideBtn = document.getElementById('btn-hide'); // [NEW] Get the hide button

    // --- 3. Core Functions ---

    async function selectDirectory() {
        try {
            dirHandle = await window.showDirectoryPicker();
            if (!dirHandle) return;

            const scope = prompt("Enter mission scope (e.g., 2022 or 2022-12). Leave empty to load all.");
            if (scope === null) {
                alert("Mission cancelled.");
                return;
            }

            const allLoadedRecords = await loadAllFiles(dirHandle);
            buildVocabulary(allLoadedRecords);

            // Filter records for the mission based on scope
            const missionRecords = allLoadedRecords.filter(record => {
                const isHidden = record.tags.includes(HIDDEN_TAG_NAME);
                if (isHidden) return false; // Exclude hidden records by default
                if (scope.trim() === '') return true; // Load all if scope is empty
                return record.timestamp.startsWith(scope);
            });
            
            allRecords = missionRecords; // Set the global 'allRecords' to the mission-specific list

            if (allRecords.length > 0) {
                startupView.style.display = 'none';
                mainView.style.display = 'block';
                displayRecord(0);
            } else {
                alert(`No non-hidden records found for scope '${scope}'.`);
            }
        } catch (error) {
            console.error('Error during setup:', error);
            alert('An error occurred. Please ensure your browser supports the File System Access API.');
        }
    }
    
    async function loadAllFiles(handle) {
        let allFileRecords = [];
        for await (const entry of handle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.txt')) {
                try {
                    const file = await entry.getFile();
                    const text = await file.text();
                    allFileRecords.push(...parseTotemFile(text));
                } catch(e) {
                    console.error(`Could not read or parse file: ${entry.name}`, e);
                }
            }
        }
        allFileRecords.sort((a, b) => a.index.localeCompare(b.index));
        return allFileRecords;
    }

    // ... (parseTotemFile, buildVocabulary, displayVocabulary, etc. remain unchanged)
    function parseTotemFile(fileContent) {
        const records = [];
        const recordBlocks = fileContent.split(RECORD_SEPARATOR_PATTERN);
        for (const block of recordBlocks) {
            if (block.trim() === '') continue;
            const lines = block.trim().split('\n');
            const record = { tags: [] };
            let isContentSection = false;
            const contentLines = [];
            for (const line of lines) {
                if (isContentSection) {
                    contentLines.push(line);
                    continue;
                }
                if (line.trim() === '---') {
                    isContentSection = true;
                    continue;
                }
                const parts = line.split(/:/);
                if (parts.length > 1) {
                    const key = parts[0].trim();
                    const value = parts.slice(1).join(':').trim();
                    switch (key) {
                        case 'Index': record.index = value; break;
                        case 'Timestamp': record.timestamp = value; break;
                        case 'Source': record.source = value; break;
                        case 'CharCount': record.charCount = value; break;
                        case 'Tags':
                            if (value) record.tags = value.split(',').map(t => t.trim()).filter(t => t);
                            break;
                    }
                }
            }
            record.content = contentLines.join('\n').trim();
            records.push(record);
        }
        return records;
    }
    function buildVocabulary(records) {
        vocabulary.clear();
        records.forEach(record => {
            if (record.tags) {
                record.tags.forEach(tag => vocabulary.add(tag));
            }
        });
    }
    function displayVocabulary() {
        allTagsContainer.innerHTML = '';
        [...vocabulary].sort().forEach(tag => {
            if (tag === HIDDEN_TAG_NAME) return;
            const tagPill = createTagPill(tag);
            allTagsContainer.appendChild(tagPill);
        });
    }
    function displayCurrentTags() {
        currentTagsContainer.innerHTML = '';
        if (pendingTags.size > 0) {
            [...pendingTags].sort().forEach(tag => {
                const tagPill = createTagPill(tag, true);
                currentTagsContainer.appendChild(tagPill);
            });
        }
    }
    function createTagPill(tagName, withRemove = false) {
        const tagPill = document.createElement('span');
        tagPill.className = 'tag-pill';
        tagPill.textContent = tagName;
        tagPill.dataset.tag = tagName;
        if (withRemove) {
            const removeBtn = document.createElement('span');
            removeBtn.className = 'tag-remove';
            removeBtn.innerHTML = ' &times;';
            tagPill.appendChild(removeBtn);
        }
        return tagPill;
    }
    function displayRecord(index) {
        if (allRecords.length === 0) {
            mainView.innerHTML = "<h1>Mission Complete</h1><p>All records in this scope have been processed.</p>";
            return;
        }
        if (index < 0 || index >= allRecords.length) {
            // This can happen if the last item is hidden. Adjust index.
            index = Math.max(0, Math.min(index, allRecords.length - 1));
        }

        currentIndex = index;
        const record = allRecords[currentIndex];
        pendingTags = new Set(record.tags);
        progressDisplay.textContent = `Memory Node: ${currentIndex + 1} / ${allRecords.length}`;
        recordIndex.textContent = record.index || 'N/A';
        recordTimestamp.textContent = record.timestamp || 'N/A';
        recordCharCount.textContent = record.charCount || 'N/A';
        contentView.textContent = record.content || '';
        displayCurrentTags();
        displayVocabulary();
    }

    // --- 4. Event Handlers ---
    function handleAddTagClick(e) {
        if (e.target && e.target.classList.contains('tag-pill')) {
            const tagName = e.target.dataset.tag;
            if (tagName && !pendingTags.has(tagName)) {
                pendingTags.add(tagName);
                displayCurrentTags();
            }
        }
    }
    function handleRemoveTagClick(e) {
        if (e.target && e.target.classList.contains('tag-remove')) {
            const tagName = e.target.parentElement.dataset.tag;
            if (tagName) {
                pendingTags.delete(tagName);
                displayCurrentTags();
            }
        }
    }
    
    async function navigate(direction) {
        await saveCurrentRecord();
        const newIndex = currentIndex + direction;
        if (newIndex >= 0 && newIndex < allRecords.length) {
            displayRecord(newIndex);
        } else {
            alert(direction > 0 ? "You've reached the last record of this mission." : "You're at the first record of this mission.");
        }
    }
    
    function handleAddNewConcept() {
        const newTag = prompt("Enter new concept name:");
        if (newTag && newTag.trim() !== '') {
            const trimmedTag = newTag.trim();
            if (vocabulary.has(trimmedTag)) {
                alert(`Concept '${trimmedTag}' already exists.`);
            } else {
                vocabulary.add(trimmedTag);
                pendingTags.add(trimmedTag);
                displayVocabulary();
                displayCurrentTags();
            }
        }
    }
    
    /**
     * [NEW] Handles the logic for the hide button.
     */
    async function handleHideRecord() {
        if (allRecords.length === 0) return;

        const recordToHide = allRecords[currentIndex];
        const confirmation = confirm(`Are you sure you want to hide this record?\n\nIndex: ${recordToHide.index}\nThis action cannot be easily undone.`);

        if (confirmation) {
            // Add the hidden tag, then save immediately.
            pendingTags.add(HIDDEN_TAG_NAME);
            await saveCurrentRecord();

            // Remove from the current mission's list in memory.
            allRecords.splice(currentIndex, 1);
            
            // Display the next record.
            displayRecord(currentIndex);
        }
    }

    async function saveCurrentRecord() {
        if (currentIndex < 0 || currentIndex >= allRecords.length) return;
        const currentRecord = allRecords[currentIndex];
        const originalTags = new Set(currentRecord.tags);
        
        if (originalTags.size === pendingTags.size && [...originalTags].every(tag => pendingTags.has(tag))) {
            return;
        }
        
        console.log(`Solidifying memory... Saving changes to ${currentRecord.index}`);
        currentRecord.tags = [...pendingTags].sort();
        try {
            const year = currentRecord.index.split('-')[1];
            const fileName = `${year}.txt`;

            // Load all records for that year to perform the update.
            const allYearRecords = await loadAllFiles(dirHandle).then(recs => recs.filter(r => r.index.split('-')[1] === year));
            
            const recordToUpdateIndex = allYearRecords.findIndex(r => r.index === currentRecord.index);
            if (recordToUpdateIndex > -1) {
                allYearRecords[recordToUpdateIndex] = currentRecord;
            } else {
                allYearRecords.push(currentRecord);
                allYearRecords.sort((a,b) => a.index.localeCompare(b.index));
            }
            const newFileContent = serializeTotemFile(allYearRecords);
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(newFileContent);
            await writable.close();
            console.log("Save successful.");
        } catch (error) {
            console.error("Failed to save file:", error);
            alert("Error: Could not save changes to the file.");
        }
    }
    
    function serializeTotemFile(records) {
        return records.map(record => {
            let block = `Index: ${record.index}\n`;
            block += `Timestamp: ${record.timestamp}\n`;
            block += `Source: ${record.source}\n`;
            // Ensure Tags line is always present for easier parsing
            block += `Tags: ${record.tags ? record.tags.join(', ') : ''}\n`;
            block += `CharCount: ${record.charCount}\n`;
            block += `---\n`;
            block += `${record.content.trim()}\n`;
            return block;
        }).join("========================================\n");
    }
    
    // --- 5. Event Listeners ---
    selectDirBtn.addEventListener('click', selectDirectory);
    allTagsContainer.addEventListener('click', handleAddTagClick);
    currentTagsContainer.addEventListener('click', handleRemoveTagClick);
    saveNextBtn.addEventListener('click', () => navigate(1));
    prevBtn.addEventListener('click', () => navigate(-1));
    addNewBtn.addEventListener('click', handleAddNewConcept);
    hideBtn.addEventListener('click', handleHideRecord); // [NEW] Wire up the hide button

});