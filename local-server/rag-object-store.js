import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function ragObjectStorageKey(hash) {
  const value = String(hash || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("原件哈希格式无效");
  return path.posix.join("sha256", value.slice(0, 2), value);
}

export function resolveRagObjectPath(root, storageKey) {
  const base = path.resolve(root);
  const relative = String(storageKey || "").replace(/^[\\/]+/, "").replaceAll("/", path.sep);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error("原件对象路径越界");
  return target;
}

export function createRagObjectStore(root) {
  const base = path.resolve(root);
  fs.mkdirSync(base, { recursive: true });
  return {
    root: base,
    async put({ bytes, fileName = "", mimeType = "application/octet-stream" }) {
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const storageKey = ragObjectStorageKey(hash);
      const target = resolveRagObjectPath(base, storageKey);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      let deduplicated = false;
      try {
        const existing = await fs.promises.readFile(target);
        const existingHash = crypto.createHash("sha256").update(existing).digest("hex");
        if (existingHash !== hash) throw new Error("同一对象键已有内容但哈希不一致");
        deduplicated = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const temp = target + ".tmp-" + process.pid + "-" + crypto.randomBytes(5).toString("hex");
        await fs.promises.writeFile(temp, buffer, { flag: "wx" });
        try { await fs.promises.rename(temp, target); }
        catch (renameError) {
          await fs.promises.rm(temp, { force: true });
          if (renameError.code !== "EEXIST") throw renameError;
          deduplicated = true;
        }
      }
      return { contentHash: hash, storageKey, sizeBytes: buffer.length, fileName: String(fileName || "").slice(0, 240), mimeType: String(mimeType || "application/octet-stream").slice(0, 120), deduplicated };
    },
    resolve(storageKey) { return resolveRagObjectPath(base, storageKey); },
    async verify(storageKey, expectedHash) {
      const file = resolveRagObjectPath(base, storageKey);
      const hash = crypto.createHash("sha256");
      let sizeBytes = 0;
      for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); sizeBytes += chunk.length; }
      return { ok: hash.digest("hex") === expectedHash, sizeBytes, file };
    },
    async remove(storageKey) {
      const file = resolveRagObjectPath(base, storageKey);
      await fs.promises.rm(file, { force: true });
      return true;
    },
  };
}
