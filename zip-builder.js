/* ==========================================================================
   Leafpress: ZIP builder
   Creates a standard .zip file in the browser with no libraries.
   Files are stored without extra compression, which is right for images
   and PDFs because they are already compressed.

   Usage:
     var blob = Leafpress.zip.build([{ name: 'a.jpg', bytes: uint8Array }, ...]);
   ========================================================================== */
(function (global) {
  'use strict';

  var ns = (global.Leafpress = global.Leafpress || {});

  var crcTable = (function () {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) { crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8); }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function build(files) {
    var encoder = new TextEncoder();
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    var chunks = [];
    var central = [];
    var offset = 0;
    var centralSize = 0;

    files.forEach(function (file) {
      var nameBytes = encoder.encode(file.name);
      var size = file.bytes.length;
      var crc = crc32(file.bytes);

      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);      // file names are UTF-8
      local.setUint16(8, 0, true);           // stored, not compressed
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, file.bytes);

      var entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, dosTime, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, size, true);
      entry.setUint32(24, size, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);

      centralSize += 46 + nameBytes.length;
      offset += 30 + nameBytes.length + size;
    });

    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  ns.zip = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
