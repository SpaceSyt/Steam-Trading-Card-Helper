import test from "node:test";
import assert from "node:assert/strict";

import {
  getProcessingDecorationCategories,
  normalizeProcessingMode,
  processingModeIncludesCards,
  processingModeIncludesDecorations,
} from "../../src/services/processing-mode.js";

test("processing modes map to card and decoration pipelines", () => {
  assert.equal(normalizeProcessingMode("invalid"), "card");
  assert.equal(processingModeIncludesCards("all"), true);
  assert.equal(processingModeIncludesCards("card"), true);
  assert.equal(processingModeIncludesCards("decoration"), false);
  assert.equal(processingModeIncludesDecorations("all"), true);
  assert.equal(processingModeIncludesDecorations("card"), false);
  assert.deepEqual(getProcessingDecorationCategories("decoration"), ["background", "emoticon"]);
  assert.deepEqual(getProcessingDecorationCategories("background"), ["background"]);
  assert.deepEqual(getProcessingDecorationCategories("emoticon"), ["emoticon"]);
});
