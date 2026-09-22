/* ==========================================================================
   Leafpress: Split PDF tool
   Uses the bundled pdf-lib library (js/vendor/pdf-lib.min.js) to copy chosen
   pages into new PDFs. Pages are copied as they are (not turned into images),
   so text stays sharp and selectable. Everything runs in the browser and
   nothing is uploaded.

   Three ways to split:
     extract - keep the listed pages, as one new PDF ("1-3, 5")
     ranges  - every comma-separated part becomes its own PDF ("1-3, 4-6, 7-")
     every   - a new PDF for every N pages
   ========================================================================== */
(function () {
  'use strict';

  var ns = window.Leafpress;
  var PDFLib = window.PDFLib;
  if (!ns || !ns.zip || !PDFLib) { return; }

  var MAX_FILES = 300;   // most PDFs one run may create

  var ICON = '<svg class="file-info-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6h26l10 10v42H14z"/>' +
    '<path d="M40 6v10h10"/><path d="M22 34h20M22 42h20M22 26h10"/></svg>';

  var $ = function (selector) { return document.querySelector(selector); };

  var els = {
    card: $('#tool-card'),
    dropzone: $('#dropzone'),
    input: $('#file-input'),
    workspace: $('#workspace'),
    fileName: $('#file-name'),
    fileMeta: $('#file-meta'),
    changeFile: $('#change-file'),
    extractField: $('#field-extract'),
    rangesField: $('#field-ranges'),
    everyField: $('#field-every'),
    extract: $('#opt-extract'),
    ranges: $('#opt-ranges'),
    every: $('#opt-every'),
    plan: $('#plan'),
    split: $('#split-btn'),
    progress: $('#progress'),
    bar: $('#progress-bar'),
    progressText: $('#progress-text'),
    result: $('#result'),
    resultText: $('#result-text'),
    downloadAll: $('#download-all'),
    startOver: $('#start-over'),
    outList: $('#out-list'),
    error: $('#error-msg')
  };

  for (var key in els) {
    if (!els[key]) { return; }
  }

  var modeInputs = document.querySelectorAll('input[name="split-mode"]');

  var state = {
    file: null,
    doc: null,
    pageCount: 0,
    busy: false,
    outputs: [],
    zipUrl: null,
    fileToken: 0
  };

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

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function getMode() {
    for (var i = 0; i < modeInputs.length; i++) {
      if (modeInputs[i].checked) { return modeInputs[i].value; }
    }
    return 'extract';
  }

  function clearOutputs() {
    state.outputs.forEach(function (out) { URL.revokeObjectURL(out.url); });
    state.outputs = [];
    if (state.zipUrl) {
      URL.revokeObjectURL(state.zipUrl);
      state.zipUrl = null;
    }
    els.downloadAll.removeAttribute('href');
    els.outList.textContent = '';
    els.result.hidden = true;
  }

  function setProgress(fraction, text) {
    els.progress.hidden = false;
    els.bar.style.width = Math.round(fraction * 100) + '%';
    els.progressText.textContent = text;
  }

  /* ---------- Working out what will be created ---------- */

  /** Parse "1-3, 5, 8-" into [{from, to}] in the order typed. */
  function parseParts(text, total) {
    var parts = text.split(',');
    var result = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) { continue; }
      var match = /^(\d+)\s*(-\s*(\d*))?$/.exec(part);
      if (!match) { return { error: 'Enter pages like 1-3, 5 (numbers, ranges and commas only).' }; }
      var from = parseInt(match[1], 10);
      var to = match[2] ? (match[3] === '' ? total : parseInt(match[3], 10)) : from;
      if (from > to) { var swap = from; from = to; to = swap; }
      if (from < 1 || to > total) {
        return { error: 'This PDF has ' + plural(total, 'page') + '. Choose pages from 1 to ' + total + '.' };
      }
      result.push({ from: from, to: to });
    }
    return { parts: result };
  }

  function indicesFor(from, to) {
    var list = [];
    for (var p = from; p <= to; p++) { list.push(p - 1); }
    return list;
  }

  function rangeLabel(from, to) {
    return from === to ? 'page ' + from : 'pages ' + from + '-' + to;
  }

  function baseName() {
    return ns.safeFileName(state.file ? state.file.name.replace(/\.pdf$/i, '') : '', 'document');
  }

  /** Returns { files: [{ name, label, indices }] } or { error } or { hint }. */
  function computePlan() {
    var total = state.pageCount;
    var mode = getMode();
    var base = baseName();
    var parsed;
    var files = [];
    var i;

    if (!total) { return { hint: 'Reading your PDF\u2026' }; }

    if (mode === 'extract') {
      if (!els.extract.value.trim()) { return { hint: 'Type the pages to keep, for example 1-3, 5.' }; }
      parsed = parseParts(els.extract.value, total);
      if (parsed.error) { return { error: parsed.error }; }
      var indices = [];
      var labels = [];
      parsed.parts.forEach(function (part) {
        indices = indices.concat(indicesFor(part.from, part.to));
        labels.push(part.from === part.to ? String(part.from) : part.from + '-' + part.to);
      });
      if (!indices.length) { return { hint: 'Type the pages to keep, for example 1-3, 5.' }; }
      return {
        files: [{ name: base + '-extracted', label: plural(indices.length, 'page') + ' (' + labels.join(', ') + ')', indices: indices }],
        text: 'Creates 1 PDF with ' + plural(indices.length, 'page') + ': ' + labels.join(', ') + '.'
      };
    }

    if (mode === 'ranges') {
      if (!els.ranges.value.trim()) { return { hint: 'Type the ranges, for example 1-3, 4-6, 7-.' }; }
      parsed = parseParts(els.ranges.value, total);
      if (parsed.error) { return { error: parsed.error }; }
      parsed.parts.forEach(function (part) {
        files.push({
          name: base + '-' + rangeLabel(part.from, part.to).replace(' ', '-'),
          label: rangeLabel(part.from, part.to) + ' (' + plural(part.to - part.from + 1, 'page') + ')',
          indices: indicesFor(part.from, part.to),
          short: rangeLabel(part.from, part.to)
        });
      });
    } else {
      var size = parseInt(els.every.value, 10);
      if (!size || size < 1) { return { hint: 'Enter how many pages each PDF should have.' }; }
      for (i = 1; i <= total; i += size) {
        var last = Math.min(total, i + size - 1);
        files.push({
          name: base + '-' + rangeLabel(i, last).replace(' ', '-'),
          label: rangeLabel(i, last) + ' (' + plural(last - i + 1, 'page') + ')',
          indices: indicesFor(i, last),
          short: rangeLabel(i, last)
        });
      }
    }

    if (files.length > MAX_FILES) {
      return { error: 'That would create ' + files.length + ' files. Please create up to ' + MAX_FILES + ' at a time.' };
    }
    if (!files.length) { return { hint: 'Type the ranges, for example 1-3, 4-6, 7-.' }; }

    var shown = files.slice(0, 6).map(function (f) { return f.short; }).join(', ');
    return {
      files: files,
      text: 'Creates ' + plural(files.length, 'PDF') + ': ' + shown + (files.length > 6 ? ', and ' + (files.length - 6) + ' more' : '') + '.'
    };
  }

  function refreshPlan() {
    var plan = computePlan();
    els.plan.textContent = plan.error || plan.hint || plan.text;
    els.plan.classList.toggle('is-error', !!plan.error);
    els.split.disabled = state.busy || !plan.files;
    return plan;
  }

  function updateButton() {
    els.split.textContent = state.busy ? 'Splitting\u2026' : 'Split PDF';
    refreshPlan();
    Array.prototype.forEach.call(modeInputs, function (input) { input.disabled = state.busy; });
  }

  function syncMode() {
    var mode = getMode();
    els.extractField.hidden = mode !== 'extract';
    els.rangesField.hidden = mode !== 'ranges';
    els.everyField.hidden = mode !== 'every';
    clearOutputs();
    refreshPlan();
  }

  Array.prototype.forEach.call(modeInputs, function (input) { input.addEventListener('change', syncMode); });
  [els.extract, els.ranges, els.every].forEach(function (input) {
    input.addEventListener('input', function () { clearOutputs(); refreshPlan(); });
  });

  /* ---------- Choosing a file ---------- */

  function friendlyError(error) {
    if (error && /encrypted/i.test(error.message || '')) {
      return 'This PDF is password protected. Remove the protection first, then try again.';
    }
    return 'This file could not be read as a PDF. It may be damaged.';
  }

  async function loadFile(file, token) {
    try {
      var bytes = new Uint8Array(await file.arrayBuffer());
      var doc = await PDFLib.PDFDocument.load(bytes);
      if (token !== state.fileToken) { return; }
      state.doc = doc;
      state.pageCount = doc.getPageCount();
      els.fileMeta.textContent = ns.formatBytes(file.size) + ', ' + plural(state.pageCount, 'page');
      els.everyField.querySelector('input').max = String(state.pageCount);
    } catch (error) {
      if (token !== state.fileToken) { return; }
      reset();
      showError(friendlyError(error));
      return;
    }
    updateButton();
  }

  function setFile(file) {
    clearOutputs();
    hideError();
    if (!file) { return; }
    if (!isPdf(file)) {
      showError('\u201C' + file.name + '\u201D is not a PDF. Choose a file that ends in .pdf.');
      return;
    }
    state.file = file;
    state.doc = null;
    state.pageCount = 0;
    state.fileToken += 1;
    els.fileName.textContent = file.name;
    els.fileName.title = file.name;
    els.fileMeta.textContent = ns.formatBytes(file.size) + ', reading pages\u2026';
    els.extract.value = '';
    els.ranges.value = '';
    els.workspace.hidden = false;
    els.dropzone.classList.add('is-compact');
    syncMode();
    loadFile(file, state.fileToken);
  }

  function reset() {
    state.file = null;
    state.doc = null;
    state.pageCount = 0;
    state.fileToken += 1;
    clearOutputs();
    els.workspace.hidden = true;
    els.dropzone.classList.remove('is-compact');
    refreshPlan();
  }

  els.dropzone.addEventListener('click', function () { els.input.click(); });
  els.dropzone.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      els.input.click();
    }
  });
  els.changeFile.addEventListener('click', function () { els.input.click(); });
  els.startOver.addEventListener('click', function () {
    reset();
    hideError();
    els.dropzone.focus();
  });
  els.input.addEventListener('change', function () {
    if (!state.busy) { setFile(els.input.files && els.input.files[0]); }
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
    setFile(event.dataTransfer.files[0]);
  });
  ['dragover', 'drop'].forEach(function (type) {
    window.addEventListener(type, function (event) {
      if (hasFiles(event)) { event.preventDefault(); }
    });
  });

  /* ---------- Results ---------- */

  function addRow(out) {
    var li = document.createElement('li');
    li.className = 'img-row';

    var icon = document.createElement('div');
    icon.className = 'row-icon';
    icon.innerHTML = ICON;            // fixed markup defined above, no user text

    var text = document.createElement('div');
    text.className = 'img-row-text';
    var name = document.createElement('p');
    name.className = 'img-row-name';
    name.textContent = out.fileName;
    name.title = out.fileName;
    var meta = document.createElement('p');
    meta.className = 'img-row-meta';
    meta.textContent = out.label + ', ' + ns.formatBytes(out.blob.size);
    text.appendChild(name);
    text.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'img-row-actions';
    var link = document.createElement('a');
    link.className = 'btn btn-secondary btn-sm';
    link.href = out.url;
    link.setAttribute('download', out.fileName);
    link.setAttribute('aria-label', 'Download ' + out.fileName);
    link.textContent = 'Download';
    actions.appendChild(link);

    li.appendChild(icon);
    li.appendChild(text);
    li.appendChild(actions);
    els.outList.appendChild(li);
  }

  /* ---------- Split ---------- */

  async function split() {
    if (state.busy || !state.doc) { return; }
    hideError();
    var plan = refreshPlan();
    if (!plan.files) { return; }

    clearOutputs();
    state.busy = true;
    updateButton();

    var used = {};
    try {
      setProgress(0, 'Getting started\u2026');
      var total = plan.files.length;

      for (var i = 0; i < total; i++) {
        var item = plan.files[i];
        setProgress(i / total, total > 1 ? 'Creating file ' + (i + 1) + ' of ' + total + '\u2026' : 'Creating your PDF\u2026');
        await nextFrame();

        var out = await PDFLib.PDFDocument.create();
        var pages = await out.copyPages(state.doc, item.indices);
        pages.forEach(function (page) { out.addPage(page); });
        out.setTitle(item.name);
        out.setProducer('Leafpress');
        out.setCreator('Leafpress');
        var bytes = await out.save();
        var blob = new Blob([bytes], { type: 'application/pdf' });

        var fileName = item.name;
        var n = 2;
        while (used[fileName.toLowerCase()]) { fileName = item.name + '-' + n++; }
        used[fileName.toLowerCase()] = true;

        var made = { fileName: fileName + '.pdf', label: item.label, blob: blob, url: URL.createObjectURL(blob) };
        state.outputs.push(made);
        addRow(made);
      }

      setProgress(1, 'Finishing up\u2026');
      await nextFrame();
      await showResult();
    } catch (error) {
      showError('Something went wrong while splitting the PDF. Please try again.');
    } finally {
      state.busy = false;
      els.progress.hidden = true;
      updateButton();
    }
  }

  async function showResult() {
    var outputs = state.outputs;
    var total = 0;
    outputs.forEach(function (out) { total += out.blob.size; });

    els.resultText.textContent = 'Done: ' + plural(outputs.length, 'PDF') + ' created (' + ns.formatBytes(total) + ' in total).';

    if (outputs.length === 1) {
      els.downloadAll.href = outputs[0].url;
      els.downloadAll.setAttribute('download', outputs[0].fileName);
      els.downloadAll.textContent = 'Download PDF';
    } else {
      var files = [];
      for (var i = 0; i < outputs.length; i++) {
        files.push({ name: outputs[i].fileName, bytes: new Uint8Array(await outputs[i].blob.arrayBuffer()) });
      }
      state.zipUrl = URL.createObjectURL(ns.zip.build(files));
      els.downloadAll.href = state.zipUrl;
      els.downloadAll.setAttribute('download', baseName() + '-split.zip');
      els.downloadAll.textContent = 'Download all (ZIP)';
    }
    els.result.hidden = false;
    els.downloadAll.focus();
  }

  els.split.addEventListener('click', split);

  syncMode();
  updateButton();
})();
