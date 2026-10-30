/* Editable Excel report using the same columns, widths and row heights as barcode printing. */
var BC_XL_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
var BC_XL_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function bcXlEsc(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
  });
}
function bcXlCol(i) {
  var out = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) out = String.fromCharCode(65 + (i - 1) % 26) + out;
  return out;
}
function bcXlStyles(font) {
  function f(size, bold) { return '<font><sz val="' + size + '"/><name val="' + bcXlEsc(font) + '"/>' + (bold ? '<b/>' : '') + '<color rgb="FF000000"/></font>'; }
  function xf(fontId, fill, border, align, text) {
    return '<xf numFmtId="' + (text ? 49 : 0) + '" fontId="' + fontId + '" fillId="' + fill + '" borderId="' + border + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="' + align + '" vertical="center" wrapText="1"/></xf>';
  }
  var styles = [
    xf(0, 0, 0, 'left'), xf(2, 0, 0, 'center'), xf(3, 0, 0, 'left'), xf(2, 0, 0, 'left'), xf(1, 2, 1, 'center'),
    xf(0, 3, 1, 'center', true), xf(0, 0, 1, 'center', true), xf(0, 3, 1, 'left', true), xf(0, 0, 1, 'left', true),
    xf(0, 3, 1, 'center'), xf(0, 0, 1, 'center'), xf(0, 0, 1, 'center')
  ];
  return '<styleSheet xmlns="' + BC_XL_NS + '"><fonts count="4">' + f(10, false) + f(10, true) + f(14, true) + f(14, false) + '</fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD0D0D0"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFECECEC"/></patternFill></fill></fills>' +
    '<borders count="2"><border/><border>' + ['left', 'right', 'top', 'bottom'].map(function (side) { return '<' + side + ' style="thin"><color rgb="FF6F6F6F"/></' + side + '>'; }).join('') + '</border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + styles.length + '">' + styles.join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}
function bcXlSheet(report, printedAt, strings) {
  var cols = report.cols, n = cols.length, endCol = bcXlCol(n - 1), rows = [], merges = [], grouped = Object.create(null);
  var last = 6 + Math.max(1, report.rows.length);
  if (last + 2 > 1048576) throw new Error('รายการเกินจำนวนแถวที่ Excel รองรับ กรุณาส่งออกแบบแยกชีตตามหมวด');
  function cell(c, r, style, value, numeric) {
    var attrs = ' r="' + bcXlCol(c) + r + '" s="' + style + '"';
    if (value === '' || value == null) return '<c' + attrs + '/>';
    if (numeric && typeof value === 'number' && Number.isFinite(value)) return '<c' + attrs + '><v>' + value + '</v></c>';
    var text = String(value), index = strings.index.get(text);
    if (index === undefined) { index = strings.values.length; strings.index.set(text, index); strings.values.push(text); }
    strings.count++;
    return '<c' + attrs + ' t="s"><v>' + index + '</v></c>';
  }
  function row(r, cells, height) { rows.push('<row r="' + r + '" ht="' + Math.min(409, height).toFixed(2) + '" customHeight="1">' + cells.join('') + '</row>'); }
  function mergedRow(r, style, text, height) {
    merges.push('A' + r + ':' + endCol + r);
    row(r, [cell(0, r, style, text)], height);
  }
  mergedRow(1, 1, report.top.company, report.top.company ? 25.52 : 6);
  mergedRow(2, 2, report.top.hand, 22.68);
  mergedRow(3, 2, report.top.status, 22.68);
  mergedRow(4, 3, report.top.title, 28.35);
  var h1 = [], h2 = [];
  report.groups.forEach(function (g) {
    for (var i = g.from - 1; i < g.to; i++) grouped[i] = g;
    merges.push(bcXlCol(g.from - 1) + '5:' + bcXlCol(g.to - 1) + '5');
  });
  cols.forEach(function (col, i) {
    var g = grouped[i];
    var label = col.header || col.k.label;
    h1.push(cell(i, 5, 4, g ? (i === g.from - 1 ? g.label : '') : label));
    h2.push(cell(i, 6, 4, g ? label : ''));
    if (!g) merges.push(bcXlCol(i) + '5:' + bcXlCol(i) + '6');
  });
  row(5, h1, 22.68); row(6, h2, 39.69);
  if (!report.rows.length) {
    merges.push('A7:' + endCol + '7');
    row(7, cols.map(function (_, j) { return cell(j, 7, 11, j ? '' : 'ไม่มีรายการ'); }), 28.35);
  }
  report.rows.forEach(function (item, i) {
    row(i + 7, cols.map(function (col, j) {
      var numeric = !!col.k.num && col.k.k !== 'partner';
      var style = col.k.k === 'name' ? 7 : numeric ? 9 : 5;
      return cell(j, i + 7, style + (i % 2), item.v[j], numeric);
    }), item.height);
  });
  mergedRow(last + 2, 0, 'พิมพ์เมื่อ ' + printedAt, 18);
  return '<worksheet xmlns="' + BC_XL_NS + '"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + endCol + (last + 2) + '"/>' +
    '<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/>' +
    '<cols>' + cols.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(3, (c.w * 96 / 25.4 - 5) / 7).toFixed(2) + '" customWidth="1"/>'; }).join('') + '</cols>' +
    '<sheetData>' + rows.join('') + '</sheetData><mergeCells count="' + merges.length + '">' + merges.map(function (ref) { return '<mergeCell ref="' + ref + '"/>'; }).join('') + '</mergeCells>' +
    '<printOptions horizontalCentered="1"/><pageMargins left="0.08" right="0.08" top="0.08" bottom="0.25" header="0" footer="0.08"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' +
    '<headerFooter><oddFooter>' + bcXlEsc('&Lพิมพ์เมื่อ ' + printedAt + '&Rหน้า &P / &N') + '</oddFooter></headerFooter></worksheet>';
}
async function bcXlBuild(reports, options) {
  if (!reports.length) throw new Error('ไม่มีหมวดสำหรับส่งออก');
  options = options || {};
  var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', files = [], types = '', sheets = '', rels = '', names = '', used = Object.create(null);
  var strings = { index: new Map(), values: [], count: 0 };
  reports.forEach(function (report, i) {
    var base = String(report.name || 'บาร์สินค้า').replace(/[\\/?*\[\]:\u0000-\u001F]/g, '_').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'บาร์สินค้า';
    var name = base, seq = 2;
    while (used[name.toLowerCase()]) { var suffix = '_' + seq++; name = base.slice(0, 31 - suffix.length) + suffix; }
    used[name.toLowerCase()] = true;
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: xml + bcXlSheet(report, options.printedAt || '', strings) });
    types += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    sheets += '<sheet name="' + bcXlEsc(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    rels += '<Relationship Id="rId' + (i + 1) + '" Type="' + BC_XL_REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    var quoted = "'" + name.replace(/'/g, "''") + "'!";
    names += '<definedName name="_xlnm.Print_Area" localSheetId="' + i + '">' + bcXlEsc(quoted + '$A$1:$' + bcXlCol(report.cols.length - 1) + '$' + (6 + Math.max(1, report.rows.length))) + '</definedName>' +
      '<definedName name="_xlnm.Print_Titles" localSheetId="' + i + '">' + bcXlEsc(quoted + '$5:$6') + '</definedName>';
  });
  rels += '<Relationship Id="rId' + (reports.length + 1) + '" Type="' + BC_XL_REL + '/styles" Target="styles.xml"/>';
  rels += '<Relationship Id="rId' + (reports.length + 2) + '" Type="' + BC_XL_REL + '/sharedStrings" Target="sharedStrings.xml"/>';
  files.push(
    { name: '[Content_Types].xml', data: xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + types + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
    { name: '_rels/.rels', data: xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + BC_XL_REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: xml + '<workbook xmlns="' + BC_XL_NS + '" xmlns:r="' + BC_XL_REL + '"><bookViews><workbookView/></bookViews><sheets>' + sheets + '</sheets><definedNames>' + names + '</definedNames></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>' },
    { name: 'xl/styles.xml', data: xml + bcXlStyles(options.font || 'Sarabun') },
    { name: 'xl/sharedStrings.xml', data: xml + '<sst xmlns="' + BC_XL_NS + '" count="' + strings.count + '" uniqueCount="' + strings.values.length + '">' + strings.values.map(function (text) { return '<si><t xml:space="preserve">' + bcXlEsc(text) + '</t></si>'; }).join('') + '</sst>' }
  );
  return bcXlZip(files);
}
function bcXlDownload(bytes, name) {
  var url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  var a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
}

var BC_XL_CRCT = null;
function bcXlCrc(u8) {
  if (!BC_XL_CRCT) {
    BC_XL_CRCT = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      BC_XL_CRCT[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < u8.length; i++) crc = BC_XL_CRCT[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
async function bcXlDeflate(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    var cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
    var result = new Response(cs.readable).arrayBuffer();
    await w.write(u8); await w.close();
    return new Uint8Array(await result);
  } catch (e) { return null; }
}
async function bcXlZip(files) {
  var enc = new TextEncoder(), now = new Date();
  var dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  var ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  var out = [], cen = [], off = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i], raw = enc.encode(f.data), name = enc.encode(f.name), crc = bcXlCrc(raw);
    var comp = await bcXlDeflate(raw), body = comp || raw, method = comp ? 8 : 0;
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, dtime, true); lh.setUint16(12, ddate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, dtime, true); ch.setUint16(14, ddate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    out.push(new Uint8Array(lh.buffer), name, body);
    cen.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + body.length;
  }
  var csize = cen.reduce(function (s, p) { return s + p.length; }, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  var all = out.concat(cen, [new Uint8Array(end.buffer)]), total = all.reduce(function (s, p) { return s + p.length; }, 0);
  var buf = new Uint8Array(total), pos = 0;
  all.forEach(function (p) { buf.set(p, pos); pos += p.length; });
  return buf;
}



