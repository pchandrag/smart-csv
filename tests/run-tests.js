// Regression tests for smart-csv.html. Run from anywhere:
//   node tests/run-tests.js                        (any computer with Node.js)
//   osascript -l JavaScript tests/run-tests.js     (macOS, nothing to install)
// Add a path to test another copy of the app:  node tests/run-tests.js path/to/smart-csv.html
//
// The tests load the code between the ==CORE START== and ==CORE END== markers in the app and check it against
// the files in samples/ and targeted cases. The zip test writes a file to the temporary folder and checks it
// with the standard unzip command. The page itself (buttons, pickers) is not tested here.
'use strict';

// ---------- environment: Node.js or macOS JavaScript for Automation ----------
const IS_NODE = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
let ROOT, readText, appArg, writeBytes, shell, tmpDir;
if (IS_NODE) {
  const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
  ROOT = path.resolve(__dirname, '..');
  readText = p => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8');
  appArg = process.argv[2] && path.resolve(process.argv[2]);
  writeBytes = (p, bytes) => fs.writeFileSync(p, Buffer.from(bytes));
  shell = cmd => cp.execSync(cmd, { encoding: 'utf8' });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-csv-'));
} else {
  ObjC.import('Foundation');
  const fm = $.NSFileManager.defaultManager;
  const cwd = ObjC.unwrap(fm.currentDirectoryPath);
  const abs = p => (p.charAt(0) === '/' ? p : cwd + '/' + p);
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
  const at = args.findIndex(a => /run-tests\.js$/.test(a));
  ROOT = abs(args[at]).replace(/\/[^/]*\/[^/]*$/, ''); // .../tests/run-tests.js -> repository root
  readText = p => {
    const s = $.NSString.stringWithContentsOfFileEncodingError(p.charAt(0) === '/' ? p : ROOT + '/' + p, $.NSUTF8StringEncoding, null);
    if (s.isNil()) throw new Error('cannot read ' + p);
    return ObjC.unwrap(s);
  };
  appArg = args[at + 1] && abs(args[at + 1]);
  writeBytes = (p, bytes) => {
    const data = $.NSData.alloc.initWithBase64EncodedStringOptions(base64(bytes), 0);
    if (!data.writeToFileAtomically(p, true)) throw new Error('cannot write ' + p);
  };
  const sa = Application.currentApplication();
  sa.includeStandardAdditions = true;
  // A failing command, or output that is not valid text, would crash osascript itself: keep the exit status at 0,
  // fold errors into the output and keep only printable ASCII. The tests then fail on the output.
  shell = cmd => sa.doShellScript('{ ' + cmd + "; } 2>&1 | LC_ALL=C tr -cd '\\11\\12\\40-\\176'; true").replace(/\r/g, '\n') + '\n';
  tmpDir = shell('mktemp -d -t smart-csv').trim();
}
function base64(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += A[n >> 18] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? A[n & 63] : '=');
  }
  return s;
}

// ---------- load the app's core code ----------
const APP_PATH = appArg || 'smart-csv.html';
const html = readText(APP_PATH);
const coreStart = html.indexOf('// ==CORE START=='), coreEnd = html.indexOf('// ==CORE END==');
if (coreStart < 0 || coreEnd < 0) throw new Error('CORE markers not found in ' + APP_PATH);
const app = new Function(html.slice(coreStart, coreEnd) +
  '\nreturn { detectDelimiter, parseCSV, columnIds, toCsv, naturalSort, baseName, fileLabel, outputNames, allColumns, buildOutput, csvText, utf8Encode, crc32, makeZip };')();

// ---------- tiny test framework ----------
const results = [];
function test(name, fn) {
  const problems = [];
  try { fn(problems); } catch (e) { problems.push('threw: ' + (e && e.message)); }
  results.push({ name, problems });
}
const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);
function expect(problems, got, want, what) {
  if (!same(got, want)) problems.push((what ? what + ': ' : '') + 'expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(got));
}

// ---------- helpers ----------
const file = (name, text) => ({ name, rows: app.parseCSV(text) });
const sampleFile = p => file(p.replace(/.*\//, ''), readText('samples/' + p));
const SAMPLES = ['F10.csv', 'F1.csv', 'F2.csv'].map(sampleFile); // deliberately out of order
// (Not called run: osascript would treat a function named run as the script's entry point.)
// Every column found, ticked in order, output name = input label, unless cols says otherwise.
function combine(files, o) {
  o = o || {};
  const hasHeader = o.hasHeader !== false;
  const found = app.allColumns(files, hasHeader);
  const cols = o.cols ? o.cols.map(c => {
    const f = found.find(x => x.id === (typeof c === 'string' ? c : c.id));
    if (!f) throw new Error('no column ' + JSON.stringify(c));
    return { id: f.id, label: f.label, name: typeof c === 'string' ? f.label : c.name };
  }) : found.map(f => ({ id: f.id, label: f.label, name: f.label }));
  return app.buildOutput({
    files, hasHeader, includeHeader: o.includeHeader !== false, columns: cols,
    fileColumn: o.fileColumn || null, suffix: o.suffix == null ? '_out' : o.suffix, limit: o.limit
  });
}
const warn = out => out.warnings.map(w => w.file + ':' + w.column);

// ---------- parsing ----------
test('delimiter detection: comma, semicolon, tab; delimiters inside quotes ignored', p => {
  expect(p, app.detectDelimiter('a,b,c\n1;2;3;4'), ',', 'comma');
  expect(p, app.detectDelimiter('a;b;c\n1,2'), ';', 'semicolon');
  expect(p, app.detectDelimiter('a\tb\tc'), '\t', 'tab');
  expect(p, app.detectDelimiter('"x;y;z";a,b'), ',', 'quoted semicolons');
  expect(p, app.detectDelimiter('single'), ',', 'one column');
});

test('parsing: quotes, doubled quotes, line breaks in quotes, BOM, blank rows', p => {
  expect(p, app.parseCSV('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n  ,  \r\n"two\nlines",z'),
    [['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']]);
  expect(p, app.parseCSV('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']], 'semicolon file keeps commas');
  expect(p, app.parseCSV(' a , b \n'), [[' a ', ' b ']], 'values keep their spaces');
});

test('sample files parse with their own delimiters', p => {
  const [f10, f1, f2] = SAMPLES;
  expect(p, f1.rows[1], ['1001', 'Acme, Inc.', '162.50', '2024-06-10'], 'F1 comma');
  expect(p, f2.rows, [['Amount', 'ID', 'Name', 'Note'], ['12,5', '2001', 'Globex', 'two\nlines'], ['', '2002', 'Initech', '']], 'F2 semicolon + BOM');
  expect(p, f10.rows, [['name', 'id', 'amount', 'date'], ['Umbrella', '3001', '99', '2024-07-01'], ['Wayne', '3002']], 'F10 tab');
});

// ---------- columns ----------
test('header names: trimmed, case ignored, repeated -> "name (2)", blank -> "Column N"', p => {
  expect(p, app.columnIds([[' Name ', 'name', '', 'NAME', 'x']], true).map(c => c.id + '|' + c.label),
    ['name|Name', 'name (2)|name (2)', 'column 3|Column 3', 'name (3)|NAME (3)', 'x|x']);
  expect(p, app.columnIds([['a', 'b'], ['1', '2', '3']], false).map(c => c.id + '|' + c.label),
    ['#0|Column 1', '#1|Column 2', '#2|Column 3'], 'by position, widest row');
});

test('all columns: order of first appearance in natural file order, with example values', p => {
  expect(p, app.allColumns(SAMPLES, true).map(c => c.label + '=' + c.example),
    ['id=1001', 'name=Acme, Inc.', 'amount=162.50', 'date=2024-06-10', 'Note=two\nlines']);
  // an example blank in the first file is taken from a later one
  expect(p, app.allColumns([file('a.csv', 'x,y\n,1'), file('b.csv', 'x\n7')], true).map(c => c.example), ['7', '1']);
});

// ---------- combining ----------
test('matching by name across different column orders and delimiters', p => {
  const out = combine(SAMPLES);
  expect(p, out.combined, [
    ['id', 'name', 'amount', 'date', 'Note'],
    ['1001', 'Acme, Inc.', '162.50', '2024-06-10', ''],
    ['1002', 'Say "hi"', '7', '2024-06-11', ''],
    ['2001', 'Globex', '12,5', '', 'two\nlines'],
    ['2002', 'Initech', '', '', ''],
    ['3001', 'Umbrella', '99', '2024-07-01', ''],
    ['3002', 'Wayne', '', '', '']
  ]);
});

test('missing columns: blank cells plus a warning naming the file and column', p => {
  expect(p, warn(combine(SAMPLES)), ['F1.csv:Note', 'F2.csv:date', 'F10.csv:Note']);
  expect(p, warn(combine([file('e.csv', 'a,b\n')], {})), ['e.csv:null'], 'a file with a header only has no data rows');
});

test('values are copied exactly: spaces, zeros and quotes kept', p => {
  const out = combine([file('v.csv', 'a,b,c\n x ,007,"  ""q"" "')]);
  expect(p, out.combined[1], [' x ', '007', '  "q" ']);
});

test('short rows are padded with blanks', p => {
  const out = combine([file('s.csv', 'a,b,c\n1\n1,2')]);
  expect(p, out.combined.slice(1), [['1', '', ''], ['1', '2', '']]);
  expect(p, out.warnings, [], 'no warning when the column exists');
});

test('matching by position when there is no header row', p => {
  const files = [sampleFile('no-header/P2.csv'), sampleFile('no-header/P1.csv')];
  const out = combine(files, { hasHeader: false });
  expect(p, out.combined, [['Column 1', 'Column 2', 'Column 3'], ['A1', 'B1', 'C1'], ['A2', 'B2', 'C2'], ['X1', 'Y1', '']]);
  expect(p, warn(out), ['P2.csv:Column 3']);
  const picked = combine(files, { hasHeader: false, cols: [{ id: '#2', name: 'third' }, { id: '#0', name: 'first' }] });
  expect(p, picked.combined[0], ['third', 'first'], 'renamed header');
  expect(p, picked.combined[1], ['C1', 'A1'], 'reordered');
});

test('output column order, renaming and unticked columns', p => {
  const out = combine(SAMPLES, { cols: [{ id: 'amount', name: 'Total' }, 'id'] });
  expect(p, out.combined.slice(0, 3), [['Total', 'id'], ['162.50', '1001'], ['7', '1002']]);
  expect(p, out.warnings, [], 'unticked missing columns do not warn');
  expect(p, out.combined.every(r => r.length === 2), true, 'unticked columns left out');
});

test('repeated header names are separate columns', p => {
  const out = combine([file('d.csv', 'x,X,,y\n1,2,3,4'), file('e.csv', 'X,x\n5,6')]);
  expect(p, out.combined, [['x', 'X (2)', 'Column 3', 'y'], ['1', '2', '3', '4'], ['5', '6', '', '']]);
});

test('header row on and off', p => {
  const on = combine(SAMPLES, { cols: ['id'] }), off = combine(SAMPLES, { cols: ['id'], includeHeader: false });
  expect(p, on.combined.map(r => r[0]), ['id', '1001', '1002', '2001', '2002', '3001', '3002'], 'combined: header once');
  expect(p, off.combined.map(r => r[0]), ['1001', '1002', '2001', '2002', '3001', '3002'], 'combined: no header');
  expect(p, on.separate.map(s => s.rows.map(r => r[0]).join(' ')), ['id 1001 1002', 'id 2001 2002', 'id 3001 3002'], 'separate: header in each');
  expect(p, off.separate.map(s => s.rows.length), [2, 2, 2], 'separate: no header');
});

test('file name column with and without extension, renamable, always first', p => {
  const plain = combine(SAMPLES, { cols: ['id'], fileColumn: { name: 'filename', withExt: false } });
  expect(p, plain.combined.map(r => r.join('|')), ['filename|id', 'F1|1001', 'F1|1002', 'F2|2001', 'F2|2002', 'F10|3001', 'F10|3002']);
  const ext = combine(SAMPLES, { cols: ['id'], fileColumn: { name: 'source', withExt: true }, includeHeader: false });
  expect(p, ext.combined.map(r => r[0]), ['F1.csv', 'F1.csv', 'F2.csv', 'F2.csv', 'F10.csv', 'F10.csv']);
  expect(p, ext.separate[2].rows, [['F10.csv', '3001'], ['F10.csv', '3002']], 'separate files get it too');
  expect(p, app.fileLabel('a.b.csv', false), 'a.b', 'only the last extension is removed');
});

test('combined vs separate output', p => {
  const out = combine(SAMPLES);
  expect(p, out.separate.map(s => s.name + '>' + s.outName + ':' + s.rows.length), ['F1.csv>F1_out.csv:3', 'F2.csv>F2_out.csv:3', 'F10.csv>F10_out.csv:3']);
  expect(p, out.combined.filter(r => r[0] === 'id').length, 1, 'combined header written once');
  expect(p, out.separate.reduce((s, f) => s + f.rows.length - 1, 0), out.combined.length - 1, 'same data rows');
});

test('suffix naming: default, custom, cleared, collisions, unsafe characters', p => {
  const fs = [{ name: 'F1.csv' }, { name: 'data.tsv' }, { name: 'data.csv' }, { name: 'noext' }];
  expect(p, app.outputNames(fs, '_out'), ['F1_out.csv', 'data_out.csv', 'data_out (2).csv', 'noext_out.csv']);
  expect(p, app.outputNames(fs, ''), ['F1.csv', 'data.csv', 'data (2).csv', 'noext.csv'], 'cleared suffix keeps the name');
  expect(p, app.outputNames([{ name: 'F1.csv' }], '-v2'), ['F1-v2.csv']);
  expect(p, app.outputNames([{ name: 'F1.csv' }], '/x:y'), ['F1_x_y.csv'], 'no path separators');
  expect(p, combine(SAMPLES, { suffix: '_clean' }).separate.map(s => s.outName), ['F1_clean.csv', 'F2_clean.csv', 'F10_clean.csv']);
});

test('natural file order', p => {
  const names = ['F10.csv', 'f3.csv', 'F2.csv', 'F1.csv', 'F21.csv', 'b.csv', 'A.csv'];
  expect(p, app.naturalSort(names.map(name => ({ name }))).map(f => f.name), ['A.csv', 'b.csv', 'F1.csv', 'F2.csv', 'f3.csv', 'F10.csv', 'F21.csv']);
});

test('preview limit keeps only the first rows', p => {
  const out = combine(SAMPLES, { limit: 3 });
  expect(p, out.combined.length, 4, 'header + 3');
  expect(p, out.combined[3][0], '2001');
  expect(p, out.warnings.length, 3, 'warnings still cover every file');
});

// ---------- output bytes ----------
test('exact CSV text: BOM, CRLF, quoting only when needed, values unchanged', p => {
  const out = combine(SAMPLES, { cols: ['id', 'name', 'amount', 'note'] });
  expect(p, app.csvText(out.combined),
    '\uFEFFid,name,amount,Note\r\n1001,"Acme, Inc.",162.50,\r\n1002,"Say ""hi""",7,\r\n2001,Globex,"12,5","two\nlines"\r\n' +
    '2002,Initech,,\r\n3001,Umbrella,99,\r\n3002,Wayne,,\r\n');
  expect(p, app.csvText([[' a ', '007', 'x\ry', '']]), '\uFEFF a ,007,"x\ry",\r\n', 'spaces and zeros kept');
  expect(p, app.csvText([]), '\uFEFF', 'empty output');
});

test('UTF-8 bytes, with BOM', p => {
  expect(p, Array.from(app.utf8Encode(app.csvText([['é', '€', '😀']]))),
    [0xEF, 0xBB, 0xBF, 0xC3, 0xA9, 0x2C, 0xE2, 0x82, 0xAC, 0x2C, 0xF0, 0x9F, 0x98, 0x80, 0x0D, 0x0A]);
});

test('CRC-32 check value', p => {
  expect(p, app.crc32(app.utf8Encode('123456789')).toString(16), 'cbf43926');
  expect(p, app.crc32(new Uint8Array(0)), 0, 'empty');
});

test('zip: standard unzip extracts every file unchanged', p => {
  const out = combine(SAMPLES, { fileColumn: { name: 'filename', withExt: false } });
  const entries = out.separate.map(s => ({ name: s.outName, data: app.utf8Encode(app.csvText(s.rows)) }));
  entries.push({ name: 'empty.csv', data: new Uint8Array(0) });
  const zipPath = tmpDir + '/test.zip', dir = tmpDir + '/x';
  writeBytes(zipPath, app.makeZip(entries, new Date(2024, 5, 10, 9, 30, 0)));
  const check = shell("unzip -tq '" + zipPath + "'");
  if (!/No errors detected/.test(check)) p.push('unzip -t: ' + check);
  shell("mkdir '" + dir + "' && cd '" + dir + "' && unzip -qq '" + zipPath + "'");
  entries.forEach(e => {
    const got = shell("cd '" + dir + "' && od -An -tx1 '" + e.name + "' | tr -d ' \\n'").trim();
    const want = Array.from(e.data).map(b => (b < 16 ? '0' : '') + b.toString(16)).join('');
    if (got !== want) p.push(e.name + ': extracted bytes differ');
  });
  const date = shell("unzip -l '" + zipPath + "' | sed -n 4p");
  if (!/(2024-06-10|06-10-2024|06-10-24).*09:30/.test(date)) p.push('date not kept: ' + date.trim());
});

test('zip: non-ASCII file names are stored as flagged UTF-8', p => {
  // The unzip that ships with macOS ignores the UTF-8 flag, so the name is checked in the bytes; the archive must
  // still pass unzip -t.
  const zip = app.makeZip([{ name: 'Ünïcode é.csv', data: app.utf8Encode('ok') }]);
  const nameLen = zip[26] | (zip[27] << 8), flags = zip[6] | (zip[7] << 8);
  expect(p, flags & 0x0800, 0x0800, 'UTF-8 flag');
  expect(p, Array.from(zip.slice(30, 30 + nameLen)), Array.from(app.utf8Encode('Ünïcode é.csv')), 'name bytes');
  const zipPath = tmpDir + '/names.zip';
  writeBytes(zipPath, zip);
  if (!/No errors detected/.test(shell("unzip -tq '" + zipPath + "'"))) p.push('unzip -t failed');
});

// ---------- report ----------
if (IS_NODE) require('fs').rmSync(tmpDir, { recursive: true, force: true }); else shell("rm -rf '" + tmpDir + "'");
const failed = results.filter(r => r.problems.length);
const report = results.map(r => (r.problems.length ? 'FAIL  ' : 'pass  ') + r.name + r.problems.map(x => '\n        ' + x).join('')).join('\n') +
  '\n\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed (' + APP_PATH + ')';
if (IS_NODE) {
  console.log(report);
  if (failed.length) process.exitCode = 1;
} else if (failed.length) {
  throw new Error('\n' + report);
}
report; // osascript prints the value of the last expression
