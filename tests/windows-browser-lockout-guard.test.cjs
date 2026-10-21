'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nrBrowserLockoutOptions, nrInstallBrowserLockoutGuard } = require('../scripts/windows-browser-lockout-guard.cjs');

test('Windows browser workaround merges disabled features without mutating caller options', () => {
  const options = { channel: 'msedge', headless: true, args: ['--foo', '--disable-features=ExistingA,ExistingB', '--disable-features=ExistingB'] };
  const before = structuredClone(options);
  const result = nrBrowserLockoutOptions(options);
  assert.deepEqual(options, before);
  assert.equal(result.channel, 'msedge');
  assert.equal(result.headless, true);
  assert.deepEqual(result.args, ['--foo', '--disable-features=AutofillAiWalletPrivatePasses,ExistingA,ExistingB']);
  assert.ok(!result.args.includes('--no-sandbox'));
});

test('guard supports both launch paths, preserves receivers and installs only once', async () => {
  const calls = [];
  const browser = { launch(...args) { calls.push({receiver:this,args}); return 'browser'; }, launchPersistentContext(...args) { calls.push({receiver:this,args}); return 'context'; } };
  assert.equal(nrInstallBrowserLockoutGuard(browser, 'linux'), false);
  assert.equal(nrInstallBrowserLockoutGuard(browser, 'win32'), true);
  assert.equal(nrInstallBrowserLockoutGuard(browser, 'win32'), false);
  assert.equal(await browser.launch(), 'browser');
  assert.equal(await browser.launchPersistentContext('isolated-profile', { headless:false }), 'context');
  assert.equal(calls[0].receiver, browser);
  assert.deepEqual(calls[0].args[0].args, ['--disable-features=AutofillAiWalletPrivatePasses']);
  assert.equal(calls[1].args[0], 'isolated-profile');
  assert.equal(calls[1].args[1].headless, false);
  assert.equal(calls[1].args[1].args.length, 1);
});
