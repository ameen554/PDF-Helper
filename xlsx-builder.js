/* ==========================================================================
   Leafpress: XLSX builder
   Writes a simple Excel workbook (.xlsx) in the browser with no libraries.
   An .xlsx file is a ZIP of XML files, so this uses Leafpress.zip.build()
   from js/zip-builder.js (load that script first).

   Usage:
     var blob = Leafpress.xlsx.build([
       {
         name: 'Page 1',
         rows: [
           ['Item', 'Qty', 'Price'],            // strings and numbers
           ['Pens', 12, 1.5],
           ['Tax', { value: 0.18, style: 'percent' }, ''],
           [{ value: 'Total', style: 'bold' }, 12, 18]
         ]
       }
     ]);

   A cell can be a string, a number, an empty value, or { value, style } where
   style is 'bold' or 'percent'.
   ========================================================================== */
(function (global) {
  'use strict';

  var ns = (global.Leafpress = global.Leafpress || {});
  var encoder = new TextEncoder();

  var MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  var STYLE_INDEX = { normal: 0, bold: 1, percent: 2 };

  /** Remove characters XML cannot hold, then escape the rest. */
  function esc(text) {
    return String(text)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 0 -> A, 25 -> Z, 26 -> AA */
  function columnName(index) {
    var name = '';
    var n = index + 1;
    while (n > 0) {
      var rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  /** Sheet names: max 31 characters, no []:*?/\ , and unique. */
  function cleanSheetName(name, used) {
    var base = String(name || 'Sheet').replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
    var candidate = base;
    var n = 2;
    while (used[candidate.toLowerCase()]) {
      var suffix = ' ' + n++;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    used[candidate.toLowerCase()] = true;
    return candidate;
  }

  function cellXml(cell, ref) {
    var value = cell;
    var style = 0;
    if (cell !== null && typeof cell === 'object') {
      value = cell.value;
      style = STYLE_INDEX[cell.style] || 0;
    }
    if (value === null || value === undefined || value === '') { return ''; }
    var s = style ? ' s="' + style + '"' : '';
    if (typeof value === 'number' && isFinite(value)) {
      return '<c r="' + ref + '"' + s + '><v>' + value + '</v></c>';
    }
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>';
  }

  function textLength(cell) {
    var value = cell !== null && typeof cell === 'object' ? cell.value : cell;
    return value === null || value === undefined ? 0 : String(value).length;
  }

  function sheetXml(rows) {
    var widths = [];
    var xml = '';
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      var cells = '';
      for (var c = 0; c < row.length; c++) {
        cells += cellXml(row[c], columnName(c) + (r + 1));
        var len = textLength(row[c]);
        if (len > (widths[c] || 0)) { widths[c] = len; }
      }
      xml += '<row r="' + (r + 1) + '">' + cells + '</row>';
    }
    var cols = '';
    for (var i = 0; i < widths.length; i++) {
      if (widths[i] === undefined) { continue; }
      var width = Math.min(60, Math.max(8, widths[i] + 2));
      cols += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"/>';
    }
    return XML_HEAD + '<worksheet xmlns="' + MAIN_NS + '">' +
      (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + xml + '</sheetData></worksheet>';
  }

  var STYLES_XML = XML_HEAD + '<styleSheet xmlns="' + MAIN_NS + '">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /**
   * @param {{name: string, rows: Array[]}[]} sheets
   * @returns {Blob}
   */
  function build(sheets) {
    if (!sheets || !sheets.length) { throw new Error('A workbook needs at least one sheet.'); }
    var used = {};
    var files = [];
    var overrides = '';
    var sheetEntries = '';
    var relEntries = '';

    sheets.forEach(function (sheet, i) {
      var n = i + 1;
      var name = cleanSheetName(sheet.name, used);
      files.push({ name: 'xl/worksheets/sheet' + n + '.xml', bytes: encoder.encode(sheetXml(sheet.rows || [])) });
      overrides += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      sheetEntries += '<sheet name="' + esc(name) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
      relEntries += '<Relationship Id="rId' + n + '" Type="' + REL_NS + '/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
    });

    var stylesId = sheets.length + 1;
    relEntries += '<Relationship Id="rId' + stylesId + '" Type="' + REL_NS + '/styles" Target="styles.xml"/>';

    var contentTypes = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      overrides +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rootRels = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL_NS + '/officeDocument" Target="xl/workbook.xml"/></Relationships>';

    var workbook = XML_HEAD + '<workbook xmlns="' + MAIN_NS + '" xmlns:r="' + REL_NS + '"><sheets>' + sheetEntries + '</sheets></workbook>';

    var workbookRels = XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relEntries + '</Relationships>';

    var all = [
      { name: '[Content_Types].xml', bytes: encoder.encode(contentTypes) },
      { name: '_rels/.rels', bytes: encoder.encode(rootRels) },
      { name: 'xl/workbook.xml', bytes: encoder.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', bytes: encoder.encode(workbookRels) },
      { name: 'xl/styles.xml', bytes: encoder.encode(STYLES_XML) }
    ].concat(files);

    return new Blob([ns.zip.build(all)], { type: MIME });
  }

  ns.xlsx = { build: build, columnName: columnName, MIME: MIME };
})(typeof window !== 'undefined' ? window : globalThis);
