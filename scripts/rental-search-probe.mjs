import {wrSearchProvider,wrDeepSeekResponsesUrl} from '../functions/api/_web-research-core.js';
console.log('searchEndpoint',new URL(wrDeepSeekResponsesUrl(process.env)).origin);
const query=process.argv.slice(2).join(' ')||'深圳 金地梅陇镇 租房';
console.log(JSON.stringify(await wrSearchProvider(process.env,'deepseek-web',query,{domain:'rental',limit:10,maxOutputTokens:3000}),null,2));
