/* ==========================================================================
   Leafpress: PDF to Image tool
   Each chosen page is drawn on a canvas by the bundled pdf.js library
   (js/vendor/) and saved as PNG, JPG or WebP. Everything runs in the browser
   and nothing is uploaded.
   ========================================================================== */
(function () {
  'use strict';

  var ns = window.Leafpress;
  if (!ns || !ns.zip) { return; }

  var MAX_PIXELS = 16000000;   // pages larger than this are scaled down so phones can cope
  var MAX_PAGES = 200;         // per conversion; use the Pages box for longer PDFs
  var LIB_URL = 'js/vendor/pdf.min.js';
  var WORKER_URL = 'js/vendor/pdf.worker.min.js';

  var TYPES = {
    png: { mime: 'image/png', ext: 'png', label: 'PNG' },
    jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' },
    webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' }
  };

  var $ = function (selector) { return document.querySelector(selector); };

  var els = {
    card: $('#tool-card'),
    dropzone: $('#dropzone'),
    input: $('#file-input'),
    workspace: $('#workspace'),
    fileName: $('#file-name'),
    fileMeta: $('#file-meta'),
    changeFile: $('#change-file'),
    format: $('#opt-format'),
    dpi: $('#opt-dpi'),
    quality: $('#opt-quality'),
    qualityValue: $('#quality-value'),
    qualityHint: $('#quality-hint'),
    pages: $('#opt-pages'),
    convert: $('#convert-btn'),
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

  var state = {
    file: null,
    pageCount: 0,
    busy: false,
    outputs: [],
    zipUrl: null,
    libPromise: null,
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

  function supportsWebp() {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) {
      return false;
    }
  }
  if (!supportsWebp()) {
    var webpOption = els.format.querySelector('option[value="webp"]');
    if (webpOption) {
      webpOption.disabled = true;
      webpOption.textContent += ' (not supported by this browser)';
    }
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

  function updateButton() {
    els.convert.disabled = state.busy || !state.file || !state.pageCount;
    els.convert.textContent = state.busy ? 'Converting\u2026' : 'Convert to images';
  }

  function syncQuality() {
    var lossless = els.format.value === 'png';
    els.quality.disabled = lossless;
    els.qualityValue.textContent = lossless ? '-' : els.quality.value + '%';
    els.qualityHint.textContent = lossless
      ? 'PNG is lossless, so there is no quality setting. Choose JPG or WebP for smaller files.'
      : 'Lower quality gives smaller files. 80 to 90 looks sharp for most pages.';
  }

  function setProgress(fraction, text) {
    els.progress.hidden = false;
    els.bar.style.width = Math.round(fraction * 100) + '%';
    els.progressText.textContent = text;
  }

  /* ---------- pdf.js (loaded only when needed) ---------- */

  function loadLibrary() {
    if (!state.libPromise) {
      state.libPromise = import(new URL(LIB_URL, document.baseURI).href).then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = new URL(WORKER_URL, document.baseURI).href;
        return lib;
      });
      state.libPromise.catch(function () { state.libPromise = null; });
    }
    return state.libPromise;
  }

  function friendlyError(error) {
    var name = error && error.name;
    if (name === 'PasswordException') {
      return 'This PDF is password protected. Remove the password first, then try again.';
    }
    if (name === 'InvalidPDFException' || name === 'FormatError') {
      return 'This file could not be read as a PDF. It may be damaged.';
    }
    if (error && error.leafpressLoad) {
      return 'The PDF engine could not be loaded. If you opened this page straight from your computer, ' +
        'run it from a web server or your published site instead.';
    }
    return 'Something went wrong while converting the PDF. Please try again with fewer pages or a lower resolution.';
  }

  /* ---------- Choosing a file ---------- */

  async function readPageCount(file, token) {
    try {
      var lib;
      try {
        lib = await loadLibrary();
      } catch (loadError) {
        loadError.leafpressLoad = true;
        throw loadError;
      }
      var data = new Uint8Array(await file.arrayBuffer());
      var doc = await lib.getDocument({ data: data }).promise;
      var count = doc.numPages;
      doc.destroy();
      if (token !== state.fileToken) { return; }
      state.pageCount = count;
      els.fileMeta.textContent = ns.formatBytes(file.size) + ', ' + count + (count === 1 ? ' page' : ' pages');
      els.pages.placeholder = 'All pages (or for example 1-3, 5)';
    } catch (error) {
      if (token !== state.fileToken) { return; }
      reset();
      showError(friendlyError(error));
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
    state.pageCount = 0;
    state.fileToken += 1;
    els.fileName.textContent = file.name;
    els.fileName.title = file.name;
    els.fileMeta.textContent = ns.formatBytes(file.size) + ', reading pages\u2026';
    els.pages.value = '';
    els.workspace.hidden = false;
    els.dropzone.classList.add('is-compact');
    updateButton();
    readPageCount(file, state.fileToken);
  }

  function reset() {
    state.file = null;
    state.pageCount = 0;
    state.fileToken += 1;
    clearOutputs();
    els.workspace.hidden = true;
    els.dropzone.classList.remove('is-compact');
    updateButton();
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

  els.format.addEventListener('change', function () { syncQuality(); clearOutputs(); });
  els.quality.addEventListener('input', function () { els.qualityValue.textContent = els.quality.value + '%'; });
  [els.quality, els.dpi, els.pages].forEach(function (control) {
    control.addEventListener('change', clearOutputs);
  });
  syncQuality();

  /* ---------- Page selection ---------- */

  /** Turn "1-3, 5" into [1, 2, 3, 5]. An empty box means every page. */
  function parsePages(text, total) {
    var all = [];
    var i;
    for (i = 1; i <= total; i++) { all.push(i); }
    var trimmed = text.trim();
    if (!trimmed) { return { list: all }; }

    var chosen = {};
    var parts = trimmed.split(',');
    for (i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) { continue; }
      var match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
      if (!match) { return { error: 'Enter pages like 1-3, 5 (numbers, ranges and commas only).' }; }
      var from = parseInt(match[1], 10);
      var to = match[2] ? parseInt(match[2], 10) : from;
      if (from > to) { var swap = from; from = to; to = swap; }
      if (from < 1 || to > total) {
        return { error: 'This PDF has ' + total + (total === 1 ? ' page' : ' pages') + '. Choose pages from 1 to ' + total + '.' };
      }
      for (var p = from; p <= to; p++) { chosen[p] = true; }
    }
    var list = Object.keys(chosen).map(Number).sort(function (a, b) { return a - b; });
    return list.length ? { list: list } : { list: all };
  }

  /* ---------- Rendering ---------- */

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob && blob.type === mime) { resolve(blob); } else { reject(new Error('Could not encode image')); }
      }, mime, quality);
    });
  }

  async function renderPage(doc, pageNumber, dpi, type, quality) {
    var page = await doc.getPage(pageNumber);
    var base = page.getViewport({ scale: 1 });
    var scale = dpi / 72;
    var pixels = base.width * scale * base.height * scale;
    if (pixels > MAX_PIXELS) { scale *= Math.sqrt(MAX_PIXELS / pixels); }
    var viewport = page.getViewport({ scale: scale });

    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    page.cleanup();

    var width = canvas.width;
    var height = canvas.height;
    var blob = await canvasToBlob(canvas, type.mime, quality);
    canvas.width = canvas.height = 0; // free memory
    return { blob: blob, width: width, height: height };
  }

  function addTile(out) {
    var li = document.createElement('li');
    li.className = 'out-card';

    var thumb = document.createElement('div');
    thumb.className = 'out-thumb';
    var img = document.createElement('img');
    img.src = out.url;
    img.alt = 'Preview of page ' + out.page;
    img.decoding = 'async';
    var badge = document.createElement('span');
    badge.className = 'page-no';
    badge.textContent = String(out.page);
    thumb.appendChild(img);
    thumb.appendChild(badge);

    var meta = document.createElement('p');
    meta.className = 'file-meta';
    meta.textContent = out.width + ' \u00D7 ' + out.height + ' px, ' + ns.formatBytes(out.blob.size);

    var link = document.createElement('a');
    link.className = 'btn btn-secondary btn-sm';
    link.href = out.url;
    link.setAttribute('download', out.name);
    link.setAttribute('aria-label', 'Download page ' + out.page);
    link.textContent = 'Download';

    li.appendChild(thumb);
    li.appendChild(meta);
    li.appendChild(link);
    els.outList.appendChild(li);
  }

  /* ---------- Convert ---------- */

  async function convert() {
    if (state.busy || !state.file || !state.pageCount) { return; }

    hideError();
    var selection = parsePages(els.pages.value, state.pageCount);
    if (selection.error) { showError(selection.error); els.pages.focus(); return; }
    if (selection.list.length > MAX_PAGES) {
      showError('That is ' + selection.list.length + ' pages. Please convert up to ' + MAX_PAGES +
        ' pages at a time by using the Pages box, for example 1-' + MAX_PAGES + '.');
      els.pages.focus();
      return;
    }

    clearOutputs();
    state.busy = true;
    updateButton();

    var file = state.file;
    var typeKey = els.format.value;
    var type = TYPES[typeKey] || TYPES.png;
    var dpi = parseInt(els.dpi.value, 10) || 150;
    var quality = (parseInt(els.quality.value, 10) || 85) / 100;
    var baseName = ns.safeFileName(file.name.replace(/\.pdf$/i, ''), 'document');
    var pad = String(state.pageCount).length;
    var doc = null;

    try {
      setProgress(0, 'Opening the PDF\u2026');
      var lib = await loadLibrary();
      var data = new Uint8Array(await file.arrayBuffer());
      doc = await lib.getDocument({ data: data }).promise;

      var list = selection.list;
      for (var i = 0; i < list.length; i++) {
        var pageNumber = list[i];
        setProgress(i / list.length, 'Converting page ' + pageNumber + ' (' + (i + 1) + ' of ' + list.length + ')\u2026');
        await nextFrame();
        var made = await renderPage(doc, pageNumber, dpi, type, quality);
        var out = {
          page: pageNumber,
          blob: made.blob,
          width: made.width,
          height: made.height,
          url: URL.createObjectURL(made.blob),
          name: baseName + '-page-' + String(pageNumber).padStart(pad, '0') + '.' + type.ext
        };
        state.outputs.push(out);
        addTile(out);
      }

      setProgress(1, 'Finishing up\u2026');
      await nextFrame();
      await showResult(type);
    } catch (error) {
      showError(friendlyError(error));
    } finally {
      if (doc) { doc.destroy(); }
      state.busy = false;
      els.progress.hidden = true;
      updateButton();
    }
  }

  async function showResult(type) {
    var outputs = state.outputs;
    var total = 0;
    outputs.forEach(function (out) { total += out.blob.size; });

    els.resultText.textContent = 'Done: ' + outputs.length + (outputs.length === 1 ? ' page' : ' pages') +
      ' saved as ' + type.label + ' (' + ns.formatBytes(total) + ' in total).';

    if (outputs.length === 1) {
      els.downloadAll.href = outputs[0].url;
      els.downloadAll.setAttribute('download', outputs[0].name);
      els.downloadAll.textContent = 'Download image';
    } else {
      var files = [];
      for (var i = 0; i < outputs.length; i++) {
        files.push({ name: outputs[i].name, bytes: new Uint8Array(await outputs[i].blob.arrayBuffer()) });
      }
      state.zipUrl = URL.createObjectURL(ns.zip.build(files));
      els.downloadAll.href = state.zipUrl;
      els.downloadAll.setAttribute('download', ns.safeFileName(state.file.name.replace(/\.pdf$/i, ''), 'pages') + '-images.zip');
      els.downloadAll.textContent = 'Download all (ZIP)';
    }
    els.result.hidden = false;
  }

  els.convert.addEventListener('click', convert);

  updateButton();
})();
