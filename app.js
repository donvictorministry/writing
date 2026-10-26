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
 * UI CUSTOM DIALOG / NOTIFICATION POPUP (CENTERED, NO ALERT())
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
 * DOM INITIALIZATION & EVENT DISPATCHERS
 */
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  }

  const editor = document.getElementById('main-editor');
  const renderedView = document.getElementById('grammar-rendered-view');
  const resultsArea = document.getElementById('results-display-area');

  // Left & Right Sidebar Drawers
  const leftSidebar = document.getElementById('sidebar-left');
  const rightSidebar = document.getElementById('sidebar-right');

  document.getElementById('open-left-sidebar').onclick = () => leftSidebar.classList.add('active');
  document.getElementById('open-right-sidebar').onclick = () => rightSidebar.classList.add('active');

  document.querySelectorAll('.close-sidebar').forEach(btn => {
    btn.onclick = () => {
      leftSidebar.classList.remove('active');
      rightSidebar.classList.remove('active');
    };
  });

  // Modal navigation handlers
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

  // Developer Bio Read More Toggle
  const devBioShort = document.getElementById('dev-bio-short');
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

  // Team Navigation jump arrows
  document.querySelectorAll('.nav-arrow').forEach(arrow => {
    arrow.addEventListener('click', () => {
      const targetId = arrow.getAttribute('data-target');
      const el = document.getElementById(targetId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
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

  // Copy to Clipboard
  document.getElementById('action-copy').onclick = async () => {
    if (!editor.value) {
      showModalDialog('Clipboard Empty', 'There is no text to copy.');
      return;
    }
    await navigator.clipboard.writeText(editor.value);
    showModalDialog('Success', 'Text copied directly to your clipboard!');
  };

  // Paste from Clipboard
  document.getElementById('action-paste').onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      editor.value += (editor.value ? '\n' : '') + text;
      showModalDialog('Pasted', 'Clipboard contents inserted.');
    } catch (e) {
      showModalDialog('Permission Error', 'Please allow clipboard permissions or paste manually into the editor.');
    }
  };

  // Load Demonstration Text
  document.getElementById('action-demo').onclick = () => {
    editor.value = "Artificial intelligence is a branch of computer science that builds smart machines. In order to make systems effective, researchers must verify grammar and ensure citations are valid.";
    renderedView.style.display = 'none';
    editor.style.display = 'block';
  };

  // Save File to IndexedDB
  document.getElementById('tile-save-doc').onclick = async () => {
    if (!editor.value.trim()) {
      showModalDialog('Document Empty', 'Please enter text before saving.');
      return;
    }
    await saveDocumentToDB(editor.value);
    showModalDialog('Saved', 'Document successfully stored in IndexedDB.');
  };

  // Paraphraser Action
  async function handleParaphrase() {
    const text = editor.value.trim();
    if (!text) {
      showModalDialog('Text Required', 'Enter text in the editor to paraphrase.');
      return;
    }
    showLoaderResults('Generating paraphrased variations...');
    try {
      const alts = await getParaphrasedAlternatives(text);
      displayParaphraseResults(alts);
    } catch (err) {
      showModalDialog('Paraphrase Notice', err.message);
    }
  }

  document.getElementById('tile-paraphrase').onclick = handleParaphrase;
  document.getElementById('action-quick-paraphrase').onclick = handleParaphrase;

  // Summarize Action
  document.getElementById('tile-summarize').onclick = async () => {
    const text = editor.value.trim();
    if (!text) {
      showModalDialog('Text Required', 'Enter text in the editor to summarize.');
      return;
    }
    showLoaderResults('Distilling summary with Hugging Face models...');
    try {
      const summary = await getSummarizedText(text);
      displaySingleResult('Summarized Draft', summary);
    } catch (err) {
      showModalDialog('Summarizer Notice', err.message);
    }
  };

  // Grammar Checker Action
  document.getElementById('tile-grammar').onclick = async () => {
    const text = editor.value.trim();
    if (!text) {
      showModalDialog('Text Required', 'Enter text in the editor to check grammar.');
      return;
    }
    showLoaderResults('Checking text against LanguageTool rules...');
    try {
      const matches = await checkGrammar(text);
      if (matches.length === 0) {
        resultsArea.style.display = 'block';
        resultsArea.innerHTML = `
          <div class="results-card">
            <h3 style="color:var(--success);">Grammar Check Complete</h3>
            <p>No grammatical, spelling, or syntactic mistakes were found in your draft.</p>
          </div>
        `;
        return;
      }
      displayGrammarResults(matches, text);
    } catch (err) {
      showModalDialog('Grammar Check Notice', err.message);
    }
  };

  // Citation & Bibliography Tiles
  document.getElementById('tile-citation').onclick = () => {
    document.getElementById('modal-biblio-manager').classList.add('active');
    renderCitationsList();
  };

  document.getElementById('tile-bibliography').onclick = () => {
    document.getElementById('modal-biblio-manager').classList.add('active');
    renderCitationsList();
  };

  // Citation Search Handlers
  document.getElementById('btn-search-doi').onclick = async () => {
    const q = document.getElementById('citation-query-input').value.trim();
    if (!q) return showModalDialog('Query Needed', 'Enter a valid DOI.');
    try {
      const cit = await fetchCitationByDOI(q);
      await saveCitationToDB(cit);
      showModalDialog('Success', 'APA Citation generated and added to Bibliography.');
      renderCitationsList();
    } catch (e) {
      showModalDialog('DOI Lookup Failed', e.message);
    }
  };

  document.getElementById('btn-search-book').onclick = async () => {
    const q = document.getElementById('citation-query-input').value.trim();
    if (!q) return showModalDialog('Query Needed', 'Enter a book title.');
    try {
      const cit = await fetchCitationByBookTitle(q);
      await saveCitationToDB(cit);
      showModalDialog('Success', 'Citation fetched and stored in Bibliography.');
      renderCitationsList();
    } catch (e) {
      showModalDialog('Search Failed', e.message);
    }
  };

  // Export Plain Text Bibliography
  document.getElementById('export-biblio-btn').onclick = async () => {
    const citations = await getStoredCitations();
    if (citations.length === 0) {
      showModalDialog('Empty Bibliography', 'No citations are currently recorded.');
      return;
    }
    const plainText = citations.map((c, i) => `[${i + 1}] ${c.apa}`).join('\n\n');
    await navigator.clipboard.writeText(plainText);
    showModalDialog('Exported', 'Bibliography exported and copied to clipboard as plain text!');
  };

  // Share App handler
  document.getElementById('btn-share-app').onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'DV-Writing Assistant',
          text: 'Check out this mobile-first writing and citation assistant!',
          url: window.location.href
        });
      } catch (e) {
        // user canceled
      }
    } else {
      showModalDialog('Share Link', window.location.href);
    }
  };

  // Install PWA Trigger
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  document.getElementById('btn-install-pwa').onclick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
    } else {
      showModalDialog('Install PWA', 'To install DV-Writing Assistant, tap the three dots in your Android Chrome browser and choose "Add to Home screen".');
    }
  };

  // Exit App Handler
  document.getElementById('btn-exit-app').onclick = () => {
    window.close();
    showModalDialog('Exit Application', 'You can safely close this browser tab.');
  };
});

/**
 * RENDERING HELPERS FOR RESULTS AND SAVED FILES
 */
function showLoaderResults(msg) {
  const container = document.getElementById('results-display-area');
  container.style.display = 'block';
  container.innerHTML = `
    <div class="results-card" style="text-align:center;">
      <p style="font-weight:600;">${msg}</p>
    </div>
  `;
}

function displayParaphraseResults(alternatives) {
  const container = document.getElementById('results-display-area');
  container.style.display = 'block';
  
  let html = `<div class="results-card"><h3>Paraphrased Alternatives</h3>`;
  alternatives.forEach((alt, idx) => {
    html += `
      <div class="result-item-box">
        <p>${alt}</p>
        <div class="result-item-actions">
          <button class="secondary-btn apply-alt-btn" data-text="${encodeURIComponent(alt)}">Replace in Editor</button>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll('.apply-alt-btn').forEach(b => {
    b.onclick = () => {
      const text = decodeURIComponent(b.getAttribute('data-text'));
      document.getElementById('main-editor').value = text;
      showModalDialog('Applied', 'Replacement updated in the main editor.');
    };
  });
}

function displaySingleResult(title, text) {
  const container = document.getElementById('results-display-area');
  container.style.display = 'block';
  container.innerHTML = `
    <div class="results-card">
      <h3>${title}</h3>
      <div class="result-item-box">
        <p>${text}</p>
        <div class="result-item-actions">
          <button class="secondary-btn" id="apply-summary-btn">Insert Into Editor</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('apply-summary-btn').onclick = () => {
    document.getElementById('main-editor').value = text;
    showModalDialog('Applied', 'Text replaced in main editor.');
  };
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
        <button class="secondary-btn" id="exit-grammar-view">Close Inspection</button>
      </div>
  `;

  matches.forEach((m, idx) => {
    const errorWord = originalText.substring(m.offset, m.offset + m.length);
    const replacement = m.replacements[0]?.value || 'Remove';
    listHtml += `
      <div class="result-item-box">
        <p><strong>Issue:</strong> ${m.message}</p>
        <p><strong>Found:</strong> <span style="text-decoration:line-through; color:var(--error);">${errorWord}</span></p>
        <p><strong>Suggested:</strong> <span style="color:var(--success); font-weight:700;">${replacement}</span></p>
        <div class="result-item-actions">
          <button class="primary-btn fix-error-btn" data-start="${m.offset}" data-len="${m.length}" data-rep="${replacement}">Fix</button>
        </div>
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

  container.querySelectorAll('.fix-error-btn').forEach(btn => {
    btn.onclick = () => {
      const start = Number(btn.getAttribute('data-start'));
      const len = Number(btn.getAttribute('data-len'));
      const rep = btn.getAttribute('data-rep');
      const cur = editor.value;
      editor.value = cur.substring(0, start) + rep + cur.substring(start + len);
      
      renderedView.style.display = 'none';
      editor.style.display = 'block';
      container.style.display = 'none';
      showModalDialog('Corrected', 'Grammar fix applied to editor.');
    };
  });
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
      <div class="result-item-actions">
        <button class="secondary-btn delete-cit-btn" data-id="${c.id}">Remove</button>
      </div>
    </div>
  `).join('');

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
    container.innerHTML = `<p style="text-align:center; padding:20px;">No saved documents found in IndexedDB storage.</p>`;
    return;
  }

  container.innerHTML = docs.map(d => `
    <div class="result-item-box">
      <p style="font-weight:600;">Saved on ${new Date(d.updatedAt).toLocaleDateString()} at ${new Date(d.updatedAt).toLocaleTimeString()}</p>
      <p>${d.snippet}</p>
      <div class="result-item-actions">
        <button class="primary-btn open-doc-btn" data-id="${d.id}">Open</button>
        <button class="secondary-btn delete-doc-btn" data-id="${d.id}">Delete</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.open-doc-btn').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.getAttribute('data-id'));
      const target = docs.find(x => x.id === id);
      if (target) {
        document.getElementById('main-editor').value = target.content;
        document.getElementById('modal-saved-files').classList.remove('active');
        showModalDialog('Document Loaded', 'Loaded into your main editor.');
      }
    };
  });

  container.querySelectorAll('.delete-doc-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      await deleteDocumentFromDB(id);
      loadSavedFilesView();
    };
  });
}
