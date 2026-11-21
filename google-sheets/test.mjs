// Tests for the Apps Script (Code.gs) against a fake Google Sheets runtime.  Run: node google-sheets/test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fakeSheets() {
  const sheets = new Map();
  const mkSheet = (name) => {
    const sh = {
      name, cells: [], hidden: false, frozen: 0, bold: false,
      clearContents() { this.cells = []; },
      getRange(r, c, nr, nc) {
        return {
          setValues: (vals) => { assert.equal(vals.length, nr); vals.forEach((row, i) => { assert.equal(row.length, nc); sh.cells[r - 1 + i] = row.slice(); }); return this; },
          getValues: () => sh.cells.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
          setFontWeight: () => { sh.bold = true; return { setValues() {} }; },
          setNumberFormat() { return this; },
        };
      },
      getLastRow() { return this.cells.length; },
      setFrozenRows(n) { this.frozen = n; },
      isSheetHidden() { return this.hidden; },
      hideSheet() { this.hidden = true; },
    };
    return sh;
  };
  const ss = {
    getName: () => 'My LifeQuest',
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const sh = mkSheet(n); sheets.set(n, sh); return sh; },
  };
  return { ss, sheets };
}

const { ss, sheets } = fakeSheets();
const plain = (x) => JSON.parse(JSON.stringify(x));
let locked = 0;
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  LockService: { getScriptLock: () => ({ waitLock: () => locked++, releaseLock: () => locked-- }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
};
vm.runInNewContext(readFileSync(new URL('./Code.gs', import.meta.url), 'utf8'), ctx);
const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).text);
const get = (params) => JSON.parse(ctx.doGet({ parameter: params }).text);

// Health check identifies the script
assert.deepEqual(get({}), { ok: true, service: 'lifequest-sheets', sheet: 'My LifeQuest' });

// Writes tables, pads short rows, freezes header
const big = 'x'.repeat(120000) + '{"end":true}';
let r = post({
  sheets: {
    Daily: { header: ['Date', 'Steps', 'Lunch'], rows: [['2026-11-21', 9000, 'Salad'], ['2026-11-20', 7000]] },
    Workouts: { header: ['Date', 'Exercise', 'Set', 'Weight'], rows: [['2026-11-21', 'Squat', 1, 185]] },
  },
  backup: big,
});
assert.equal(r.ok, true);
assert.deepEqual(r.rows, { Daily: 2, Workouts: 1 });
assert.deepEqual(plain(sheets.get('Daily').cells), [['Date', 'Steps', 'Lunch'], ['2026-11-21', 9000, 'Salad'], ['2026-11-20', 7000, '']]);
assert.equal(sheets.get('Daily').frozen, 1);
assert.equal(locked, 0, 'lock released');

// Backup is chunked under the 50k cell limit, hidden, and round-trips exactly
const bk = sheets.get('_LifeQuest backup');
assert.equal(bk.hidden, true);
assert.ok(bk.cells.every(([c]) => c.length <= 45000));
assert.equal(get({ action: 'backup' }).backup, big);

// A rewrite replaces old rows (fewer rows than before)
post({ sheets: { Daily: { header: ['Date', 'Steps'], rows: [['2026-11-21', 9500]] } } });
assert.deepEqual(plain(sheets.get('Daily').cells), [['Date', 'Steps'], ['2026-11-21', 9500]]);
assert.equal(get({ action: 'backup' }).backup, big, 'backup kept when not sent');

// The backup tab can't be overwritten as a table; bad JSON reports an error
post({ sheets: { '_LifeQuest backup': { header: ['x'], rows: [] } } });
assert.equal(get({ action: 'backup' }).backup, big);
assert.equal(JSON.parse(ctx.doPost({ postData: { contents: 'nope' } }).text).ok, false);
assert.equal(locked, 0);

console.log('All Google Sheets script tests passed ✓');
