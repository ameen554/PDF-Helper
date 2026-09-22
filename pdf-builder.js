/* ==========================================================================
   Leafpress: PDF builder
   A tiny, dependency-free PDF writer. It takes JPEG images and places one
   image on each page. JPEG data is embedded as-is (DCTDecode), so building
   the PDF is fast and uses very little memory.

   Usage:
     var blob = Leafpress.pdf.build(
       [uint8ArrayOfJpeg1, uint8ArrayOfJpeg2],
       { pageSize: 'a4', orientation: 'auto', margin: 18, title: 'My PDF' }
     );
   ========================================================================== */
(function (global) {
  'use strict';

  var ns = (global.Leafpress = global.Leafpress || {});
  var encoder = new TextEncoder();

  // Page sizes in PDF points (1 point = 1/72 inch).
  var PAGE_SIZES = {
    a3: [841.89, 1190.55],
    a4: [595.28, 841.89],
    a5: [419.53, 595.28],
    letter: [612, 792],
    legal: [612, 1008]
  };

  // Used when the page should match the image: 1 pixel = 0.75 point (96 dpi).
  var PX_TO_PT = 0.75;
  // PDF viewers handle pages up to 14,400 points reliably.
  var MAX_PAGE_POINTS = 14000;

  function num(n) {
    return String(Math.round(n * 100) / 100);
  }

  /** Read width, height and colour components from a JPEG header. */
  function readJpegInfo(bytes) {
    if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('The image data is not a valid JPEG.');
    }
    var i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      var marker = bytes[i + 1];
      if (marker === 0xff) { i++; continue; }
      // Markers without a length field
      if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      var isFrame = marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
          components: bytes[i + 9]
        };
      }
      i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
    throw new Error('Could not read the JPEG dimensions.');
  }

  /** Work out the page size and where the image sits on it. pxToPt is optional (see build). */
  function layout(imgW, imgH, options, pxToPt) {
    var margin = Math.max(0, Number(options.margin) || 0);
    var size = PAGE_SIZES[options.pageSize];

    if (!size) {
      // "Same as image": the page hugs the image, plus the margin.
      var ratio = Number(pxToPt) || Number(options.pxToPt) || PX_TO_PT;
      var w = imgW * ratio;
      var h = imgH * ratio;
      var limit = MAX_PAGE_POINTS - margin * 2;
      var shrink = Math.min(1, limit / Math.max(w, h));
      w *= shrink;
      h *= shrink;
      return { pageW: w + margin * 2, pageH: h + margin * 2, x: margin, y: margin, w: w, h: h };
    }

    var short = Math.min(size[0], size[1]);
    var long = Math.max(size[0], size[1]);
    var landscape = options.orientation === 'landscape' ||
      (options.orientation !== 'portrait' && imgW > imgH);
    var pageW = landscape ? long : short;
    var pageH = landscape ? short : long;

    var availW = Math.max(pageW - margin * 2, 1);
    var availH = Math.max(pageH - margin * 2, 1);
    var scale = Math.min(availW / imgW, availH / imgH);
    var drawW = imgW * scale;
    var drawH = imgH * scale;

    return {
      pageW: pageW,
      pageH: pageH,
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      w: drawW,
      h: drawH
    };
  }

  /** Encode text as a PDF UTF-16BE hex string so any language works in the title. */
  function pdfText(text) {
    var hex = 'FEFF';
    for (var i = 0; i < text.length; i++) {
      hex += ('0000' + text.charCodeAt(i).toString(16)).slice(-4).toUpperCase();
    }
    return '<' + hex + '>';
  }

  function pad10(n) {
    return ('0000000000' + n).slice(-10);
  }

  /**
   * Build a PDF.
   * @param {Array} jpegs         One entry per page: a Uint8Array of JPEG data, or
   *                              { bytes: Uint8Array, pxToPt: number } to set the page's
   *                              physical size when pageSize is "fit" (points per pixel).
   * @param {Object} options      pageSize, orientation, margin (points), title
   * @returns {Blob}
   */
  function build(jpegs, options) {
    options = options || {};
    var count = jpegs.length;
    if (!count) { throw new Error('There are no images to convert.'); }

    var chunks = [];
    var offset = 0;
    var offsets = [0];

    function put(data) {
      var bytes = typeof data === 'string' ? encoder.encode(data) : data;
      chunks.push(bytes);
      offset += bytes.length;
    }
    function begin(id) {
      offsets[id] = offset;
      put(id + ' 0 obj\n');
    }
    function end() {
      put('endobj\n');
    }

    var infoId = 3 + count * 3;
    var kids = [];
    for (var k = 0; k < count; k++) { kids.push((3 + k * 3) + ' 0 R'); }

    put('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');

    begin(1);
    put('<< /Type /Catalog /Pages 2 0 R >>\n');
    end();

    begin(2);
    put('<< /Type /Pages /Count ' + count + ' /Kids [' + kids.join(' ') + '] >>\n');
    end();

    for (var i = 0; i < count; i++) {
      var entry = jpegs[i];
      var bytes = entry && entry.bytes ? entry.bytes : entry;
      var info = readJpegInfo(bytes);
      var box = layout(info.width, info.height, options, entry && entry.pxToPt);
      var colorSpace = info.components === 1 ? 'DeviceGray' : (info.components === 4 ? 'DeviceCMYK' : 'DeviceRGB');

      var pageId = 3 + i * 3;
      var contentId = pageId + 1;
      var imageId = pageId + 2;

      begin(pageId);
      put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(box.pageW) + ' ' + num(box.pageH) + '] ' +
        '/Resources << /XObject << /Im0 ' + imageId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>\n');
      end();

      var content = 'q ' + num(box.w) + ' 0 0 ' + num(box.h) + ' ' + num(box.x) + ' ' + num(box.y) + ' cm /Im0 Do Q\n';
      begin(contentId);
      put('<< /Length ' + content.length + ' >>\nstream\n');
      put(content);
      put('endstream\n');
      end();

      begin(imageId);
      put('<< /Type /XObject /Subtype /Image /Width ' + info.width + ' /Height ' + info.height +
        ' /ColorSpace /' + colorSpace + ' /BitsPerComponent 8 /Filter /DCTDecode' +
        (info.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '') +
        ' /Length ' + bytes.length + ' >>\nstream\n');
      put(bytes);
      put('\nendstream\n');
      end();
    }

    var created = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    begin(infoId);
    put('<< /Title ' + pdfText(options.title || 'Images') + ' /Producer (Leafpress) /CreationDate (D:' + created + 'Z) >>\n');
    end();

    var xrefPosition = offset;
    var size = infoId + 1;
    var xref = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
    for (var id = 1; id < size; id++) {
      xref += pad10(offsets[id]) + ' 00000 n \n';
    }
    put(xref);
    put('trailer\n<< /Size ' + size + ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + xrefPosition + '\n%%EOF\n');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  ns.pdf = { build: build, readJpegInfo: readJpegInfo, layout: layout, PAGE_SIZES: PAGE_SIZES };
})(typeof window !== 'undefined' ? window : globalThis);
