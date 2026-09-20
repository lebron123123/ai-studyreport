// Shared, lossless storage protocol. Identity and permissions belong to the caller.
// Long strings are immutable objects; manifests retain every array and field.
import {RESEARCH_LOGICAL_STATE_MAX_BYTES} from './research-storage-policy.mjs';
const LIMIT = 2048;
const encoder = new TextEncoder();
const COMPACT_VERSION = '2';
const REF = '~s';
const CHUNKS = '~c';
const ESCAPED_ARRAY = '~a';
const RESERVED_ARRAY_TAGS = new Set([COMPACT_VERSION, REF, CHUNKS, ESCAPED_ARRAY]);
// The HTTP manifest is already capped at 20 MiB. Large reports can legitimately
// contain more than 500k small scalar fields, so keep a separate structural cap
// high enough for those reports while still rejecting pathological expansion.
const MAX_NODES = 2_000_000;
export async function packState(state, known = new Map()) {
  const objects = new Map();
  async function visit(value) {
    if (typeof value === 'string' && value.length > 131072) {
      const parts=[];
      for(let start=0;start<value.length;start+=131072)parts.push(await visit(value.slice(start,start+131072)));
      return [CHUNKS,parts];
    }
    if (typeof value === 'string' && value.length >= LIMIT) {
      let digest = known.get(value);
      if (!digest) {
        digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
        // Bound the acceleration cache. Eviction here never deletes persisted data.
        if (known.size >= 128 || (known.storageChars || 0) + value.length > 8 * 1024 * 1024) { known.clear(); known.storageChars = 0; }
        if(value.length <= 8 * 1024 * 1024){ known.set(value, digest); known.storageChars = (known.storageChars || 0) + value.length; }
      }
      objects.set(digest, value);
      return [REF, digest];
    }
    if (Array.isArray(value)) {
      const result=await Promise.all(value.map(visit));
      return result.length===2&&RESERVED_ARRAY_TAGS.has(result[0])?[ESCAPED_ARRAY,result]:result;
    }
    if (value && typeof value === 'object') {
      const result = {};
      for (const key of Object.keys(value)) {
        if (value[key] !== undefined) Object.defineProperty(result,key,{value:await visit(value[key]),enumerable:true,writable:true,configurable:true});
      }
      return result;
    }
    return value ?? null;
  }
  return { manifest: [COMPACT_VERSION,await visit(state)], objects };
}
export function unpackState(manifest, objects, {maxBytes=RESEARCH_LOGICAL_STATE_MAX_BYTES}={}) {
  let count = 0,bytes=0;
  const measuredObjects=new Map();
  const text=(value,objectId)=>{
    let size=objectId&&measuredObjects.get(objectId);
    if(size===undefined){size=encoder.encode(value).byteLength;if(objectId)measuredObjects.set(objectId,size);}
    bytes+=size;
    if(bytes>maxBytes)throw new Error('草稿展开内容超过128MiB逻辑容量，原稿未修改');
    return value;
  };
  function compact(node,depth=0){
    if(++count>MAX_NODES||depth>100)throw new Error('草稿结构无效');
    if(Array.isArray(node)){
      if(node.length===2&&node[0]===REF){if(!/^[a-f0-9]{64}$/.test(node[1])||!objects.has(node[1]))throw new Error('草稿资料块不完整，未覆盖原内容');return text(objects.get(node[1]),node[1]);}
      if(node.length===2&&node[0]===CHUNKS){if(!Array.isArray(node[1]))throw new Error('草稿文本块无效');const parts=node[1].map(value=>compact(value,depth+1));if(parts.some(value=>typeof value!=='string'))throw new Error('草稿文本块无效');return parts.join('');}
      if(node.length===2&&node[0]===ESCAPED_ARRAY){if(!Array.isArray(node[1]))throw new Error('草稿数组无效');return node[1].map(value=>compact(value,depth+1));}
      return node.map(value=>compact(value,depth+1));
    }
    if(node&&typeof node==='object'){
      const result={};
      for(const [key,value] of Object.entries(node))Object.defineProperty(result,key,{value:compact(value,depth+1),enumerable:true,writable:true,configurable:true});
      return result;
    }
    if(node!==null&&!['string','number','boolean'].includes(typeof node))throw new Error('草稿值无效');
    return typeof node==='string'?text(node):node;
  }
  if(Array.isArray(manifest)&&manifest.length===2&&manifest[0]===COMPACT_VERSION)return compact(manifest[1]);
  function visit(node, depth = 0) {
    if (++count > MAX_NODES || depth > 100 || !Array.isArray(node) || node.length !== 2) throw new Error('草稿结构无效');
    const [kind, value] = node;
    if (kind === 'v') {
      if (value !== null && !['string','number','boolean'].includes(typeof value)) throw new Error('草稿值无效');
      return typeof value==='string'?text(value):value;
    }
    if (kind === 's') {
      if (!/^[a-f0-9]{64}$/.test(value) || !objects.has(value)) throw new Error('草稿资料块不完整，未覆盖原内容');
      return text(objects.get(value),value);
    }
    if (kind === 'a' && Array.isArray(value)) return value.map(n => visit(n, depth + 1));
    if (kind === 'c' && Array.isArray(value)) {const parts=value.map(n=>visit(n,depth+1));if(parts.some(p=>typeof p!=='string'))throw new Error('草稿文本块无效');return parts.join('');}
    if (kind === 'o' && Array.isArray(value)) {
      const result = {};
      for (const entry of value) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || Object.hasOwn(result, entry[0])) throw new Error('草稿字段无效');
        Object.defineProperty(result, entry[0], { value: visit(entry[1], depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    throw new Error('草稿结构无效');
  }
  return visit(manifest);
}
export function referencedObjects(manifest) {
  const ids = new Set();
  if(Array.isArray(manifest)&&manifest.length===2&&manifest[0]===COMPACT_VERSION){
    let count=0;
    (function compact(node,depth=0){
      if(++count>MAX_NODES||depth>100)throw new Error('草稿结构无效');
      if(Array.isArray(node)){
        if(node.length===2&&node[0]===REF){if(!/^[a-f0-9]{64}$/.test(node[1]))throw new Error('资料块标识无效');ids.add(node[1]);return;}
        if(node.length===2&&(node[0]===CHUNKS||node[0]===ESCAPED_ARRAY)){if(!Array.isArray(node[1]))throw new Error('草稿结构无效');node[1].forEach(value=>compact(value,depth+1));return;}
        node.forEach(value=>compact(value,depth+1));return;
      }
      if(node&&typeof node==='object')Object.values(node).forEach(value=>compact(value,depth+1));
    })(manifest[1]);
    return ids;
  }
  function walk(node, depth = 0) {
    if (depth > 100 || !Array.isArray(node)) throw new Error('草稿结构无效');
    if (node[0] === 's') { if (!/^[a-f0-9]{64}$/.test(node[1])) throw new Error('资料块标识无效'); ids.add(node[1]); }
    else if (node[0] === 'a'||node[0] === 'c') node[1].forEach(n => walk(n, depth + 1));
    else if (node[0] === 'o') node[1].forEach(e => walk(e[1], depth + 1));
  }
  walk(manifest);
  return ids;
}

// Returns a self-contained manifest for one authorized path. Both the original
// tagged format and the compact format remain readable during rolling upgrades.
export function selectManifestPath(manifest,path){
  if(!Array.isArray(path))throw new Error('读取路径无效');
  if(Array.isArray(manifest)&&manifest.length===2&&manifest[0]===COMPACT_VERSION){
    let node=manifest[1];
    for(const key of path){
      if(Array.isArray(node)&&node.length===2&&node[0]===ESCAPED_ARRAY)node=node[1];
      if(Array.isArray(node)&&Number.isSafeInteger(key)&&key>=0){if(key>=node.length)return {found:false};node=node[key];}
      else if(node&&typeof node==='object'&&!Array.isArray(node)&&typeof key==='string'){if(!Object.hasOwn(node,key))return {found:false};node=node[key];}
      else return {found:false};
    }
    return {found:true,manifest:[COMPACT_VERSION,node]};
  }
  let node=manifest;
  for(const key of path){
    if(!Array.isArray(node)||node.length!==2)throw new Error('草稿结构无效');
    if(node[0]==='o'&&typeof key==='string'){
      const entries=node[1].filter(entry=>entry[0]===key);
      if(entries.length>1)throw new Error('草稿字段重复');
      if(!entries.length)return {found:false};
      node=entries[0][1];
    }else if(node[0]==='a'&&Number.isSafeInteger(key)&&key>=0){if(key>=node[1].length)return {found:false};node=node[1][key];}
    else return {found:false};
  }
  return {found:true,manifest:node};
}
