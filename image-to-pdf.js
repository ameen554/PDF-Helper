/* ==========================================================================
   Leafpress: Image to PDF tool
   Everything runs in the browser. Images are read, rotated and resized on a
   canvas, saved as JPEG, and handed to Leafpress.pdf.build() (pdf-builder.js).
   Nothing is uploaded anywhere.
   ========================================================================== */
(function () {
  'use strict';

  var ns = window.Leafpress;
  if (!ns || !ns.pdf) { return; }

  // Larger "maxDim" keeps more detail; a lower JPEG value makes smaller files.
  var QUALITY = {
    high: { maxDim: 3840, jpeg: 0.92 },
    medium: { maxDim: 2400, jpeg: 0.8 },
    low: { maxDim: 1400, jpeg: 0.6 }
  };

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
    size: $('#opt-size'),
    orient: $('#opt-orient'),
    margin: $('#opt-margin'),
    quality: $('#opt-quality'),
    name: $('#opt-name'),
    convert: $('#convert-btn'),
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
    if (!els[key]) { return; } // Page is missing an element; do nothing rather than break.
  }

  var state = {
    items: [],
    nextId: 1,
    busy: false,
    dragId: null,
    resultUrl: null
  };

  /* ---------- Helpers ---------- */

  function isSupported(file) {
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) { return false; }
    return /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name);
  }

  function indexOf(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) { return i; }
    }
    return -1;
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
  }

  /* ---------- Adding, removing and ordering images ---------- */

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var skipped = [];

    files.forEach(function (file) {
      if (isSupported(file)) {
        state.items.push({ id: state.nextId++, file: file, url: URL.createObjectURL(file), rotation: 0 });
      } else {
        skipped.push(file.name);
      }
    });

    clearResult();
    if (skipped.length) {
      showError('Skipped ' + skipped.length + (skipped.length === 1 ? ' file' : ' files') +
        ' that ' + (skipped.length === 1 ? 'is' : 'are') + ' not supported images: ' +
        skipped.slice(0, 3).join(', ') + (skipped.length > 3 ? '…' : '') +
        '. Use JPG, PNG, WebP, GIF, BMP or AVIF.');
    } else {
      hideError();
    }
    render();
  }

  function move(from, to) {
    if (from === to || from < 0 || to < 0 || to >= state.items.length) { return; }
    var item = state.items.splice(from, 1)[0];
    state.items.splice(to, 0, item);
    clearResult();
  }

  function removeItem(index) {
    var item = state.items.splice(index, 1)[0];
    if (item) { URL.revokeObjectURL(item.url); }
    clearResult();
  }

  function clearAll() {
    state.items.forEach(function (item) { URL.revokeObjectURL(item.url); });
    state.items = [];
    clearResult();
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

  function actionButton(action, glyph, label, disabled) {
    var btn = make('button', 'icon-btn', glyph);
    btn.type = 'button';
    btn.dataset.action = action;
    btn.setAttribute('aria-label', label);
    btn.disabled = !!disabled;
    return btn;
  }

  function buildCard(item, index, total) {
    var name = item.file.name;
    var li = make('li', 'file-card');
    li.draggable = true;
    li.dataset.id = String(item.id);

    var thumb = make('div', 'thumb');
    var img = document.createElement('img');
    img.className = 'thumb-img';
    img.src = item.url;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.style.transform = 'rotate(' + item.rotation + 'deg)';
    thumb.appendChild(img);
    thumb.appendChild(make('span', 'page-no', String(index + 1)));

    var title = make('p', 'file-name', name);
    title.title = name;

    var actions = make('div', 'card-actions');
    actions.appendChild(actionButton('left', '\u2190', 'Move ' + name + ' earlier', index === 0));
    actions.appendChild(actionButton('right', '\u2192', 'Move ' + name + ' later', index === total - 1));
    actions.appendChild(actionButton('rotate', '\u21BB', 'Rotate ' + name + ' clockwise', false));
    actions.appendChild(actionButton('remove', '\u2715', 'Remove ' + name, false));

    li.appendChild(thumb);
    li.appendChild(title);
    li.appendChild(make('p', 'file-meta', ns.formatBytes(item.file.size)));
    li.appendChild(actions);
    return li;
  }

  function render() {
    var count = state.items.length;
    var totalBytes = 0;
    state.items.forEach(function (item) { totalBytes += item.file.size; });

    els.workspace.hidden = count === 0;
    els.dropzone.classList.toggle('is-compact', count > 0);

    els.list.textContent = '';
    var fragment = document.createDocumentFragment();
    state.items.forEach(function (item, i) { fragment.appendChild(buildCard(item, i, count)); });
    els.list.appendChild(fragment);

    els.summary.textContent = count + (count === 1 ? ' image' : ' images') +
      ' selected (' + ns.formatBytes(totalBytes) + ')';
    updateButton();
  }

  function updateButton() {
    var count = state.items.length;
    els.convert.disabled = state.busy || count === 0;
    els.convert.textContent = state.busy
      ? 'Converting\u2026'
      : (count > 1 ? 'Convert ' + count + ' images to PDF' : 'Convert to PDF');
  }

  function focusAction(id, action) {
    var btn = els.list.querySelector('[data-id="' + id + '"] [data-action="' + action + '"]');
    if (btn && btn.disabled) {
      btn = els.list.querySelector('[data-id="' + id + '"] [data-action="' + (action === 'left' ? 'right' : 'left') + '"]');
    }
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
    addFiles(els.input.files);
    els.input.value = '';
  });

  // Drag files from the desktop onto the tool.
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
    addFiles(event.dataTransfer.files);
  });

  // Stop the browser from opening a file that is dropped just outside the tool.
  ['dragover', 'drop'].forEach(function (type) {
    window.addEventListener(type, function (event) {
      if (hasFiles(event)) { event.preventDefault(); }
    });
  });

  // Paste images from the clipboard (Ctrl+V or Cmd+V).
  document.addEventListener('paste', function (event) {
    var files = event.clipboardData && event.clipboardData.files;
    if (files && files.length) { addFiles(files); }
  });

  /* ---------- Events: the image list ---------- */

  els.list.addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-action]');
    if (!btn) { return; }
    var card = btn.closest('.file-card');
    var id = Number(card.dataset.id);
    var index = indexOf(id);
    var action = btn.dataset.action;
    if (index === -1) { return; }

    if (action === 'rotate') {
      // Update in place so the button keeps keyboard focus.
      var item = state.items[index];
      item.rotation = (item.rotation + 90) % 360;
      card.querySelector('.thumb-img').style.transform = 'rotate(' + item.rotation + 'deg)';
      clearResult();
      return;
    }

    if (action === 'left') {
      move(index, index - 1);
      render();
      focusAction(id, 'left');
    } else if (action === 'right') {
      move(index, index + 1);
      render();
      focusAction(id, 'right');
    } else if (action === 'remove') {
      removeItem(index);
      render();
      var neighbour = state.items[Math.min(index, state.items.length - 1)];
      if (neighbour) {
        var next = els.list.querySelector('[data-id="' + neighbour.id + '"] [data-action="remove"]');
        if (next) { next.focus(); }
      } else {
        els.dropzone.focus();
      }
    }
  });

  // Drag to reorder.
  function clearDragMarks() {
    var marked = els.list.querySelectorAll('.is-dragging, .is-target');
    for (var i = 0; i < marked.length; i++) { marked[i].classList.remove('is-dragging', 'is-target'); }
  }

  els.list.addEventListener('dragstart', function (event) {
    var card = event.target.closest && event.target.closest('.file-card');
    if (!card) { return; }
    state.dragId = Number(card.dataset.id);
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(state.dragId));
  });

  els.list.addEventListener('dragover', function (event) {
    if (state.dragId === null) { return; }
    event.preventDefault();
    var card = event.target.closest('.file-card');
    var previous = els.list.querySelector('.is-target');
    if (previous && previous !== card) { previous.classList.remove('is-target'); }
    if (card && Number(card.dataset.id) !== state.dragId) { card.classList.add('is-target'); }
  });

  els.list.addEventListener('drop', function (event) {
    if (state.dragId === null) { return; }
    event.preventDefault();
    var card = event.target.closest('.file-card');
    if (card) { move(indexOf(state.dragId), indexOf(Number(card.dataset.id))); }
    state.dragId = null;
    clearDragMarks();
    render();
  });

  els.list.addEventListener('dragend', function () {
    state.dragId = null;
    clearDragMarks();
  });

  /* ---------- Options ---------- */

  function syncOptions() {
    els.orient.disabled = els.size.value === 'fit';
    clearResult();
  }
  els.size.addEventListener('change', syncOptions);
  [els.orient, els.margin, els.quality, els.name].forEach(function (control) {
    control.addEventListener('change', clearResult);
  });
  syncOptions();

  function readOptions() {
    var title = ns.safeFileName(els.name.value, 'images');
    return {
      pageSize: els.size.value,
      orientation: els.orient.value,
      margin: parseFloat(els.margin.value) || 0,
      quality: QUALITY[els.quality.value] || QUALITY.high,
      title: title,
      filename: title + '.pdf'
    };
  }

  /* ---------- Turning images into JPEG data ---------- */

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

  function canvasToJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('Could not encode JPEG')); return; }
        blob.arrayBuffer().then(function (buffer) { resolve(new Uint8Array(buffer)); }, reject);
      }, 'image/jpeg', quality);
    });
  }

  function imageToJpeg(item, quality) {
    return loadImage(item.file).then(function (source) {
      var srcW = source.naturalWidth || source.width;
      var srcH = source.naturalHeight || source.height;
      var scale = Math.min(1, quality.maxDim / Math.max(srcW, srcH));
      var drawW = Math.max(1, Math.round(srcW * scale));
      var drawH = Math.max(1, Math.round(srcH * scale));
      var quarterTurn = item.rotation === 90 || item.rotation === 270;

      var canvas = document.createElement('canvas');
      canvas.width = quarterTurn ? drawH : drawW;
      canvas.height = quarterTurn ? drawW : drawH;

      var ctx = canvas.getContext('2d');
      // JPEG has no transparency, so transparent PNGs get a white background.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(item.rotation * Math.PI / 180);
      ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);

      if (source.close) { source.close(); }

      return canvasToJpeg(canvas, quality.jpeg).then(function (bytes) {
        canvas.width = canvas.height = 0; // free memory
        return bytes;
      });
    });
  }

  /* ---------- Convert ---------- */

  function setProgress(fraction, text) {
    els.progress.hidden = false;
    els.bar.style.width = Math.round(fraction * 100) + '%';
    els.progressText.textContent = text;
  }

  function convert() {
    if (state.busy || !state.items.length) { return Promise.resolve(); }

    state.busy = true;
    updateButton();
    clearResult();
    hideError();

    var options = readOptions();
    var items = state.items.slice();
    var jpegs = [];
    setProgress(0, 'Getting started\u2026');

    // Convert one image at a time so large batches do not freeze the page or run out of memory.
    var chain = nextFrame();
    items.forEach(function (item, i) {
      chain = chain.then(function () {
        setProgress(i / items.length, 'Preparing image ' + (i + 1) + ' of ' + items.length + '\u2026');
        return nextFrame();
      }).then(function () {
        return imageToJpeg(item, options.quality).then(function (bytes) {
          jpegs.push(bytes);
        }, function () {
          throw new Error('Could not read \u201C' + item.file.name + '\u201D. It may be damaged, or in a format ' +
            'your browser cannot open (HEIC photos, for example). Remove it and try again.');
        });
      });
    });

    return chain.then(function () {
      setProgress(1, 'Building your PDF\u2026');
      return nextFrame();
    }).then(function () {
      var blob = ns.pdf.build(jpegs, {
        pageSize: options.pageSize,
        orientation: options.orientation,
        margin: options.margin,
        title: options.title
      });
      showResult(blob, options.filename, jpegs.length);
    }).catch(function (error) {
      showError(error && error.message ? error.message : 'Something went wrong while building the PDF. Please try again.');
    }).then(function () {
      state.busy = false;
      els.progress.hidden = true;
      updateButton();
    });
  }

  function showResult(blob, filename, pages) {
    state.resultUrl = URL.createObjectURL(blob);
    els.download.href = state.resultUrl;
    els.download.setAttribute('download', filename);
    els.resultText.textContent = 'Your PDF is ready: ' + pages + (pages === 1 ? ' page, ' : ' pages, ') +
      ns.formatBytes(blob.size) + '.';
    els.result.hidden = false;
    els.download.focus();
  }

  els.convert.addEventListener('click', convert);

  render();
})();
