/* ==========================================================================
   Leafpress: PDF to Excel tool
   1. pdf.js (bundled in js/vendor/) reads the text on each page together with
      its position.
   2. Text on the same line is grouped into cells, and cells that line up
      vertically are grouped into columns.
   3. Leafpress.xlsx.build() (js/xlsx-builder.js) writes the .xlsx file.

   This works for PDFs that contain real, selectable text. Scanned PDFs are
   pictures of text and would need OCR, which this tool does not do.
   Everything runs in the browser and nothing is uploaded.
   ========================================================================== */
(function () {
  'use strict';

  var ns = window.Leafpress;
  if (!ns || !ns.xlsx) { return; }

  var MAX_PAGES = 300;
  var PREVIEW_ROWS = 30;
  var PREVIEW_COLS = 14;
  var LIB_URL = 'js/vendor/pdf.min.js';
  var WORKER_URL = 'js/vendor/pdf.worker.min.js';

  // How far apart (in font heights) two pieces of text must be to become separate cells.
  var GAP = { tight: 0.5, normal: 0.8, wide: 1.6 };

  var $ = function (selector) { return document.querySelector(selector); };

  var els = {
    card: $('#tool-card'),
    dropzone: $('#dropzone'),
    input: $('#file-input'),
    workspace: $('#workspace'),
    fileName: $('#file-name'),
    fileMeta: $('#file-meta'),
    changeFile: $('#change-file'),
    sheets: $('#opt-sheets'),
    columns: $('#opt-columns'),
    pages: $('#opt-pages'),
    numbers: $('#opt-numbers'),
    convert: $('#convert-btn'),
    progress: $('#progress'),
    bar: $('#progress-bar'),
    progressText: $('#progress-text'),
    result: $('#result'),
    resultText: $('#result-text'),
    download: $('#download-link'),
    startOver: $('#start-over'),
    preview: $('#preview'),
    previewTable: $('#preview-table'),
    previewNote: $('#preview-note'),
    error: $('#error-msg')
  };

  for (var key in els) {
    if (!els[key]) { return; }
  }

  var state = {
    file: null,
    doc: null,
    lib: null,
    pageCount: 0,
    cache: {},          // page number -> text items, so option changes re-run instantly
    busy: false,
    resultUrl: null,
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

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
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
    els.preview.hidden = true;
    els.previewTable.textContent = '';
  }

  function updateButton() {
    els.convert.disabled = state.busy || !state.file || !state.pageCount;
    els.convert.textContent = state.busy ? 'Converting\u2026' : 'Convert to Excel';
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
    return 'Something went wrong while converting the PDF. Please try again.';
  }

  /* ---------- Choosing a file ---------- */

  function closeDoc() {
    if (state.doc) {
      try { state.doc.destroy(); } catch (e) { /* already closed */ }
    }
    state.doc = null;
    state.cache = {};
  }

  async function openFile(file, token) {
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
      if (token !== state.fileToken) { doc.destroy(); return; }
      state.lib = lib;
      state.doc = doc;
      state.pageCount = doc.numPages;
      els.fileMeta.textContent = ns.formatBytes(file.size) + ', ' + plural(doc.numPages, 'page');
    } catch (error) {
      if (token !== state.fileToken) { return; }
      reset();
      showError(friendlyError(error));
      return;
    }
    updateButton();
  }

  function setFile(file) {
    clearResult();
    hideError();
    if (!file) { return; }
    if (!isPdf(file)) {
      showError('\u201C' + file.name + '\u201D is not a PDF. Choose a file that ends in .pdf.');
      return;
    }
    closeDoc();
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
    openFile(file, state.fileToken);
  }

  function reset() {
    closeDoc();
    state.file = null;
    state.pageCount = 0;
    state.fileToken += 1;
    clearResult();
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

  [els.sheets, els.columns, els.pages, els.numbers].forEach(function (control) {
    control.addEventListener('change', clearResult);
  });

  /* ---------- Page selection ---------- */

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
        return { error: 'This PDF has ' + plural(total, 'page') + '. Choose pages from 1 to ' + total + '.' };
      }
      for (var p = from; p <= to; p++) { chosen[p] = true; }
    }
    var list = Object.keys(chosen).map(Number).sort(function (a, b) { return a - b; });
    return list.length ? { list: list } : { list: all };
  }

  /* ---------- Reading text from a page ---------- */

  /** Text pieces of one page as { x, y, w, size, text } in page coordinates (y grows downward). */
  async function readPageItems(pageNumber) {
    if (state.cache[pageNumber]) { return state.cache[pageNumber]; }

    var page = await state.doc.getPage(pageNumber);
    var viewport = page.getViewport({ scale: 1 });
    var content = await page.getTextContent();
    var Util = state.lib.Util;
    var items = [];

    content.items.forEach(function (item) {
      if (typeof item.str !== 'string' || !item.str.trim()) { return; }
      var m = Util.transform(viewport.transform, item.transform);
      var size = Math.hypot(m[2], m[3]) || item.height || 10;
      items.push({ x: m[4], y: m[5], w: (item.width || 0) * viewport.scale, size: size, text: item.str });
    });

    page.cleanup();
    state.cache[pageNumber] = items;
    return items;
  }

  /* ---------- Turning text pieces into lines of cells ---------- */

  function buildLines(items, gapFactor) {
    var sorted = items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var groups = [];

    sorted.forEach(function (item) {
      var group = groups[groups.length - 1];
      if (group && Math.abs(item.y - group.y) <= Math.max(2, 0.45 * Math.min(group.size, item.size))) {
        group.items.push(item);
        group.y = (group.y * (group.items.length - 1) + item.y) / group.items.length;
        group.size = Math.max(group.size, item.size);
      } else {
        groups.push({ y: item.y, size: item.size, items: [item] });
      }
    });

    return groups.map(function (group) {
      var pieces = group.items.sort(function (a, b) { return a.x - b.x; });
      var cells = [];
      var current = null;

      pieces.forEach(function (piece) {
        var end = piece.x + piece.w;
        if (current) {
          var gap = piece.x - current.x1;
          var limit = gapFactor * Math.max(current.size, piece.size);
          if (gap <= limit) {
            var spaced = gap > 0.12 * piece.size && !/\s$/.test(current.text) && !/^\s/.test(piece.text);
            current.text += (spaced ? ' ' : '') + piece.text;
            current.x1 = Math.max(current.x1, end);
            current.size = Math.max(current.size, piece.size);
            return;
          }
          cells.push(current);
        }
        current = { x0: piece.x, x1: end, size: piece.size, text: piece.text };
      });
      if (current) { cells.push(current); }

      cells.forEach(function (cell) { cell.text = cell.text.replace(/\s+/g, ' ').trim(); });
      return cells.filter(function (cell) { return cell.text; });
    }).filter(function (cells) { return cells.length; });
  }

  /* ---------- Finding columns ---------- */

  /**
   * Work out column ranges from the x positions of cells on lines that have
   * two or more cells. A column boundary is a vertical strip that (almost) no
   * line crosses.
   */
  function findColumns(lines) {
    var multi = lines.filter(function (cells) { return cells.length >= 2; });
    if (!multi.length) { return []; }

    var maxX = 0;
    multi.forEach(function (cells) {
      cells.forEach(function (cell) { if (cell.x1 > maxX) { maxX = cell.x1; } });
    });
    var size = Math.ceil(maxX) + 2;
    var coverage = new Array(size).fill(0);

    multi.forEach(function (cells) {
      var seen = {};
      cells.forEach(function (cell) {
        var from = Math.max(0, Math.floor(cell.x0));
        var to = Math.min(size - 1, Math.ceil(cell.x1));
        for (var x = from; x <= to; x++) { seen[x] = true; }
      });
      for (var key in seen) { coverage[key] += 1; }
    });

    var allowed = Math.floor(multi.length * 0.05);   // a few wide cells may cross a boundary
    var columns = [];
    var start = null;
    var emptyRun = 0;
    var lastCovered = -1;

    for (var x = 0; x < size; x++) {
      if (coverage[x] > allowed) {
        if (start === null) { start = x; }
        else if (emptyRun >= 1) {
          columns.push({ x0: start, x1: lastCovered });
          start = x;
        }
        emptyRun = 0;
        lastCovered = x;
      } else if (start !== null) {
        emptyRun += 1;
      }
    }
    if (start !== null) { columns.push({ x0: start, x1: lastCovered }); }
    return columns;
  }

  function columnIndex(columns, x) {
    for (var i = 0; i < columns.length; i++) {
      if (x <= columns[i].x1 + 1) { return i; }
    }
    return columns.length - 1;
  }

  /** Lines of cells -> a rectangular grid of text (array of arrays). */
  function toGrid(lines) {
    var columns = findColumns(lines);
    if (!columns.length) {
      return lines.map(function (cells) {
        return [cells.map(function (cell) { return cell.text; }).join(' ')];
      });
    }
    return lines.map(function (cells) {
      var row = new Array(columns.length).fill('');
      cells.forEach(function (cell) {
        var index = columnIndex(columns, cell.x0);
        row[index] = row[index] ? row[index] + ' ' + cell.text : cell.text;
      });
      return row;
    });
  }

  /* ---------- Numbers ---------- */

  /** Turn "1,234.50", "(45)" or "12%" into numbers. Anything doubtful stays text. */
  function toCellValue(text) {
    var t = text.trim();
    var m = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(t);
    if (m) { return { value: parseFloat(m[1]) / 100, style: 'percent' }; }

    var negative = false;
    var s = t;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
    s = s.replace(/^[$\u20AC\u00A3\u20B9\u00A5]\s?/, '');
    if (/^[-\u2212]/.test(s)) { negative = true; s = s.slice(1).trim(); }

    var plain = /^\d+(\.\d+)?$/.test(s) || /^\.\d+$/.test(s);
    var western = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s);
    var indian = /^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(s);
    if (!(plain || western || indian)) { return text; }

    var digits = s.replace(/,/g, '');
    if (/^0\d/.test(digits)) { return text; }                 // 007, 0123: keep as text
    if (digits.replace('.', '').length > 15) { return text; } // long IDs and card-like numbers
    var value = parseFloat(digits);
    return negative ? -value : value;
  }

  /* ---------- Building the workbook ---------- */

  function gridToRows(grid, convertNumbers) {
    return grid.map(function (row) {
      return row.map(function (text) {
        return convertNumbers && text ? toCellValue(text) : text;
      });
    });
  }

  function renderPreview(sheet, totalSheets) {
    var rows = sheet.rows;
    var shownRows = Math.min(rows.length, PREVIEW_ROWS);
    var width = 0;
    rows.forEach(function (row) { if (row.length > width) { width = row.length; } });
    var shownCols = Math.min(width, PREVIEW_COLS);

    var table = els.previewTable;
    table.textContent = '';

    var head = document.createElement('thead');
    var headRow = document.createElement('tr');
    var corner = document.createElement('th');
    corner.scope = 'col';
    headRow.appendChild(corner);
    for (var c = 0; c < shownCols; c++) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = ns.xlsx.columnName(c);
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement('tbody');
    for (var r = 0; r < shownRows; r++) {
      var tr = document.createElement('tr');
      var num = document.createElement('th');
      num.scope = 'row';
      num.textContent = String(r + 1);
      tr.appendChild(num);
      for (var k = 0; k < shownCols; k++) {
        var td = document.createElement('td');
        var cell = rows[r][k];
        var value = cell !== null && typeof cell === 'object' ? cell.value : cell;
        if (typeof value === 'number') {
          td.className = 'num';
          td.textContent = cell.style === 'percent' ? (value * 100).toFixed(2) + '%' : String(value);
        } else {
          td.textContent = value === undefined || value === null ? '' : String(value);
        }
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);

    var notes = [];
    if (rows.length > shownRows) { notes.push('the first ' + shownRows + ' of ' + rows.length + ' rows'); }
    else { notes.push('all ' + plural(rows.length, 'row')); }
    if (width > shownCols) { notes.push('the first ' + shownCols + ' of ' + width + ' columns'); }
    els.previewNote.textContent = 'Preview of ' + (totalSheets > 1 ? 'sheet "' + sheet.name + '": ' : '') +
      notes.join(' and ') + '. The Excel file contains everything.';
    els.preview.hidden = false;
  }

  /* ---------- Convert ---------- */

  async function convert() {
    if (state.busy || !state.doc) { return; }
    hideError();

    var selection = parsePages(els.pages.value, state.pageCount);
    if (selection.error) { showError(selection.error); els.pages.focus(); return; }
    if (selection.list.length > MAX_PAGES) {
      showError('That is ' + selection.list.length + ' pages. Please convert up to ' + MAX_PAGES +
        ' pages at a time by using the Pages box, for example 1-' + MAX_PAGES + '.');
      els.pages.focus();
      return;
    }

    clearResult();
    state.busy = true;
    updateButton();

    var gapFactor = GAP[els.columns.value] || GAP.normal;
    var convertNumbers = els.numbers.checked;
    var perPage = els.sheets.value === 'per-page';

    try {
      var pageLines = [];
      var list = selection.list;
      for (var i = 0; i < list.length; i++) {
        setProgress(i / list.length, 'Reading page ' + list[i] + ' (' + (i + 1) + ' of ' + list.length + ')\u2026');
        await nextFrame();
        var lines = buildLines(await readPageItems(list[i]), gapFactor);
        if (lines.length) { pageLines.push({ page: list[i], lines: lines }); }
      }

      if (!pageLines.length) {
        showError('No selectable text was found on the chosen pages. This looks like a scanned PDF, which is a ' +
          'picture of text. Leafpress cannot read text from pictures (OCR), so it cannot convert this file yet.');
        return;
      }

      setProgress(1, 'Building the Excel file\u2026');
      await nextFrame();

      var sheets = [];
      if (perPage) {
        pageLines.forEach(function (entry) {
          sheets.push({ name: 'Page ' + entry.page, rows: gridToRows(toGrid(entry.lines), convertNumbers) });
        });
      } else {
        var everything = [];
        pageLines.forEach(function (entry) { everything = everything.concat(entry.lines); });
        sheets.push({ name: 'PDF data', rows: gridToRows(toGrid(everything), convertNumbers) });
      }

      var blob = ns.xlsx.build(sheets);
      var totalRows = 0;
      sheets.forEach(function (sheet) { totalRows += sheet.rows.length; });

      var baseName = ns.safeFileName(state.file.name.replace(/\.pdf$/i, ''), 'document');
      state.resultUrl = URL.createObjectURL(blob);
      els.download.href = state.resultUrl;
      els.download.setAttribute('download', baseName + '.xlsx');
      els.resultText.textContent = 'Done: ' + plural(totalRows, 'row') + ' from ' + plural(pageLines.length, 'page') +
        ' in ' + plural(sheets.length, 'sheet') + ' (' + ns.formatBytes(blob.size) + ').';
      els.result.hidden = false;
      renderPreview(sheets[0], sheets.length);
      els.download.focus();
    } catch (error) {
      showError(friendlyError(error));
    } finally {
      state.busy = false;
      els.progress.hidden = true;
      updateButton();
    }
  }

  els.convert.addEventListener('click', convert);

  updateButton();
})();
