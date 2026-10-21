'use strict';

// Test-process-only workaround for Chromium issue 541310282 / WebView2 issue 5722.
// Some Windows Chromium/Edge builds probe LogonUser with an invalid password on
// each launch, locking CodexSandboxOffline after repeated browser tests.
// Do not disable Windows/Codex sandboxing or change account lockout policy.
const nrBrowserLockoutFeature = 'AutofillAiWalletPrivatePasses';

function nrBrowserLockoutOptions(options = {}) {
  const args = [...(options.args || [])];
  const disabled = new Set([nrBrowserLockoutFeature]);
  const preserved = [];
  for (const arg of args) {
    if (arg.startsWith('--disable-features=')) {
      for (const feature of arg.slice('--disable-features='.length).split(',')) {
        if (feature) disabled.add(feature);
      }
    } else {
      preserved.push(arg);
    }
  }
  return { ...options, args: [...preserved, `--disable-features=${[...disabled].join(',')}`] };
}

function nrInstallBrowserLockoutGuard(browserType, platform = process.platform) {
  if (platform !== 'win32' || browserType.__nrWindowsLockoutGuard) return false;
  for (const name of ['launch', 'launchPersistentContext']) {
    const original = browserType[name];
    if (name === 'launch') {
      browserType[name] = function (options) { return original.call(this, nrBrowserLockoutOptions(options)); };
    } else {
      browserType[name] = function (userDataDir, options) { return original.call(this, userDataDir, nrBrowserLockoutOptions(options)); };
    }
  }
  Object.defineProperty(browserType, '__nrWindowsLockoutGuard', { value: true });
  return true;
}

if (process.platform === 'win32') nrInstallBrowserLockoutGuard(require('playwright').chromium);
module.exports = { nrBrowserLockoutOptions, nrInstallBrowserLockoutGuard };
