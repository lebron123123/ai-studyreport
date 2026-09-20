import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {Readable} from 'node:stream';

export function ragObjectStorageKey(hash, namespace = '') {
  const value = String(hash || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("原件哈希格式无效");
  if(namespace && !/^research\/[1-9][0-9]*\/[a-zA-Z0-9_-]{8,100}\/[a-zA-Z0-9_-]{8,100}$/.test(namespace))throw new Error('原件命名空间无效');
  return path.posix.join(namespace, "sha256", value.slice(0, 2), value);
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
    async putStream({stream,fileName='',mimeType='application/octet-stream',maxBytes=256*1024*1024}){
      if(!stream||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('缺少文件流或大小限制无效');
      const temp=path.join(base,'.upload-'+crypto.randomUUID()),hash=crypto.createHash('sha256');let size=0,handle;
      try{
        handle=await fs.promises.open(temp,'wx');
        for await(const chunk of stream){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>maxBytes)throw new Error('文件超过上传上限');hash.update(buffer);await handle.writeFile(buffer);}
        if(!size)throw new Error('空文件不能归档');await handle.sync();await handle.close();handle=null;
        const contentHash=hash.digest('hex'),storageKey=ragObjectStorageKey(contentHash),target=resolveRagObjectPath(base,storageKey);await fs.promises.mkdir(path.dirname(target),{recursive:true});let deduplicated=false;
        try{await fs.promises.link(temp,target);}catch(e){if(e.code!=='EEXIST')throw e;const verified=await this.verify(storageKey,contentHash);if(!verified.ok||verified.sizeBytes!==size)throw new Error('已有对象校验失败');deduplicated=true;}
        return {contentHash,storageKey,sizeBytes:size,fileName:String(fileName).slice(0,240),mimeType:String(mimeType).slice(0,120),deduplicated};
      }finally{if(handle)await handle.close();await fs.promises.rm(temp,{force:true});}
    },
    async put({ bytes, fileName = "", mimeType = "application/octet-stream", namespace = '' }) {
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const storageKey = ragObjectStorageKey(hash, namespace);
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
    async openStream(storageKey) {
      const file=resolveRagObjectPath(base,storageKey);
      const stat=await fs.promises.stat(file);
      if(!stat.isFile())throw new Error('原件不存在');
      return {body:Readable.toWeb(fs.createReadStream(file)),sizeBytes:stat.size};
    },
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
