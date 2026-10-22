'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('private original Excel 144-month reference remains exact', () => {
  const root = path.resolve(__dirname, '../..');
  const fixture = JSON.parse(fs.readFileSync(process.env.NRCALC_PRIVATE_MONTHLY_FIXTURE || path.join(root, 'tests/fixtures/nrcalc-excel-monthly-loss.json'), 'utf8'));
  const scope = {}; scope.window = scope; vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(root, 'nrcalc.js'), 'utf8'), scope);
  const rows = scope.NRCalc.applyMonthlyLossOffset(fixture.rows.map(([period, profit]) => ({period, profit})), .25);
  const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= .00005001, label + ': ' + actual + ' != ' + expected);
  assert.equal(rows.length, 144);
  fixture.rows.forEach(([period, profit, makeup, taxable, incomeTax], i) => {
    close(rows[i].makeup, makeup, period + ' 补亏');
    close(rows[i].taxable, taxable, period + ' 计税基础');
    close(rows[i].incomeTax, incomeTax, period + ' 所得税');
    close(rows[i].netProfit, profit - rows[i].incomeTax, period + ' 净利润');
  });
  close(rows.slice(0, 12).reduce((sum, m) => sum + m.makeup, 0), 11.8851, '首年逐月补亏汇总');
  for (const [start, end] of [[0, 12], [12, 24], [0, 24]]) {
    const expected = fixture.rows.slice(start, end).reduce((sum, row) => sum + Math.round(row[2] * 1e4) / 1e4, 0);
    close(rows.slice(start, end).reduce((sum, m) => sum + m.makeup, 0), expected, '逐月四位小数汇总');
  }
});
