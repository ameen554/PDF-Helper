/* ==========================================================================
   Leafpress: Compress Image tool
   Each image is redrawn on a canvas (optionally smaller) and saved again as
   JPEG, WebP or PNG at the chosen quality. Everything runs in the browser and
   nothing is uploaded. Redrawing also removes hidden metadata such as location.

   If the new file is not smaller than the original, the original is kept, so
   the tool never hands back a bigger file.
   ========================================================================== */
(function () {
  'use strict';

  var ns = window.Leafpress;
  if (!ns || !ns.zip) { return; }

  // Browsers can fail on very large canvases (iPhones are the strictest),
  // so photos above this many pixels are scaled down to fit.
  var MAX_PIXELS = 16000000;

  var EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

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
    format: $('#opt-format'),
    resize: $('#opt-resize'),
    quality: $('#opt-quality'),
    qualityValue: $('#quality-value'),
    convert: $('#compress-btn'),
    progress: $('#progress'),
    bar: $('#progress-bar'),
    progressText: $('#progress-text'),
    result: $('#result'),
    resultText: $('#result-text'),
    downloadAll: $('#download-all'),
    startOver: $('#start-over'),
    error: $('#error-msg')
  };

  for (var key in els) {
    if (!els[key]) { return; }
  }

  var state = { items: [], nextId: 1, busy: false, zipUrl: null };

  /* ---------- Helpers ---------- */

  function guessType(file) {
    if (file.type) { return file.type; }
    var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || '';
  }

  function isSupported(file) {
    var type = guessType(file);
    if (type === 'image/gif' || type === 'image/svg+xml' || /\.(gif|svg)$/i.test(file.name)) { return false; }
    return /^image\//.test(type) || /\.(jpe?g|png|webp|avif|bmp|heic|heif)$/i.test(file.name);
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
  var webpOk = supportsWebp();
  if (!webpOk) {
    var webpOption = els.format.querySelector('option[value="webp"]');
    if (webpOption) {
      webpOption.disabled = true;
      webpOption.textContent += ' (not supported by this browser)';
    }
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

  function baseName(name) {
    return ns.safeFileName(name.replace(/\.[a-z0-9]+$/i, ''), 'image');
  }

  function indexOf(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) { return i; }
    }
    return -1;
  }

  function releaseOutputs() {
    if (state.zipUrl) {
      URL.revokeObjectURL(state.zipUrl);
      state.zipUrl = null;
    }
    els.downloadAll.removeAttribute('href');
    els.result.hidden = true;
    state.items.forEach(function (item) {
      if (item.outUrl) { URL.revokeObjectURL(item.outUrl); }
      item.outUrl = null;
      item.outBlob = null;
      item.status = 'pending';
      item.note = '';
    });
  }

  /** Forget any earlier results and redraw the list. */
  function resetResults() {
    var hadResults = !els.result.hidden || state.items.some(function (item) { return item.status !== 'pending'; });
    if (!hadResults) { return; }
    releaseOutputs();
    render();
  }

  /* ---------- Adding and removing images ---------- */

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var skipped = [];

    releaseOutputs();
    files.forEach(function (file) {
      if (isSupported(file)) {
        state.items.push({
          id: state.nextId++, file: file, url: URL.createObjectURL(file),
          status: 'pending', note: '', outBlob: null, outUrl: null, outName: ''
        });
      } else {
        skipped.push(file.name);
      }
    });

    if (skipped.length) {
      showError('Skipped ' + skipped.length + (skipped.length === 1 ? ' file' : ' files') +
        ' that ' + (skipped.length === 1 ? 'is' : 'are') + ' not supported: ' + skipped.slice(0, 3).join(', ') +
        (skipped.length > 3 ? '\u2026' : '') + '. Use JPG, PNG, WebP, AVIF or BMP images.');
    } else {
      hideError();
    }
    render();
  }

  function removeItem(index) {
    var item = state.items.splice(index, 1)[0];
    if (item) {
      URL.revokeObjectURL(item.url);
      if (item.outUrl) { URL.revokeObjectURL(item.outUrl); }
    }
    releaseOutputs();
  }

  function clearAll() {
    state.items.forEach(function (item) {
      URL.revokeObjectURL(item.url);
      if (item.outUrl) { URL.revokeObjectURL(item.outUrl); }
    });
    state.items = [];
    releaseOutputs();
    hideError();
    render();
  }

  /* ---------- Rendering the list ---------- */

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function metaText(item) {
    var before = ns.formatBytes(item.file.size);
    if (item.status === 'done') {
      var saved = Math.round((1 - item.outBlob.size / item.file.size) * 100);
      return before + ' to ' + ns.formatBytes(item.outBlob.size) + ' (' + saved + '% smaller)';
    }
    if (item.status === 'kept') { return before + '. Already well optimised, so the original was kept.'; }
    if (item.status === 'error') { return item.note; }
    return before;
  }

  function buildRow(item) {
    var li = make('li', 'img-row' + (item.status === 'error' ? ' is-error' : ''));
    li.dataset.id = String(item.id);

    var thumb = document.createElement('img');
    thumb.className = 'img-thumb';
    thumb.src = item.url;
    thumb.alt = '';
    thumb.decoding = 'async';

    var text = make('div', 'img-row-text');
    var name = make('p', 'img-row-name', item.file.name);
    name.title = item.file.name;
    text.appendChild(name);
    text.appendChild(make('p', 'img-row-meta', metaText(item)));

    var actions = make('div', 'img-row-actions');
    if (item.status === 'done' && item.outUrl) {
      var link = make('a', 'btn btn-secondary btn-sm', 'Download');
      link.href = item.outUrl;
      link.setAttribute('download', item.outName);
      link.setAttribute('aria-label', 'Download compressed ' + item.file.name);
      actions.appendChild(link);
    }
    var remove = make('button', 'btn btn-quiet btn-sm', 'Remove');
    remove.type = 'button';
    remove.dataset.action = 'remove';
    remove.disabled = state.busy;
    remove.setAttribute('aria-label', 'Remove ' + item.file.name);
    actions.appendChild(remove);

    li.appendChild(thumb);
    li.appendChild(text);
    li.appendChild(actions);
    return li;
  }

  function render() {
    var count = state.items.length;
    var total = 0;
    state.items.forEach(function (item) { total += item.file.size; });

    els.workspace.hidden = count === 0;
    els.dropzone.classList.toggle('is-compact', count > 0);

    els.list.textContent = '';
    var fragment = document.createDocumentFragment();
    state.items.forEach(function (item) { fragment.appendChild(buildRow(item)); });
    els.list.appendChild(fragment);

    els.summary.textContent = count + (count === 1 ? ' image' : ' images') + ' selected (' + ns.formatBytes(total) + ')';
    updateButtons();
  }

  function refreshRow(item) {
    var row = els.list.querySelector('[data-id="' + item.id + '"]');
    if (row) { row.replaceWith(buildRow(item)); }
  }

  function updateButtons() {
    var count = state.items.length;
    els.convert.disabled = state.busy || count === 0;
    els.convert.textContent = state.busy ? 'Compressing\u2026'
      : (count > 1 ? 'Compress ' + count + ' images' : 'Compress image');
    els.addMore.disabled = state.busy;
    els.clearAll.disabled = state.busy;
  }

  function setProgress(fraction, text) {
    els.progress.hidden = false;
    els.bar.style.width = Math.round(fraction * 100) + '%';
    els.progressText.textContent = text;
  }

  /* ---------- Events ---------- */

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
    addFiles(els.input.files);
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

  document.addEventListener('paste', function (event) {
    var files = event.clipboardData && event.clipboardData.files;
    if (files && files.length && !state.busy) { addFiles(files); }
  });

  els.list.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-action="remove"]');
    if (!btn || state.busy) { return; }
    var index = indexOf(Number(btn.closest('.img-row').dataset.id));
    if (index === -1) { return; }
    removeItem(index);
    render();
    var neighbour = state.items[Math.min(index, state.items.length - 1)];
    var next = neighbour && els.list.querySelector('[data-id="' + neighbour.id + '"] [data-action="remove"]');
    if (next) { next.focus(); } else { els.dropzone.focus(); }
  });

  els.quality.addEventListener('input', function () {
    els.qualityValue.textContent = els.quality.value + '%';
  });
  [els.format, els.resize, els.quality].forEach(function (control) {
    control.addEventListener('change', resetResults);
  });

  /* ---------- Compressing one image ---------- */

  function loadImage(file) {
    if (window.createImageBitmap) {
      return window.createImageBitmap(file).catch(function () { return loadWithElement(file); });
    }
    return loadWithElement(file);
  }

  function loadWithElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        if (!img.naturalWidth || !img.naturalHeight) { reject(new Error('Empty image')); return; }
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode image'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob && blob.type === type) { resolve(blob); } else { reject(new Error('Could not encode image')); }
      }, type, quality);
    });
  }

  function chooseType(file, format) {
    var type;
    if (format === 'jpeg') {
      type = 'image/jpeg';
    } else if (format === 'webp') {
      type = 'image/webp';
    } else {
      var original = guessType(file);
      type = (original === 'image/png' || original === 'image/webp' || original === 'image/jpeg') ? original : 'image/jpeg';
    }
    if (type === 'image/webp' && !webpOk) { type = 'image/jpeg'; }
    return type;
  }

  function compressOne(item, settings) {
    return loadImage(item.file).then(function (source) {
      var srcW = source.naturalWidth || source.width;
      var srcH = source.naturalHeight || source.height;

      var scale = 1;
      if (settings.maxSide > 0) { scale = Math.min(1, settings.maxSide / Math.max(srcW, srcH)); }
      if (srcW * srcH * scale * scale > MAX_PIXELS) { scale = Math.sqrt(MAX_PIXELS / (srcW * srcH)); }
      var w = Math.max(1, Math.round(srcW * scale));
      var h = Math.max(1, Math.round(srcH * scale));

      var type = chooseType(item.file, settings.format);
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (type === 'image/jpeg') {
        // JPEG cannot be see-through, so transparent areas become white.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, w, h);
      if (source.close) { source.close(); }

      return canvasToBlob(canvas, type, settings.quality).then(function (blob) {
        canvas.width = canvas.height = 0; // free memory
        return { blob: blob, type: type };
      });
    });
  }

  /* ---------- Compress everything ---------- */

  async function compressAll() {
    if (state.busy || !state.items.length) { return; }

    releaseOutputs();
    render();
    hideError();
    state.busy = true;
    updateButtons();

    var settings = {
      format: els.format.value,
      maxSide: parseInt(els.resize.value, 10) || 0,
      quality: (parseInt(els.quality.value, 10) || 75) / 100
    };
    var items = state.items.slice();
    var used = {};

    try {
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        setProgress(i / items.length, 'Compressing image ' + (i + 1) + ' of ' + items.length + '\u2026');
        await nextFrame();

        try {
          var out = await compressOne(item, settings);
          if (out.blob.size >= item.file.size) {
            item.status = 'kept';
          } else {
            item.status = 'done';
            item.outBlob = out.blob;
            item.outUrl = URL.createObjectURL(out.blob);
            var name = baseName(item.file.name) + '-compressed';
            var ext = EXTENSIONS[out.type];
            var candidate = name + '.' + ext;
            var n = 2;
            while (used[candidate.toLowerCase()]) { candidate = name + '-' + n++ + '.' + ext; }
            item.outName = candidate;
          }
        } catch (error) {
          item.status = 'error';
          item.note = 'Could not read this image. It may be damaged, or in a format your browser cannot open.';
        }
        if (item.outName) { used[item.outName.toLowerCase()] = true; }
        refreshRow(item);
      }

      setProgress(1, 'Finishing up\u2026');
      await nextFrame();
      await showSummary(items);
    } catch (error) {
      showError('Something went wrong while compressing. Please try again with fewer images.');
    } finally {
      state.busy = false;
      els.progress.hidden = true;
      updateButtons();
      render();
    }
  }

  async function showSummary(items) {
    var ok = items.filter(function (item) { return item.status === 'done' || item.status === 'kept'; });
    var failed = items.length - ok.length;
    var improved = items.filter(function (item) { return item.status === 'done'; });

    if (!ok.length) {
      showError('None of the images could be read. Try JPG, PNG or WebP files.');
      return;
    }

    var before = 0;
    var after = 0;
    ok.forEach(function (item) {
      before += item.file.size;
      after += item.status === 'done' ? item.outBlob.size : item.file.size;
    });

    els.downloadAll.hidden = true;
    if (!improved.length) {
      els.resultText.textContent = 'These images are already well optimised, so none were made smaller. Your originals are unchanged.';
    } else {
      var saved = Math.round((1 - after / before) * 100);
      els.resultText.textContent = 'Done: ' + ns.formatBytes(before) + ' is now ' + ns.formatBytes(after) +
        ' (' + saved + '% smaller)' + (failed ? '. ' + failed + (failed === 1 ? ' image' : ' images') + ' could not be read.' : '.');

      if (ok.length === 1) {
        els.downloadAll.href = improved[0].outUrl;
        els.downloadAll.setAttribute('download', improved[0].outName);
        els.downloadAll.textContent = 'Download image';
      } else {
        var files = [];
        var taken = {};
        for (var i = 0; i < ok.length; i++) {
          var item = ok[i];
          var bytes = new Uint8Array(await (item.status === 'done' ? item.outBlob : item.file).arrayBuffer());
          var name = item.status === 'done' ? item.outName : item.file.name;
          var unique = name;
          var n = 2;
          while (taken[unique.toLowerCase()]) { unique = n++ + '-' + name; }
          taken[unique.toLowerCase()] = true;
          files.push({ name: unique, bytes: bytes });
        }
        state.zipUrl = URL.createObjectURL(ns.zip.build(files));
        els.downloadAll.href = state.zipUrl;
        els.downloadAll.setAttribute('download', 'compressed-images.zip');
        els.downloadAll.textContent = 'Download all (ZIP)';
      }
      els.downloadAll.hidden = false;
    }
    els.result.hidden = false;
  }

  els.convert.addEventListener('click', compressAll);

  render();
})();
