/**
 * LifeQuest → Google Sheets sync.
 *
 * Paste this into your Sheet's Extensions → Apps Script editor, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 * Copy the web app URL into LifeQuest → Settings → Google Sheets.
 *
 * The app sends its data a few seconds after each change. This script:
 *   - rewrites the "Daily" and "Workouts" tabs (other tabs are never touched),
 *   - keeps a full backup in a hidden "_LifeQuest backup" tab so you can restore on a new phone.
 *
 * Anyone with the web app URL can write to these tabs, so keep the URL private.
 */

var BACKUP_SHEET = '_LifeQuest backup';
var CHUNK = 45000; // cells hold max 50,000 characters

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var written = {};
    var sheets = data.sheets || {};
    Object.keys(sheets).forEach(function (name) {
      if (name === BACKUP_SHEET) return;
      written[name] = writeTable_(ss, name, sheets[name].header, sheets[name].rows);
    });
    if (typeof data.backup === 'string' && data.backup.length) writeBackup_(ss, data.backup);
    return json_({ ok: true, at: new Date().toISOString(), rows: written });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (e && e.parameter && e.parameter.action === 'backup') {
    return json_({ ok: true, backup: readBackup_(ss) });
  }
  return json_({ ok: true, service: 'lifequest-sheets', sheet: ss.getName() });
}

function writeTable_(ss, name, header, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var width = header.length;
  var values = [header].concat(rows.map(function (r) {
    var row = r.slice(0, width);
    while (row.length < width) row.push('');
    return row;
  }));
  sh.clearContents();
  sh.getRange(1, 1, values.length, width).setValues(values);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.setFrozenRows(1);
  return rows.length;
}

function writeBackup_(ss, text) {
  var sh = ss.getSheetByName(BACKUP_SHEET) || ss.insertSheet(BACKUP_SHEET);
  var chunks = [];
  for (var i = 0; i < text.length; i += CHUNK) chunks.push([text.slice(i, i + CHUNK)]);
  sh.clearContents();
  sh.getRange(1, 1, chunks.length, 1).setNumberFormat('@').setValues(chunks);
  if (!sh.isSheetHidden()) sh.hideSheet();
}

function readBackup_(ss) {
  var sh = ss.getSheetByName(BACKUP_SHEET);
  if (!sh || sh.getLastRow() < 1) return '';
  return sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return r[0]; }).join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
