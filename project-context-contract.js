(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectContextContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const VERSION_KEYS = Object.freeze([
    'projectFacts',
    'financialParameters',
    'financialResults',
    'evidence',
    'rules',
    'tableTemplate',
    'reportTemplate',
    'report'
  ]);

  const SHA256_CONSTANTS = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function asString(value) {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  function uniqueSortedStrings(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(asString).filter(Boolean))).sort();
  }

  function normalizeVersion(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'object') {
      return asString(value.version || value.versionId || value.id || value.hash);
    }
    return asString(value);
  }

  function normalize(input) {
    const source = input && typeof input === 'object' ? input : {};
    const identity = source.identity && typeof source.identity === 'object' ? source.identity : {};
    const scenario = source.scenario && typeof source.scenario === 'object' ? source.scenario : {};
    const focus = source.focus && typeof source.focus === 'object' ? source.focus : {};
    const governance = source.governance && typeof source.governance === 'object' ? source.governance : {};
    const sourceVersions = source.versions && typeof source.versions === 'object' ? source.versions : {};
    const versions = {};

    VERSION_KEYS.forEach(function (key) {
      versions[key] = normalizeVersion(sourceVersions[key]);
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: asString(source.createdAt || source.created_at),
      createdBy: asString(source.createdBy || source.created_by),
      identity: {
        projectId: asString(identity.projectId || identity.project_id || source.projectId || source.project_id),
        organizationId: asString(identity.organizationId || identity.organization_id || source.organizationId || source.organization_id),
        userId: asString(identity.userId || identity.user_id || source.userId || source.user_id),
        role: asString(identity.role || source.role)
      },
      scenario: {
        projectType: asString(scenario.projectType || scenario.project_type || source.projectType || source.project_type),
        businessScenario: asString(scenario.businessScenario || scenario.business_scenario || source.businessScenario || source.business_scenario)
      },
      versions: versions,
      focus: {
        chapterId: asString(focus.chapterId || focus.chapter_id || source.chapterId || source.chapter_id),
        tableId: asString(focus.tableId || focus.table_id || source.tableId || source.table_id),
        metricId: asString(focus.metricId || focus.metric_id || source.metricId || source.metric_id)
      },
      governance: {
        pendingConfirmations: uniqueSortedStrings(governance.pendingConfirmations || governance.pending_confirmations || source.pendingConfirmations || source.pending_confirmations),
        approvalStatus: asString(governance.approvalStatus || governance.approval_status || source.approvalStatus || source.approval_status),
        permissions: uniqueSortedStrings(governance.permissions || source.permissions)
      }
    };
  }

  function validatePayload(payload) {
    const errors = [];
    const warnings = [];
    if (!payload.identity.projectId) errors.push('identity.projectId is required');
    if (!payload.createdAt) errors.push('createdAt is required');
    if (!payload.createdBy) errors.push('createdBy is required');
    VERSION_KEYS.forEach(function (key) {
      if (!payload.versions[key]) warnings.push('versions.' + key + ' is not pinned');
    });
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }

  function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);

    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const words = new Uint32Array(64);

    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, false);
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3);
        const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10);
        words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
      }

      let a = hash[0];
      let b = hash[1];
      let c = hash[2];
      let d = hash[3];
      let e = hash[4];
      let f = hash[5];
      let g = hash[6];
      let h = hash[7];

      for (let i = 0; i < 64; i += 1) {
        const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + choose + SHA256_CONSTANTS[i] + words[i]) >>> 0;
        const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }

    return hash.map(function (value) {
      return value.toString(16).padStart(8, '0');
    }).join('');
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function build(input) {
    const payload = normalize(input);
    const validation = validatePayload(payload);
    if (!validation.ok) {
      throw new TypeError('Invalid project context: ' + validation.errors.join('; '));
    }
    const hash = sha256(stableStringify(payload));
    return deepFreeze(Object.assign({
      contextId: asString(input && (input.contextId || input.context_id)) || 'ctx-' + hash.slice(0, 24),
      contextHash: 'sha256:' + hash
    }, payload));
  }

  function validate(input) {
    return validatePayload(normalize(input));
  }

  function verify(context) {
    const validation = validate(context);
    const errors = validation.errors.slice();
    const expectedHash = context && asString(context.contextHash || context.context_hash);
    const actualHash = 'sha256:' + sha256(stableStringify(normalize(context)));
    if (!expectedHash) errors.push('contextHash is required');
    else if (expectedHash !== actualHash) errors.push('contextHash does not match context payload');
    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: validation.warnings,
      actualHash: actualHash
    };
  }

  function flatten(value, prefix, output) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.keys(value).sort().forEach(function (key) {
        flatten(value[key], prefix ? prefix + '.' + key : key, output);
      });
      return output;
    }
    output[prefix] = stableStringify(value);
    return output;
  }

  function compare(before, after) {
    const left = flatten(normalize(before), '', {});
    const right = flatten(normalize(after), '', {});
    const changedPaths = Array.from(new Set(Object.keys(left).concat(Object.keys(right))))
      .filter(function (path) { return left[path] !== right[path]; })
      .sort();
    return { same: changedPaths.length === 0, changedPaths: changedPaths };
  }

  return Object.freeze({
    SCHEMA_VERSION: SCHEMA_VERSION,
    VERSION_KEYS: VERSION_KEYS,
    build: build,
    compare: compare,
    normalize: normalize,
    sha256: sha256,
    stableStringify: stableStringify,
    validate: validate,
    verify: verify
  });
});
