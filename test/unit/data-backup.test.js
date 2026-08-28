import test from "node:test";
import assert from "node:assert/strict";

import {
  DATA_BACKUP_FORMAT,
  DATA_BACKUP_STORAGE_KEYS,
  createDataBackup,
  getDataBackupFileName,
  parseDataBackup,
  restoreDataBackup,
  serializeDataBackup,
} from "../../src/services/data-backup.js";

test("backup exports every durable script value and excludes transient multibuy data", () => {
  const values = new Map(DATA_BACKUP_STORAGE_KEYS.map(key => [key, `${key}-value`]));
  values.set("stch_multibuy_data", "temporary");
  const backup = createDataBackup((key, fallback) => values.get(key) ?? fallback, 0);

  assert.equal(backup.format, DATA_BACKUP_FORMAT);
  assert.deepEqual(Object.keys(backup.storage), [...DATA_BACKUP_STORAGE_KEYS]);
  assert.equal(Object.hasOwn(backup.storage, "stch_multibuy_data"), false);
  assert.deepEqual(parseDataBackup(serializeDataBackup(backup)), backup);
});

test("backup parser rejects malformed JSON, unknown formats, and unknown storage keys", () => {
  assert.throws(() => parseDataBackup("{"), /有效 JSON/);
  assert.throws(() => parseDataBackup({ format: "other", storage: {} }), /受支持/);
  assert.throws(() => parseDataBackup({
    format: DATA_BACKUP_FORMAT,
    backupVersion: 1,
    storage: { unexpected: true },
  }), /未知数据项/);
});

test("restore writes only validated values and rolls back completed writes after failure", () => {
  const values = new Map([
    ["stch_config", "old-config"],
    ["stch_order_cache", "old-cache"],
  ]);
  const backup = {
    format: DATA_BACKUP_FORMAT,
    backupVersion: 1,
    exportedAt: "2026-08-28T00:00:00.000Z",
    storage: {
      stch_config: "new-config",
      stch_order_cache: "new-cache",
    },
  };

  assert.throws(() => restoreDataBackup(backup, {
    getValue: (key, fallback) => values.get(key) ?? fallback,
    setValue: (key, value) => {
      if (key === "stch_order_cache" && value === "new-cache") throw new Error("disk full");
      values.set(key, value);
    },
  }), /已尝试恢复原数据/);
  assert.equal(values.get("stch_config"), "old-config");
  assert.equal(values.get("stch_order_cache"), "old-cache");
});

test("backup file name is portable and timestamped", () => {
  assert.equal(
    getDataBackupFileName(Date.UTC(2026, 7, 28, 12, 34, 56)),
    "steam-card-helper-backup-2026-08-28T12-34-56-000Z.json"
  );
});
