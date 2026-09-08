// Only public web assets may pass through the repository-root static handler.
export function publicStaticPath(raw){
  let value=String(raw||'');
  try{for(let i=0;i<3;i++){const decoded=decodeURIComponent(value);if(decoded===value)break;value=decoded;}}catch{return false;}
  const segments=value.replaceAll('\\','/').split('/').filter(Boolean);
  if(segments.some(s=>s.startsWith('.')||s.includes('\0')||s.includes(':')))return false;
  return !segments.some(s=>['local-server','local-data','outputs','migrations','scripts','tests','node_modules','functions','tools'].includes(s.toLowerCase()))
    && !/\.(?:env|sql|dump|bak|sqlite|db|log|pem|key|toml|ya?ml)$/i.test(value);
}
