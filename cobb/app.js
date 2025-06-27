// @author Jian-Ting Chen (with assistance from Google Gemini)
// Copyright (C) 2025 Leyihuo Co., Ltd. All rights reserved.
//
// Final production-ready code for the Cobb PWA client-side application.
// Handles interactive tagging with persistent directory access.

// --- 0. Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(registration => {
            // ServiceWorker registration is silent in production
        }).catch(err => {
            console.error('ServiceWorker registration failed: ', err);
        });
    });
}

// --- IndexedDB Helper Functions ---
function getDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('CobbDB', 1);
        request.onerror = event => reject('Database error: ' + (event.target.error ? event.target.error.message : 'Unknown error'));
        request.onsuccess = event => resolve(event.target.result);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('handles')) {
                db.createObjectStore('handles', { keyPath: 'id' });
            }
        };
    });
}
async function setHandle(id, handle) {
    const db = await getDb();
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    store.put({ id, handle });
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = event => reject('Transaction error: ' + event.target.error);
    });
}
async function getHandle(id) {
    const db = await getDb();
    const tx = db.transaction('handles', 'readonly');
    const store = tx.objectStore('handles');
    const request = store.get(id);
    return new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result ? request.result.handle : null);
        request.onerror = () => resolve(null);
    });
}
async function verifyPermission(handle) {
    if (!handle) return false;
    const options = { mode: 'readwrite' };
    if (await handle.queryPermission(options) === 'granted') {
      return true;
    }
    return false;
}

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
    // [FIXED] Changed 'main-view' to 'app-wrapper' to match the updated HTML structure.
    const mainView = document.getElementById('app-wrapper'); 
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
    const hideBtn = document.getElementById('btn-hide');

    // --- 3. Core Functions ---

    async function initializeApp() {
        const savedHandle = await getHandle('pasivDir');
        if (savedHandle && await verifyPermission(savedHandle)) {
            dirHandle = savedHandle;
            await promptAndLoad();
        } else {
            if (savedHandle) {
                dirHandle = savedHandle;
                setupForReauthorization();
            } else {
                setupForInitialSelection();
            }
        }
    }

    function setupForInitialSelection() {
        startupView.style.display = 'block';
        mainView.style.display = 'none';
        selectDirBtn.textContent = 'Select Directory';
        selectDirBtn.onclick = selectAndRequestDirectory;
    }
    
    function setupForReauthorization() {
        startupView.style.display = 'block';
        mainView.style.display = 'none';
        selectDirBtn.textContent = `Re-authorize 'pasiv' Directory`;
        selectDirBtn.onclick = reauthorizeDirectory;
    }
    
    async function selectAndRequestDirectory() {
        try {
            const handle = await window.showDirectoryPicker();
            if (!handle) return;
            
            if (await handle.requestPermission({ mode: 'readwrite' }) === 'granted') {
                await setHandle('pasivDir', handle);
                dirHandle = handle;
                await promptAndLoad();
            } else {
                alert("Permission to access directory was denied.");
            }
        } catch (error) {
            console.log('Directory selection cancelled or failed:', error.name);
        }
    }

    async function reauthorizeDirectory() {
        if (!dirHandle) {
            setupForInitialSelection();
            return;
        }
        try {
            if (await dirHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
                await promptAndLoad();
            } else {
                alert("Permission to access directory was denied.");
            }
        } catch (error) {
            console.error('Re-authorization failed:', error);
        }
    }

    async function promptAndLoad() {
        const scope = prompt("Enter mission scope (e.g., 2022 or 2022-12). Leave empty to load all.");
        if (scope === null) {
            alert("Mission cancelled.");
            if (mainView.style.display === 'none') {
                if (dirHandle) setupForReauthorization();
                else setupForInitialSelection();
            }
            return;
        }
        startupView.style.display = 'none';
        mainView.style.display = 'flex'; // Use flex to enable the new layout
        const allLoadedRecords = await loadAllFiles(dirHandle);
        buildVocabulary(allLoadedRecords);
        const missionRecords = filterRecordsByScope(allLoadedRecords, scope);
        allRecords = missionRecords;
        if (allRecords.length > 0) {
            displayRecord(0);
        } else {
            alert(`No non-hidden records found for scope '${scope}'.`);
            mainView.style.display = 'none';
            if (dirHandle) setupForReauthorization();
            else setupForInitialSelection();
        }
    }
    
    function filterRecordsByScope(records, scope) {
        return records.filter(record => {
           const isHidden = record.tags.includes(HIDDEN_TAG_NAME);
           if (isHidden) return false;
           if (scope.trim() === '') return true;
           return record.timestamp.startsWith(scope);
       });
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
           mainView.innerHTML = "<h1>Mission Complete</h1><p>All records in this scope have been processed.</p><button onclick='location.reload()'>Start New Mission</button>";
           return;
       }
       if (index < 0 || index >= allRecords.length) {
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
   async function handleHideRecord() {
       if (allRecords.length === 0) return;
       const recordToHide = allRecords[currentIndex];
       const confirmation = confirm(`Are you sure you want to hide this record?\n\nIndex: ${recordToHide.index}\nThis action cannot be easily undone.`);
       if (confirmation) {
           pendingTags.add(HIDDEN_TAG_NAME);
           await saveCurrentRecord();
           allRecords.splice(currentIndex, 1);
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
       currentRecord.tags = [...pendingTags].sort();
       try {
           const year = currentRecord.index.split('-')[1];
           const fileName = `${year}.txt`;
           const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
           const allYearRecordsText = await fileHandle.getFile().then(f => f.text()).catch(() => "");
           const allYearRecords = parseTotemFile(allYearRecordsText);
           const recordToUpdateIndex = allYearRecords.findIndex(r => r.index === currentRecord.index);
           if (recordToUpdateIndex > -1) {
               allYearRecords[recordToUpdateIndex] = currentRecord;
           } else {
               allYearRecords.push(currentRecord);
               allYearRecords.sort((a,b) => a.index.localeCompare(b.index));
           }
           const newFileContent = serializeTotemFile(allYearRecords);
           const writable = await fileHandle.createWritable();
           await writable.write(newFileContent);
           await writable.close();
       } catch (error) {
           console.error("Failed to save file:", error);
           alert("Error: Could not save changes to the file.");
       }
   }
   function serializeTotemFile(records) {
       return records.map((record, i) => {
           let block = `Index: ${record.index}\n`;
           block += `Timestamp: ${record.timestamp}\n`;
           block += `Source: ${record.source}\n`;
           block += `Tags: ${record.tags ? record.tags.join(', ') : ''}\n`;
           block += `CharCount: ${record.charCount}\n`;
           block += `---\n`;
           block += `${record.content.trim()}`;
           if (i < records.length - 1) {
               block += `\n========================================`;
           }
           return block;
       }).join("\n");
   }
    
    // --- 5. Event Listeners ---
    allTagsContainer.addEventListener('click', handleAddTagClick);
    currentTagsContainer.addEventListener('click', handleRemoveTagClick);
    saveNextBtn.addEventListener('click', () => navigate(1));
    prevBtn.addEventListener('click', () => navigate(-1));
    addNewBtn.addEventListener('click', handleAddNewConcept);
    hideBtn.addEventListener('click', handleHideRecord);

    // --- 6. Initial Load ---
    initializeApp();
});
