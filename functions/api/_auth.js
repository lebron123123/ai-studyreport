// 共享鉴权工具（文件名以_开头，不会成为对外路由）
import {accountSecurity} from './_account-security.js';
const enc = new TextEncoder();
const SESSION_TTL=30*24*3600*1000;

function bufToHex(buf){
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function hexToBuf(hex){
  const a = new Uint8Array(hex.length/2);
  for(let i=0;i<a.length;i++) a[i]=parseInt(hex.substr(i*2,2),16);
  return a.buffer;
}

export function randomHex(nBytes){
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return bufToHex(a.buffer);
}

export async function hashPassword(password, saltHex){
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {name:"PBKDF2", hash:"SHA-256", salt:hexToBuf(saltHex), iterations:100000}, key, 256);
  return bufToHex(bits);
}

async function hmacHex(secret, msg){
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return bufToHex(sig);
}

// 令牌格式：userId.用户名(URL编码).过期时间戳.签名
export async function signToken(env, userId, username){
  const state=await accountSecurity(env,userId);
  if(Number(state?.disabled))throw new Error('账号已停用，请联系管理员');
  const exp = Math.max(Date.now(),Number(state?.revoked_before||0)+1) + SESSION_TTL;
  const payload = userId + "." + encodeURIComponent(username) + "." + exp;
  const sig = await hmacHex(env.SESSION_SECRET, payload);
  return payload + "." + sig;
}

export async function verifyAuth(request, env){
  if(!env.SESSION_SECRET) return null;
  const h = request.headers.get("authorization") || "";
  const token = h.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if(parts.length !== 4) return null;
  const [uid, uname, exp, sig] = parts;
  if(!/^\d+$/.test(uid)||!Number.isSafeInteger(Number(uid))||Number(uid)<=0||!/^\d+$/.test(exp)||!Number.isSafeInteger(Number(exp)))return null;
  const payload = uid + "." + uname + "." + exp;
  const expect = await hmacHex(env.SESSION_SECRET, payload);
  if(sig !== expect) return null;
  if(Date.now() > +exp) return null;
  const state=await accountSecurity(env,+uid);
  if(Number(state?.disabled)||(+exp-SESSION_TTL)<=Number(state?.revoked_before||0))return null;
  try{return { userId: +uid, username: decodeURIComponent(uname) };}catch{return null;}
}

export function json(obj, status=200){
  return new Response(JSON.stringify(obj), {status, headers:{"Content-Type":"application/json"}});
}
