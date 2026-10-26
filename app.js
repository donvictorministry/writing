import { checkGrammar, renderGrammarErrors } from './language-tool.js';
import { fetchCitationByDOI, fetchCitationByBookTitle } from './citation.js';
import { getParaphrasedAlternatives } from './paraphrase.js';
import { getSummarizedText } from './summarize.js';

/**
 * INDEXEDDB INITIALIZATION & STORAGE MANAGER
 */
const DB_NAME = 'DVWritingAssistantDB';
const DB_VERSION = 1;
let db = null;

async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const dbInstance = e.target.result;
      if (!dbInstance.objectStoreNames.contains('documents')) {
        dbInstance.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
      }
      if (!dbInstance.objectStoreNames.contains('citations')) {
        dbInstance.createObjectStore('citations', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveDocumentToDB(content) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    const store = tx.objectStore('documents');
    const doc = {
      content,
      updatedAt: new Date().toISOString(),
      snippet: content.substring(0, 50) + '...'
    };
    const req = store.add(doc);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getSavedDocuments() {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readonly');
    const store = tx.objectStore('documents');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteDocumentFromDB(id) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', 'readwrite');
    const store = tx.objectStore('documents');
    const req = store.delete(Number(id));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function saveCitationToDB(citation) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('citations', 'readwrite');
    const store = tx.objectStore('citations');
    const req = store.add(citation);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredCitations() {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('citations', 'readonly');
    const store = tx.objectStore('citations');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteCitationFromDB(id) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('citations', 'readwrite');
    const store = tx.objectStore('citations');
    const req = store.delete(Number(id));
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * SCREEN CENTER SPINNER CONTROLS
 */
const spinner = document.getElementById('screen-center-spinner');
const spinnerText = document.getElementById('spinner-status-text');

function showSpinner(status = 'Processing...') {
  spinnerText.textContent = status;
  spinner.classList.add('active');
}

function hideSpinner() {
  spinner.classList.remove('active');
}

/**
 * MODAL DIALOG / FEEDBACK POPUP
 */
function showModalDialog(title, message, isConfirm = false) {
  return new Promise((resolve) => {
    const host = document.getElementById('dialog-host');
    host.style.display = 'block';
    host.innerHTML = `
      <div class="custom-dialog-backdrop">
        <div class="custom-dialog-card">
          <h3 style="font-size:22px; font-weight:700;">${title}</h3>
          <p style="line-height:1.5;">${message}</p>
          <div class="dialog-actions">
            ${isConfirm ? '<button class="secondary-btn" id="dialog-cancel-btn">Cancel</button>' : ''}
            <button class="primary-btn" id="dialog-confirm-btn">OK</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('dialog-confirm-btn').onclick = () => {
      host.style.display = 'none';
      host.innerHTML = '';
      resolve(true);
    };

    if (isConfirm) {
      document.getElementById('dialog-cancel-btn').onclick = () => {
        host.style.display = 'none';
        host.innerHTML = '';
        resolve(false);
      };
    }
  });
}

/**
 * HISTORY STACK FOR UNDO / REDO
 */
const undoStack = [];
const redoStack = [];
let isUndoRedoAction = false;

function recordEditorState(val) {
  if (isUndoRedoAction) return;
  if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== val) {
    undoStack.push(val);
    redoStack.length = 0; // Clear redo upon new edits
    if (undoStack.length > 50) undoStack.shift();
  }
}

/**
 * DOM INITIALIZATION
 */
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW err:', err));
  }

  const editor = document.getElementById('main-editor');
  const renderedView = document.getElementById('grammar-rendered-view');
  const resultsArea = document.getElementById('results-display-area');
  const leftSidebar = document.getElementById('sidebar-left');
  const rightSidebar = document.getElementById('sidebar-right');
  const fileInput = document.getElementById('file-import-input');

  // Seed history
  recordEditorState(editor.value);
  editor.addEventListener('input', () => recordEditorState(editor.value));

  // Sidebar Open & Close
  document.getElementById('open-left-sidebar').onclick = () => leftSidebar.classList.add('active');
  document.getElementById('open-right-sidebar').onclick = () => rightSidebar.classList.add('active');

  document.querySelectorAll('.close-sidebar').forEach(btn => {
    btn.onclick = () => {
      leftSidebar.classList.remove('active');
      rightSidebar.classList.remove('active');
    };
  });

  // FIX 2: EXIT BUTTON CLOSES SIDEBAR & BRINGS USER DIRECTLY TO HOME/EDITOR
  document.getElementById('btn-exit-app').onclick = () => {
    rightSidebar.classList.remove('active');
    leftSidebar.classList.remove('active');
    document.querySelectorAll('.full-modal').forEach(m => m.classList.remove('active'));
    editor.scrollIntoView({ behavior: 'smooth' });
    editor.focus();
  };

  // Modal navigation
  document.querySelectorAll('[data-modal]').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const modalId = trigger.getAttribute('data-modal');
      const targetModal = document.getElementById(modalId);
      if (targetModal) {
        if (modalId === 'modal-saved-files') loadSavedFilesView();
        targetModal.classList.add('active');
      }
    });
  });

  document.querySelectorAll('.modal-back-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.full-modal');
      if (modal) modal.classList.remove('active');
    });
  });

  // Dark Mode Toggle
  const themeBtn = document.getElementById('btn-toggle-theme');
  const themeLabel = document.getElementById('theme-label-text');
  themeBtn.onclick = () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.body.removeAttribute('data-theme');
      themeLabel.textContent = 'Dark Mode: Off';
    } else {
      document.body.setAttribute('data-theme', 'dark');
      themeLabel.textContent = 'Dark Mode: On';
    }
  };

  // Font Scaling Slider (19px - 23px)
  const fontSlider = document.getElementById('font-scale-slider');
  const fontValLabel = document.getElementById('font-size-val');
  fontSlider.oninput = (e) => {
    const val = e.target.value;
    document.documentElement.style.setProperty('--font-size-base', `${val}px`);
    fontValLabel.textContent = `${val}px`;
  };

  // FIX 4: HORIZONTAL TOOLBAR ACTIONS WITH TEXT LABELS
  // 1. Paste
  document.getElementById('tool-paste').onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        showModalDialog('Clipboard Empty', 'No text found on clipboard to paste.');
        return;
      }
      editor.value += (editor.value ? '\n' : '') + text;
      recordEditorState(editor.value);
      showModalDialog('Pasted', 'Text pasted successfully into the editor.');
    } catch (e) {
      showModalDialog('Clipboard Access', 'Paste manually or enable browser clipboard permissions.');
    }
  };

  // 2. Copy
  document.getElementById('tool-copy').onclick = async () => {
    if (!editor.value.trim()) {
      showModalDialog('Editor Empty', 'There is no text to copy.');
      return;
    }
    await navigator.clipboard.writeText(editor.value);
    showModalDialog('Success', 'Editor text copied to clipboard!');
  };

  // 3. Clear
  document.getElementById('tool-clear').onclick = async () => {
    if (!editor.value) return;
    const confirm = await showModalDialog('Clear Editor', 'Delete all text currently inside the editor?', true);
    if (confirm) {
      recordEditorState(editor.value);
      editor.value = '';
      recordEditorState('');
      resultsArea.style.display = 'none';
      renderedView.style.display = 'none';
      editor.style.display = 'block';
    }
  };

  // 4. Undo
  document.getElementById('tool-undo').onclick = () => {
    if (undoStack.length <= 1) {
      showModalDialog('Undo', 'No prior actions to undo.');
      return;
    }
    isUndoRedoAction = true;
    const current = undoStack.pop();
    redoStack.push(current);
    const previous = undoStack[undoStack.length - 1];
    editor.value = previous;
    isUndoRedoAction = false;
  };

  // 5. Redo
  document.getElementById('tool-redo').onclick = () => {
    if (redoStack.length === 0) {
      showModalDialog('Redo', 'No actions to redo.');
      return;
    }
    isUndoRedoAction = true;
    const next = redoStack.pop();
    undoStack.push(next);
    editor.value = next;
    isUndoRedoAction = false;
  };

  // 6. Import
  document.getElementById('tool-import').onclick = () => {
    fileInput.value = '';
    fileInput.click();
  };

  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result;
      editor.value = content;
      recordEditorState(editor.value);
      showModalDialog('Imported', `Successfully loaded "${file.name}" into editor.`);
    };
    reader.readAsText(file);
  };

  // Save Document to IndexedDB
  document.getElementById('tile-save-doc').onclick = async () => {
    if (!editor.value.trim()) {
      showModalDialog('Empty Draft', 'Please write something before saving.');
      return;
    }
    await saveDocumentToDB(editor.value);
    showModalDialog('Saved', 'Document safely stored in IndexedDB.');
  };

  // FIX 7: SCREEN-CENTERED SPINNER INTEGRATION ACROSS ALL JOBS

  // Paraphraser Action
  document.getElementById('tile-paraphrase').onclick = async () => {
    const text = editor.value.trim();
    if (!text) return showModalDialog('Text Required', 'Enter text to paraphrase.');

    showSpinner('Paraphrasing text with Hugging Face models...');
    try {
      const alts = await getParaphrasedAlternatives(text);
      displayParaphraseResults(alts);
    } catch (err) {
      showModalDialog('Paraphraser', err.message);
    } finally {
      hideSpinner();
    }
  };

  // Summarize Action
  document.getElementById('tile-summarize').onclick = async () => {
    const text = editor.value.trim();
    if (!text) return showModalDialog('Text Required', 'Enter text to summarize.');

    showSpinner('Distilling summary...');
    try {
      const summary = await getSummarizedText(text);
      displaySingleResult('Summary Result', summary);
    } catch (err) {
      showModalDialog('Summarizer', err.message);
    } finally {
      hideSpinner();
    }
  };

  // Grammar Checker Action
  document.getElementById('tile-grammar').onclick = async () => {
    const text = editor.value.trim();
    if (!text) return showModalDialog('Text Required', 'Enter text to check grammar.');

    showSpinner('Analyzing grammar with LanguageTool...');
    try {
      const matches = await checkGrammar(text);
      if (matches.length === 0) {
        resultsArea.style.display = 'block';
        resultsArea.innerHTML = `
          <div class="results-card">
            <h3 style="color:var(--success);">No Grammar Errors Found</h3>
            <p>Your draft adheres cleanly to grammatical standards.</p>
          </div>
        `;
        return;
      }
      displayGrammarResults(matches, text);
    } catch (err) {
      showModalDialog('Grammar Checker', err.message);
    } finally {
      hideSpinner();
    }
  };

  // Citation Generator & Bibliography Screens
  document.getElementById('tile-citation').onclick = () => {
    document.getElementById('modal-biblio-manager').classList.add('active');
    renderCitationsList();
  };

  document.getElementById('tile-bibliography').onclick = () => {
    document.getElementById('modal-biblio-manager').classList.add('active');
    renderCitationsList();
  };

  // Citation Lookups with Centered Spinner
  document.getElementById('btn-search-doi').onclick = async () => {
    const q = document.getElementById('citation-query-input').value.trim();
    if (!q) return showModalDialog('Query Needed', 'Enter a DOI.');

    showSpinner('Retrieving DOI metadata via Crossref...');
    try {
      const cit = await fetchCitationByDOI(q);
      await saveCitationToDB(cit);
      showModalDialog('Success', 'APA Citation resolved and stored in Bibliography.');
      renderCitationsList();
    } catch (e) {
      showModalDialog('DOI Lookup Failed', e.message);
    } finally {
      hideSpinner();
    }
  };

  document.getElementById('btn-search-book').onclick = async () => {
    const q = document.getElementById('citation-query-input').value.trim();
    if (!q) return showModalDialog('Query Needed', 'Enter a book title.');

    showSpinner('Fetching catalog details via Open Library...');
    try {
      const cit = await fetchCitationByBookTitle(q);
      await saveCitationToDB(cit);
      showModalDialog('Success', 'Book reference formatted and added to Bibliography.');
      renderCitationsList();
    } catch (e) {
      showModalDialog('Search Failed', e.message);
    } finally {
      hideSpinner();
    }
  };

  // Export Plain Text Bibliography
  document.getElementById('export-biblio-btn').onclick = async () => {
    const citations = await getStoredCitations();
    if (citations.length === 0) {
      showModalDialog('Bibliography Empty', 'No references saved.');
      return;
    }
    const plainText = citations.map((c, i) => `[${i + 1}] ${c.apa}`).join('\n\n');
    await navigator.clipboard.writeText(plainText);
    showModalDialog('Exported', 'Bibliography copied to clipboard as plain text!');
  };

  // Share Application
  document.getElementById('btn-share-app').onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'DV-Writing Assistant',
          text: 'Check out DV-Writing Assistant!',
          url: window.location.href
        });
      } catch (e) {}
    } else {
      showModalDialog('Share Link', window.location.href);
    }
  };

  // Install PWA Prompt
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  document.getElementById('btn-install-pwa').onclick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
    } else {
      showModalDialog('Install PWA', 'Tap the 3 dots in your Android Chrome browser and tap "Add to Home screen".');
    }
  };

  // Jump Arrows for Team Members
  document.querySelectorAll('.nav-arrow').forEach(arrow => {
    arrow.addEventListener('click', () => {
      const targetId = arrow.getAttribute('data-target');
      const el = document.getElementById(targetId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Toggle Developer Bio
  const devBioFull = document.getElementById('dev-bio-full');
  const devBioBtn = document.getElementById('btn-toggle-dev-bio');
  if (devBioBtn) {
    devBioBtn.onclick = () => {
      if (devBioFull.style.display === 'none') {
        devBioFull.style.display = 'block';
        devBioBtn.textContent = 'Show Less';
      } else {
        devBioFull.style.display = 'none';
        devBioBtn.textContent = 'Show More';
      }
    };
  }
});

/**
 * FIX 8: HORIZONTAL ACTION BUTTONS (COPY, SHARE, REPLACE IN EDITOR) ON EVERY OUTPUT
 */
function createHorizontalOutputActions(textToActOn) {
  const enc = encodeURIComponent(textToActOn);
  return `
    <div class="output-actions-horizontal">
      <button class="output-action-btn btn-copy-out" data-text="${enc}">
        <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        <span>Copy</span>
      </button>

      <button class="output-action-btn btn-share-out" data-text="${enc}">
        <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>
        <span>Share</span>
      </button>

      <button class="output-action-btn btn-replace" data-text="${enc}">
        <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        <span>Replace in Editor</span>
      </button>
    </div>
  `;
}

function attachOutputActionListeners(scope) {
  // Copy
  scope.querySelectorAll('.btn-copy-out').forEach(b => {
    b.onclick = async () => {
      const text = decodeURIComponent(b.getAttribute('data-text'));
      await navigator.clipboard.writeText(text);
      showModalDialog('Copied', 'Output copied to clipboard.');
    };
  });

  // Share
  scope.querySelectorAll('.btn-share-out').forEach(b => {
    b.onclick = async () => {
      const text = decodeURIComponent(b.getAttribute('data-text'));
      if (navigator.share) {
        try {
          await navigator.share({ title: 'DV-Writing Output', text });
        } catch (e) {}
      } else {
        await navigator.clipboard.writeText(text);
        showModalDialog('Share', 'Output copied to clipboard for manual sharing.');
      }
    };
  });

  // Replace in Editor
  scope.querySelectorAll('.btn-replace').forEach(b => {
    b.onclick = () => {
      const text = decodeURIComponent(b.getAttribute('data-text'));
      const editor = document.getElementById('main-editor');
      editor.value = text;
      recordEditorState(text);
      document.getElementById('grammar-rendered-view').style.display = 'none';
      editor.style.display = 'block';
      editor.scrollIntoView({ behavior: 'smooth' });
      showModalDialog('Applied', 'Replacement applied to the primary editor.');
    };
  });
}

function displayParaphraseResults(alternatives) {
  const container = document.getElementById('results-display-area');
  container.style.display = 'block';

  let html = `<div class="results-card"><h3>Paraphrased Alternatives</h3>`;
  alternatives.forEach(alt => {
    html += `
      <div class="result-item-box">
        <p>${alt}</p>
        ${createHorizontalOutputActions(alt)}
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;

  attachOutputActionListeners(container);
  container.scrollIntoView({ behavior: 'smooth' });
}

function displaySingleResult(title, text) {
  const container = document.getElementById('results-display-area');
  container.style.display = 'block';
  container.innerHTML = `
    <div class="results-card">
      <h3>${title}</h3>
      <div class="result-item-box">
        <p>${text}</p>
        ${createHorizontalOutputActions(text)}
      </div>
    </div>
  `;

  attachOutputActionListeners(container);
  container.scrollIntoView({ behavior: 'smooth' });
}

function displayGrammarResults(matches, originalText) {
  const container = document.getElementById('results-display-area');
  const editor = document.getElementById('main-editor');
  const renderedView = document.getElementById('grammar-rendered-view');

  const { html, errorCount } = renderGrammarErrors(originalText, matches);
  renderedView.innerHTML = html;
  editor.style.display = 'none';
  renderedView.style.display = 'block';

  container.style.display = 'block';
  let listHtml = `
    <div class="results-card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3>Grammar Diagnostics (${errorCount})</h3>
        <button class="secondary-btn" id="exit-grammar-view">Exit Inspection</button>
      </div>
  `;

  matches.forEach(m => {
    const errorWord = originalText.substring(m.offset, m.offset + m.length);
    const replacement = m.replacements[0]?.value || '';
    const suggestedSentence = originalText.substring(0, m.offset) + replacement + originalText.substring(m.offset + m.length);

    listHtml += `
      <div class="result-item-box">
        <p><strong>Issue:</strong> ${m.message}</p>
        <p><strong>Found:</strong> <span style="text-decoration:line-through; color:var(--error);">${errorWord}</span></p>
        <p><strong>Correction:</strong> <span style="color:var(--success); font-weight:700;">${replacement || '[Remove]'}</span></p>
        ${createHorizontalOutputActions(suggestedSentence)}
      </div>
    `;
  });

  listHtml += `</div>`;
  container.innerHTML = listHtml;

  document.getElementById('exit-grammar-view').onclick = () => {
    renderedView.style.display = 'none';
    editor.style.display = 'block';
    container.style.display = 'none';
  };

  attachOutputActionListeners(container);
  container.scrollIntoView({ behavior: 'smooth' });
}

async function renderCitationsList() {
  const container = document.getElementById('active-citations-list');
  const citations = await getStoredCitations();

  if (citations.length === 0) {
    container.innerHTML = `<p style="text-align:center; padding:16px;">No citations in bibliography yet.</p>`;
    return;
  }

  container.innerHTML = citations.map(c => `
    <div class="result-item-box">
      <p style="font-weight:700;">${c.title}</p>
      <p style="font-size:18px;"><strong>APA:</strong> ${c.apa}</p>
      <p style="font-size:18px;"><strong>MLA:</strong> ${c.mla}</p>
      ${createHorizontalOutputActions(c.apa)}
      <div style="display:flex; justify-content:flex-end; margin-top:8px;">
        <button class="secondary-btn delete-cit-btn" data-id="${c.id}">Remove Citation</button>
      </div>
    </div>
  `).join('');

  attachOutputActionListeners(container);

  container.querySelectorAll('.delete-cit-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      await deleteCitationFromDB(id);
      renderCitationsList();
    };
  });
}

async function loadSavedFilesView() {
  const container = document.getElementById('saved-files-list');
  const docs = await getSavedDocuments();

  if (docs.length === 0) {
    container.innerHTML = `<p style="text-align:center; padding:20px;">No saved documents found.</p>`;
    return;
  }

  container.innerHTML = docs.map(d => `
    <div class="result-item-box">
      <p style="font-weight:600;">Saved on ${new Date(d.updatedAt).toLocaleDateString()} at ${new Date(d.updatedAt).toLocaleTimeString()}</p>
      <p>${d.snippet}</p>
      ${createHorizontalOutputActions(d.content)}
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
        <button class="secondary-btn delete-doc-btn" data-id="${d.id}">Delete</button>
      </div>
    </div>
  `).join('');

  attachOutputActionListeners(container);

  container.querySelectorAll('.delete-doc-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      await deleteDocumentFromDB(id);
      loadSavedFilesView();
    };
  });
}