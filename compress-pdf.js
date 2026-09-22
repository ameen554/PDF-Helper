/* ==========================================================================
   Leafpress: Compress PDF tool
   How it works: each page is drawn on a canvas (using the bundled pdf.js
   library in js/vendor/), saved as a JPEG at a lower resolution, and the pages
   are put back together with Leafpress.pdf.build(). Nothing is uploaded.

   Because pages become images, this is best for scanned and photo-heavy PDFs.
   Text is no longer selectable afterwards, and the tool refuses to hand back a
   file that is not actually smaller.
   ========================================================================== */
(function () {
  'use strict';

  var ns = window.Leafpress;
  if (!ns || !ns.pdf) { return; }

  // dpi = sharpness of each page image, jpeg = JPEG quality (0 to 1).
  var LEVELS = {
    light: { dpi: 150, jpeg: 0.85 },
    recommended: { dpi: 110, jpeg: 0.7 },
    strong: { dpi: 80, jpeg: 0.55 }
  };
  var MAX_SIDE = 4000;              // longest page side in pixels (keeps canvases within browser limits)
  var MIN_SAVING = 0.02;            // the result must be at least 2% smaller to be offered
  var LIB_URL = 'js/vendor/pdf.min.js';
  var WORKER_URL = 'js/vendor/pdf.worker.min.js';

  var $ = function (selector) { return document.querySelector(selector); };

  var els = {
    card: $('#tool-card'),
    dropzone: $('#dropzone'),
    input: $('#file-input'),
    workspace: $('#workspace'),
    fileName: $('#file-name'),
    fileMeta: $('#file-meta'),
    changeFile: $('#change-file'),
    level: $('#opt-level'),
    convert: $('#compress-btn'),
    progress: $('#progress'),
    bar: $('#progress-bar'),
    progressText: $('#progress-text'),
    result: $('#result'),
    resultText: $('#result-text'),
    download: $('#download-link'),
    startOver: $('#start-over'),
    notice: $('#notice'),
    error: $('#error-msg')
  };

  for (var key in els) {
    if (!els[key]) { return; }
  }

  var state = { file: null, busy: false, resultUrl: null, libPromise: null };

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

  function clearResult() {
    if (state.resultUrl) {
      URL.revokeObjectURL(state.resultUrl);
      state.resultUrl = null;
    }
    els.download.removeAttribute('href');
    els.result.hidden = true;
    els.notice.hidden = true;
  }

  function updateButton() {
    els.convert.disabled = state.busy || !state.file;
    els.convert.textContent = state.busy ? 'Compressing\u2026' : 'Compress PDF';
  }

  function setProgress(fraction, text) {
    els.progress.hidden = false;
    els.bar.style.width = Math.round(fraction * 100) + '%';
    els.progressText.textContent = text;
  }

  /* ---------- Choosing a file ---------- */

  function setFile(file) {
    clearResult();
    hideError();
    if (!file) { return; }
    if (!isPdf(file)) {
      showError('\u201C' + file.name + '\u201D is not a PDF. Choose a file that ends in .pdf.');
      return;
    }
    state.file = file;
    els.fileName.textContent = file.name;
    els.fileName.title = file.name;
    els.fileMeta.textContent = ns.formatBytes(file.size);
    els.workspace.hidden = false;
    els.dropzone.classList.add('is-compact');
    updateButton();
    loadLibrary().catch(function () { /* the error is shown when compressing */ });
  }

  function reset() {
    state.file = null;
    clearResult();
    hideError();
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
    els.dropzone.focus();
  });
  els.input.addEventListener('change', function () {
    setFile(els.input.files && els.input.files[0]);
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
    if (!hasFiles(event)) { return; }
    event.preventDefault();
    setFile(event.dataTransfer.files[0]);
  });
  ['dragover', 'drop'].forEach(function (type) {
    window.addEventListener(type, function (event) {
      if (hasFiles(event)) { event.preventDefault(); }
    });
  });

  els.level.addEventListener('change', clearResult);

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

  function canvasToJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('Could not encode JPEG')); return; }
        blob.arrayBuffer().then(function (buffer) { resolve(new Uint8Array(buffer)); }, reject);
      }, 'image/jpeg', quality);
    });
  }

  function renderPage(doc, pageNumber, level) {
    return doc.getPage(pageNumber).then(function (page) {
      var base = page.getViewport({ scale: 1 });   // page size in points (rotation applied)
      var scale = level.dpi / 72;
      var longest = Math.max(base.width, base.height) * scale;
      if (longest > MAX_SIDE) { scale *= MAX_SIDE / longest; }
      var viewport = page.getViewport({ scale: scale });

      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      var ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      var pxToPt = base.width / canvas.width;

      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        page.cleanup();
        return canvasToJpeg(canvas, level.jpeg);
      }).then(function (bytes) {
        canvas.width = canvas.height = 0; // free memory
        return { bytes: bytes, pxToPt: pxToPt };
      });
    });
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
      return 'The compression engine could not be loaded. If you opened this page straight from your computer, ' +
        'run it from a web server or your published site instead.';
    }
    return 'Something went wrong while compressing the PDF. Please try again, or try the Strong level for a very large file.';
  }

  /* ---------- Compress ---------- */

  async function compress() {
    if (state.busy || !state.file) { return; }

    state.busy = true;
    updateButton();
    clearResult();
    hideError();

    var file = state.file;
    var level = LEVELS[els.level.value] || LEVELS.recommended;
    var doc = null;

    try {
      setProgress(0, 'Loading the PDF engine\u2026');
      var lib;
      try {
        lib = await loadLibrary();
      } catch (loadError) {
        loadError.leafpressLoad = true;
        throw loadError;
      }

      var data = new Uint8Array(await file.arrayBuffer());
      doc = await lib.getDocument({ data: data }).promise;

      var total = doc.numPages;
      var pages = [];
      for (var n = 1; n <= total; n++) {
        setProgress((n - 1) / total, 'Compressing page ' + n + ' of ' + total + '\u2026');
        await nextFrame();
        pages.push(await renderPage(doc, n, level));
      }

      setProgress(1, 'Building the new PDF\u2026');
      await nextFrame();
      var title = ns.safeFileName(file.name, 'compressed');
      var blob = ns.pdf.build(pages, { pageSize: 'fit', margin: 0, title: title });
      showResult(blob, title, total);
    } catch (error) {
      showError(friendlyError(error));
    } finally {
      if (doc) { doc.destroy(); }
      state.busy = false;
      els.progress.hidden = true;
      updateButton();
    }
  }

  function showResult(blob, baseName, pages) {
    var before = state.file.size;
    var after = blob.size;

    if (after > before * (1 - MIN_SAVING)) {
      els.notice.textContent = 'This PDF is already compact. Compressing it at this level would give ' +
        ns.formatBytes(after) + ', compared with ' + ns.formatBytes(before) + ' now, so no new file was made. ' +
        (els.level.value === 'strong' ? 'Keep your original file.' : 'Try the Strong level, or keep your original.');
      els.notice.hidden = false;
      return;
    }

    var saved = Math.round((1 - after / before) * 100);
    state.resultUrl = URL.createObjectURL(blob);
    els.download.href = state.resultUrl;
    els.download.setAttribute('download', baseName + '-compressed.pdf');
    els.resultText.textContent = 'Done: ' + ns.formatBytes(before) + ' is now ' + ns.formatBytes(after) +
      ' (' + saved + '% smaller, ' + pages + (pages === 1 ? ' page' : ' pages') + ').';
    els.result.hidden = false;
    els.download.focus();
  }

  els.convert.addEventListener('click', compress);

  updateButton();
})();
