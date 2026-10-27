# smart-csv

[![tests](https://github.com/pchandrag/smart-csv/actions/workflows/tests.yml/badge.svg)](https://github.com/pchandrag/smart-csv/actions/workflows/tests.yml)

A small browser tool that combines and reshapes CSV files. Use it to:

- **merge** many CSV files (e.g. one per document: `F1.csv` … `F20.csv`) into one file, optionally with the file name as the first column, or
- **reshape** each file on its own: choose, order and rename columns, drop the rest, and save the results as separate files.

It was made to prepare inputs for the [Extraction accuracy calculator](https://github.com/pchandrag/accuracyeval): build its baseline file (file name in column 1) or tidy candidate files.

Everything runs in the page. Files are never uploaded.

## Running it

Open `smart-csv.html` in a browser (double-click it). Nothing to install, no build step, no internet needed.
It loads the IBM Plex fonts from Google Fonts when online and uses the system font otherwise.

## Using it

1. **Files.** Drop CSV files on the page or click to choose them. Comma, semicolon and tab separated files are
   detected from their first line. Adding a file with the same name as one already in the list replaces it.
   Files are always processed in natural name order, so `F2.csv` comes before `F10.csv`.
2. **Options.**
   - **First row is a header** (on by default). On: columns are matched **by header name** in every file, so the
     files may have their columns in different orders. Names are trimmed and case is ignored; a name repeated in one
     file becomes `name (2)`, `name (3)`; a blank one becomes `Column N`. Off: columns are matched **by position**
     (Column 1, Column 2, …).
   - **Include header row** (on by default). Written at the top of each output file, and once at the top of a
     combined file.
   - **Add file name as column 1** (off by default), **without extension** (`F1`) or **with extension**
     (`F1.csv`). Its header is `filename` unless you rename it.
3. **Columns.** Every column found in the files is listed in order of first appearance, with an example value. Tick
   the ones you want. Ticked columns appear in the output list, where you can
   - change their order with the ↑ and ↓ buttons,
   - give them a new output name (used in the header row),
   - remove them with ✕ (the same as unticking).

   If a file lacks a chosen column, its cells are left blank and a warning names the file and the column. Rows
   shorter than the header are padded with blanks.
4. **Preview.** The first 10 rows of the combined result.
5. **Download.**
   - **As one file**: all rows from all files. The file name defaults to `combined.csv`.
   - **As separate files**: one output for each input, named `<name><suffix>.csv`. The suffix defaults to `_out`
     (`F1.csv` → `F1_out.csv`); clear it to keep the same names. If two outputs would get the same name
     (`F1.csv` and `F1.tsv`), the second becomes `F1_out (2).csv`.

### How files are saved, by browser

| Browser | One file | Separate files |
| --- | --- | --- |
| Chrome, Edge (and other Chromium browsers) | A Save dialog: you pick the folder and name. | A folder picker: the files are written into the folder you pick. If any already exist there, you are asked before they are replaced. |
| Safari, Firefox | Downloaded to your Downloads folder. | Downloaded as one `smart-csv-files.zip` containing every file. |

The page checks which of these the browser supports. If Chrome or Edge refuses the dialogs (for example under a
company policy), it falls back to downloads and the .zip.

## Output format

- UTF-8 with a byte-order mark (so Excel opens accented characters correctly)
- comma separated, CRLF line endings
- a value is quoted only when it contains a comma, a double quote or a line break; quotes inside are doubled
- values are written exactly as read: no trimming, no number or date reformatting, leading zeros kept

The .zip uses no compression ("stored"), which every unzip tool can open.

## Limits

- Files are read into browser memory. Tens of MB in total is fine; very large files (hundreds of MB) may be slow
  or run out of memory.
- Input files should be UTF-8 (with or without a byte-order mark). Other encodings may show wrong characters.
- Not included, to keep it light: filtering rows, editing values, Excel files, remembering settings between visits.

## Tests

`tests/run-tests.js` checks the page's logic (the code between `// ==CORE START==` and `// ==CORE END==` in
`smart-csv.html`) against the files in `samples/` and targeted cases: delimiter detection and quoting, matching by
name and by position, repeated and blank header names, missing columns and short rows, column order and renaming,
the header and file-name options, combined and separate output, suffix naming, natural file order, the exact output
bytes, and a .zip that is checked with the standard `unzip` command.

```bash
node tests/run-tests.js
```

On a Mac without Node.js:

```bash
osascript -l JavaScript tests/run-tests.js
```

Add a path to test another copy of the page, e.g. `node tests/run-tests.js ~/Downloads/smart-csv.html`.
The tests run on every push and pull request in GitHub Actions (`.github/workflows/tests.yml`).

The sample files are compared byte for byte, so `.gitattributes` keeps git from changing their line endings.
