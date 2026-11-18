import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localizeSource, localizeStyles } from "../../scripts/localize.mjs";

const dictionary = JSON.parse(readFileSync(new URL("../../src/locales/en.json", import.meta.url), "utf8"));
const translate = key => {
  assert.ok(Object.hasOwn(dictionary, key), `Missing translation: ${key}`);
  return dictionary[key];
};

test("templates retain nested expressions, escaping and evaluation order", () => {
  const source = 'const result = `共 ${next()} 项：${ok ? `成功 ${next()}` : "失败"}`;';
  const values = { "共 {{0}} 项：{{1}}": "Total {{0}} items: {{1}}", "成功 {{0}}": "Success {{0}}", "失败": "Failed" };
  const translated = localizeSource(source, { translate: key => values[key] });
  let count = 0;
  assert.equal(Function("next", "ok", translated + "return result;")(() => ++count, true), "Total 1 items: Success 2");
  assert.equal(count, 2);
  const escaped = localizeSource('const result = `中文 ${value}`;', { translate: () => 'Quote ` \\ ${literal} {{0}}' });
  assert.equal(Function("value", escaped + "return result;")(7), 'Quote ` \\ ${literal} 7');
});

test("HTML translates visible text and accessible attributes, preserving data and values", () => {
  const source = 'const result = `<button data-key="中文" title="条件 > 1">确认</button><input placeholder="名称" aria-label="名称">`;';
  const values = { "条件 > 1": 'Value > 1, "quoted"', "确认": "Confirm", "名称": "Name" };
  const translated = localizeSource(source, { translate: key => values[key] });
  assert.equal(Function(translated + "return result;")(), '<button data-key="中文" title="Value > 1, &quot;quoted&quot;">Confirm</button><input placeholder="Name" aria-label="Name">');
});

test("parser regexes, comments, tagged templates and nonlocalized escapes are preserved", () => {
  const source = '// 中文\nconst regex = /普通卡牌|Trading Card/u; const tagged = String.raw`中文\\n`; const text = `{{0}}\\u0041`;';
  assert.equal(localizeSource(source), source);
  assert.throws(() => localizeSource('const text = `中文 {{0}}`'), /Reserved translation placeholder/);
});

test("lost or reordered placeholders fail the build", () => {
  const source = 'const value = `从 ${a()} 到 ${b()}`;';
  for (const value of ["Missing", "{{1}} then {{0}}", undefined]) {
    assert.throws(() => localizeSource(source, { translate: () => value, filename: "fixture.js" }), /placeholders changed at fixture.js:1/);
  }
});

test("English labels fit existing controls and inline totals retain word spacing", () => {
  const source = 'const result = `<span>共<b>${count}</b>件</span><select id="stch-buy-mode" style="width:110px"><option>购买单套</option></select>`;';
  const values = { "共": "Total", "件": "items", "购买单套": "Buy one set" };
  const translated = localizeSource(source, { translate: key => values[key] });
  assert.equal(Function("count", translated + "return result;")(2), '<span>Total <b>2</b> items</span><select id="stch-buy-mode" style="width:180px"><option>Buy one set</option></select>');
  const css = localizeStyles(readFileSync(new URL("../../src/ui/style.css", import.meta.url), "utf8"));
  assert.match(css, /grid-template-columns: 100px auto auto auto/);
  assert.match(css, /stch-auto-wall-anchor \{ width: 152px/);
});

test("English UI locales do not change wallet currency definitions or request values", async () => {
  const source = readFileSync(new URL("../../src/services/currency.js", import.meta.url), "utf8");
  assert.equal(localizeSource(source, { translate }), source);
  const { detectCurrencyContext, formatMoney } = await import("../../src/services/currency.js");
  const context = detectCurrencyContext({ walletInfo: { wallet_currency: 29 }, configuredCurrencyId: 23 });
  assert.equal(context.currencyId, 29);
  assert.equal(formatMoney(123, context), "HK$\u00a01.23");
  assert.equal(localizeSource('const value = new Date().toLocaleString("zh-CN");'), 'const value = new Date().toLocaleString("en-US");');
});

test("every source UI message has an English translation", () => {
  const root = fileURLToPath(new URL("../../src/", import.meta.url));
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".js")) localizeSource(readFileSync(path, "utf8"), { translate, filename: path });
    }
  }
  visit(root);
  for (const [key, value] of Object.entries(dictionary)) {
    assert.ok(value.trim(), `Empty translation: ${key}`);
    assert.doesNotMatch(value, /\p{Script=Han}/u, `Untranslated message: ${key}`);
  }
});
