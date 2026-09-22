/* ==========================================================================
   Leafpress: Merge PDF tool
   Uses the bundled pdf-lib library (js/vendor/pdf-lib.min.js) to copy the
   pages of every PDF, in the chosen order, into one new PDF. Pages are copied
   as they are (not turned into images), so text stays sharp and selectable.
   Everything runs in the browser and nothing is uploaded.
   ========================================================================== */
(function () {
  'use strict';

  var ns = window.Leafpress;
  var PDFLib = window.PDFLib;
  if (!ns || !PDFLib) { return; }

  var $ = function (selector) { return document.querySelector(selector); };

  var els = {
    card: $('#tool-card'),
    dropzone: $('#dropzone'),
    input: $('#file-input'),
    workspace: $('#workspace'),
    summary: $('#summary'),
    list: $('#file-list'),
    addMore: $('#add-more'),
    clearAll: $('#clear-all'),
    name: $('#opt-name'),
    merge: $('#merge-btn'),
    progress: $('#progress'),
    bar: $('#progress-bar'),
    progressText: $('#progress-text'),
    result: $('#result'),
    resultText: $('#result-text'),
    download: $('#download-link'),
    startOver: $('#start-over'),
    error: $('#error-msg')
  };

  for (var key in els) {
    if (!els[key]) { return; }
  }

  var ICON = '<svg class="file-info-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6h26l10 10v42H14z"/>' +
    '<path d="M40 6v10h10"/><path d="M22 34h20M22 42h20M22 26h10"/></svg>';

  var state = { items: [], nextId: 1, busy: false, dragId: null, resultUrl: null };

  /* ---------- Helpers ---------- */

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  function nextFrame() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  function hasFiles(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function hideError() {
    els.error.hidden = true;
    els.error.textContent = '';
  }

  function indexOf(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) { return i; }
    }
    return -1;
  }

  function readyItems() {
    return state.items.filter(function (item) { return item.status === 'ready'; });
  }

  function isReading() {
    return state.items.some(function (item) { return item.status === 'reading'; });
  }

  function clearResult() {
    if (state.resultUrl) {
      URL.revokeObjectURL(state.resultUrl);
      state.resultUrl = null;
    }
    els.download.removeAttribute('href');
    els.result.hidden = true;
  }

  function fileName() {
    return ns.safeFileName(els.name.value, 'merged');
  }

  /* ---------- Reading PDFs ---------- */

  async function loadItem(item) {
    try {
      var bytes = new Uint8Array(await item.file.arrayBuffer());
      item.doc = await PDFLib.PDFDocument.load(bytes);
      item.pages = item.doc.getPageCount();
      item.status = 'ready';
    } catch (error) {
      item.status = 'error';
      item.note = (error && /encrypted/i.test(error.message || ''))
        ? 'Password protected. Remove the protection first, then add it again.'
        : 'Could not read this PDF. It may be damaged.';
    }
  }

  async function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var skipped = [];
    var added = [];

    clearResult();
    files.forEach(function (file) {
      if (isPdf(file)) {
        var item = { id: state.nextId++, file: file, doc: null, pages: 0, status: 'reading', note: '' };
        state.items.push(item);
        added.push(item);
      } else {
        skipped.push(file.name);
      }
    });

    if (skipped.length) {
      showError('Skipped ' + skipped.length + (skipped.length === 1 ? ' file' : ' files') + ' that ' +
        (skipped.length === 1 ? 'is' : 'are') + ' not PDFs: ' + skipped.slice(0, 3).join(', ') +
        (skipped.length > 3 ? '\u2026' : '') + '.');
    } else {
      hideError();
    }
    render();

    for (var i = 0; i < added.length; i++) {
      await loadItem(added[i]);
      if (indexOf(added[i].id) !== -1) { render(); }
      await nextFrame();
    }
  }

  /* ---------- Rendering the list ---------- */

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function actionButton(action, glyph, label, disabled) {
    var btn = make('button', 'icon-btn', glyph);
    btn.type = 'button';
    btn.dataset.action = action;
    btn.setAttribute('aria-label', label);
    btn.disabled = !!disabled;
    return btn;
  }

  function metaText(item) {
    if (item.status === 'reading') { return 'Reading\u2026'; }
    if (item.status === 'error') { return item.note; }
    return ns.formatBytes(item.file.size) + ', ' + item.pages + (item.pages === 1 ? ' page' : ' pages');
  }

  function buildRow(item, index, total) {
    var name = item.file.name;
    var li = make('li', 'img-row' + (item.status === 'error' ? ' is-error' : ''));
    li.draggable = !state.busy;
    li.dataset.id = String(item.id);

    var icon = make('div', 'row-icon');
    icon.innerHTML = ICON;            // fixed markup defined above, no user text
    icon.appendChild(make('span', 'page-no', String(index + 1)));

    var text = make('div', 'img-row-text');
    var title = make('p', 'img-row-name', name);
    title.title = name;
    text.appendChild(title);
    text.appendChild(make('p', 'img-row-meta', metaText(item)));

    var actions = make('div', 'img-row-actions');
    actions.appendChild(actionButton('up', '\u2191', 'Move ' + name + ' up', state.busy || index === 0));
    actions.appendChild(actionButton('down', '\u2193', 'Move ' + name + ' down', state.busy || index === total - 1));
    var remove = make('button', 'btn btn-quiet btn-sm', 'Remove');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.disabled = state.busy;
    remove.setAttribute('aria-label', 'Remove ' + name);
    actions.appendChild(remove);

    li.appendChild(icon);
    li.appendChild(text);
    li.appendChild(actions);
    return li;
  }

  function render() {
    var count = state.items.length;
    var ready = readyItems();
    var pages = 0;
    ready.forEach(function (item) { pages += item.pages; });

    els.workspace.hidden = count === 0;
    els.dropzone.classList.toggle('is-compact', count > 0);

    els.list.textContent = '';
    var fragment = document.createDocumentFragment();
    state.items.forEach(function (item, i) { fragment.appendChild(buildRow(item, i, count)); });
    els.list.appendChild(fragment);

    els.summary.textContent = count + (count === 1 ? ' PDF' : ' PDFs') +
      (ready.length ? ', ' + pages + (pages === 1 ? ' page' : ' pages') + ' in total' : '');
    updateButtons();
  }

  function updateButtons() {
    var ready = readyItems().length;
    els.merge.disabled = state.busy || ready < 2 || isReading();
    els.merge.textContent = state.busy ? 'Merging\u2026' : (ready > 1 ? 'Merge ' + ready + ' PDFs' : 'Merge PDFs');
    els.addMore.disabled = state.busy;
    els.clearAll.disabled = state.busy;
    els.name.disabled = state.busy;
  }

  function setProgress(fraction, text) {
    els.progress.hidden = false;
    els.bar.style.width = Math.round(fraction * 100) + '%';
    els.progressText.textContent = text;
  }

  function move(from, to) {
    if (from === to || from < 0 || to < 0 || to >= state.items.length) { return; }
    var item = state.items.splice(from, 1)[0];
    state.items.splice(to, 0, item);
    clearResult();
  }

  function clearAll() {
    state.items = [];
    clearResult();
    hideError();
    render();
  }

  function focusAction(id, action) {
    var selector = '[data-id="' + id + '"] [data-action="';
    var btn = els.list.querySelector(selector + action + '"]');
    if (btn && btn.disabled) { btn = els.list.querySelector(selector + (action === 'up' ? 'down' : 'up') + '"]'); }
    if (btn) { btn.focus(); }
  }

  /* ---------- Events: adding files ---------- */

  els.dropzone.addEventListener('click', function () { els.input.click(); });
  els.dropzone.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.input.click();
    }
  });
  els.addMore.addEventListener('click', function () { els.input.click(); });
  els.clearAll.addEventListener('click', clearAll);
  els.startOver.addEventListener('click', function () {
    clearAll();
    els.dropzone.focus();
  });
  els.input.addEventListener('change', function () {
    if (!state.busy) { addFiles(els.input.files); }
    els.input.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    els.card.addEventListener(type, function (event) {
      if (!hasFiles(event)) { return; }
      event.preventDefault();
      els.dropzone.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    els.card.addEventListener(type, function (event) {
      if (type === 'dragleave' && event.relatedTarget && els.card.contains(event.relatedTarget)) { return; }
      els.dropzone.classList.remove('is-over');
    });
  });
  els.card.addEventListener('drop', function (event) {
    if (!hasFiles(event) || state.busy) { return; }
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  });
  ['dragover', 'drop'].forEach(function (type) {
    window.addEventListener(type, function (event) {
      if (hasFiles(event)) { event.preventDefault(); }
    });
  });

  /* ---------- Events: the file list ---------- */

  els.list.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-action]');
    if (!btn || state.busy) { return; }
    var id = Number(btn.closest('.img-row').dataset.id);
    var index = indexOf(id);
    var action = btn.dataset.action;
    if (index === -1) { return; }

    if (action === 'up' || action === 'down') {
      move(index, action === 'up' ? index - 1 : index + 1);
      render();
      focusAction(id, action);
    } else if (action === 'remove') {
      state.items.splice(index, 1);
      clearResult();
      render();
      var neighbour = state.items[Math.min(index, state.items.length - 1)];
      var next = neighbour && els.list.querySelector('[data-id="' + neighbour.id + '"] [data-action="remove"]');
      if (next) { next.focus(); } else { els.dropzone.focus(); }
    }
  });

  function clearDragMarks() {
    var marked = els.list.querySelectorAll('.is-dragging, .is-target');
    for (var i = 0; i < marked.length; i++) { marked[i].classList.remove('is-dragging', 'is-target'); }
  }

  els.list.addEventListener('dragstart', function (event) {
    var row = event.target.closest && event.target.closest('.img-row');
    if (!row || state.busy) { return; }
    state.dragId = Number(row.dataset.id);
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(state.dragId));
  });
  els.list.addEventListener('dragover', function (event) {
    if (state.dragId === null) { return; }
    event.preventDefault();
    var row = event.target.closest('.img-row');
    var previous = els.list.querySelector('.is-target');
    if (previous && previous !== row) { previous.classList.remove('is-target'); }
    if (row && Number(row.dataset.id) !== state.dragId) { row.classList.add('is-target'); }
  });
  els.list.addEventListener('drop', function (event) {
    if (state.dragId === null) { return; }
    event.preventDefault();
    var row = event.target.closest('.img-row');
    if (row) { move(indexOf(state.dragId), indexOf(Number(row.dataset.id))); }
    state.dragId = null;
    clearDragMarks();
    render();
  });
  els.list.addEventListener('dragend', function () {
    state.dragId = null;
    clearDragMarks();
  });

  els.name.addEventListener('input', function () {
    if (!els.result.hidden) { els.download.setAttribute('download', fileName() + '.pdf'); }
  });

  /* ---------- Merge ---------- */

  async function merge() {
    var items = readyItems();
    if (state.busy || items.length < 2) { return; }

    state.busy = true;
    clearResult();
    hideError();
    render();

    try {
      setProgress(0, 'Getting started\u2026');
      var out = await PDFLib.PDFDocument.create();
      var title = fileName();
      var totalPages = 0;

      for (var i = 0; i < items.length; i++) {
        setProgress(i / items.length, 'Adding file ' + (i + 1) + ' of ' + items.length + '\u2026');
        await nextFrame();
        var copied = await out.copyPages(items[i].doc, items[i].doc.getPageIndices());
        copied.forEach(function (page) { out.addPage(page); });
        totalPages += copied.length;
      }

      setProgress(1, 'Saving the merged PDF\u2026');
      await nextFrame();
      out.setTitle(title);
      out.setProducer('Leafpress');
      out.setCreator('Leafpress');
      var bytes = await out.save();
      var blob = new Blob([bytes], { type: 'application/pdf' });

      state.resultUrl = URL.createObjectURL(blob);
      els.download.href = state.resultUrl;
      els.download.setAttribute('download', title + '.pdf');
      els.resultText.textContent = 'Done: ' + items.length + ' PDFs merged into one file with ' + totalPages +
        (totalPages === 1 ? ' page' : ' pages') + ' (' + ns.formatBytes(blob.size) + ').';
      els.result.hidden = false;
      els.download.focus();
    } catch (error) {
      showError('Something went wrong while merging. Try again with fewer or smaller files.');
    } finally {
      state.busy = false;
      els.progress.hidden = true;
      render();
    }
  }

  els.merge.addEventListener('click', merge);

  render();
})();
