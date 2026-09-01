// /api/materials  正式资料台账 + Excel 结构化读取
// 向量库只回答“相关不相关”；本接口保存可审计的来源元数据与单元格坐标。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

function isAdmin(env,user){
  const a=(env.ADMIN_USERS||"").split(",").map(x=>x.trim()).filter(Boolean);
  return a.includes(user.username)||a.includes(String(user.userId));
}
function passOk(env,request){ return !env.ADMIN_PASS || request.headers.get("x-admin-pass")===env.ADMIN_PASS; }
function text(v,n=240){ return String(v||"").trim().slice(0,n); }
function pageId(prefix){ const x=new Uint32Array(1); crypto.getRandomValues(x); return prefix+Date.now().toString(36)+x[0].toString(36).slice(0,5); }
export function diffLines(fromText,toText,limit=500){const aa=String(fromText||"").split(/\r?\n/),bb=String(toText||"").split(/\r?\n/),aset=new Set(aa),bset=new Set(bb);return{added:bb.filter(x=>x.trim()&&!aset.has(x)).slice(0,limit),removed:aa.filter(x=>x.trim()&&!bset.has(x)).slice(0,limit)};}
let schemaReady=false;
async function ensureSchema(env){
  if(schemaReady) return;
  const ts=env.DEPLOY_MODE==="local"?"BIGINT":"INTEGER";
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS source_assets (id TEXT PRIMARY KEY,title TEXT NOT NULL,document_type TEXT NOT NULL DEFAULT 'other',category TEXT DEFAULT '',lifecycle TEXT NOT NULL DEFAULT 'active',effect_status TEXT NOT NULL DEFAULT 'unknown',doc_no TEXT DEFAULT '',issuer TEXT DEFAULT '',issue_date TEXT DEFAULT '',effective_date TEXT DEFAULT '',expiry_date TEXT DEFAULT '',project_no TEXT DEFAULT '',project_type TEXT DEFAULT '',region TEXT DEFAULT '',source_ref TEXT DEFAULT '',version_no TEXT DEFAULT '',content_hash TEXT DEFAULT '',rag_title TEXT DEFAULT '',note TEXT DEFAULT '',created_by INTEGER,created_at "+ts+" NOT NULL,updated_at "+ts+" NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_source_assets_type ON source_assets(document_type,lifecycle,updated_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_source_assets_project ON source_assets(project_no,project_type,region)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS source_asset_versions (id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,version_no TEXT DEFAULT '',content_hash TEXT DEFAULT '',content_text TEXT DEFAULT '',effect_status TEXT DEFAULT 'unknown',created_at "+ts+" NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_source_asset_versions_asset ON source_asset_versions(asset_id,created_at DESC)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS source_asset_objects (asset_id TEXT NOT NULL,version_no TEXT NOT NULL DEFAULT '',content_hash TEXT NOT NULL,linked_at "+ts+" NOT NULL,PRIMARY KEY(asset_id,version_no))").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_source_asset_objects_hash ON source_asset_objects(content_hash)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS source_asset_relations (id TEXT PRIMARY KEY,from_asset_id TEXT NOT NULL,target_doc_no TEXT NOT NULL,relation_type TEXT NOT NULL,note TEXT DEFAULT '',created_at "+ts+" NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS excel_workbooks (id TEXT PRIMARY KEY,asset_id TEXT,title TEXT NOT NULL,filename TEXT DEFAULT '',content_hash TEXT DEFAULT '',sheet_count INTEGER NOT NULL DEFAULT 0,created_by INTEGER,created_at "+ts+" NOT NULL,updated_at "+ts+" NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS excel_sheets (id TEXT PRIMARY KEY,workbook_id TEXT NOT NULL,name TEXT NOT NULL,sheet_index INTEGER NOT NULL DEFAULT 0,used_range TEXT DEFAULT '',headers TEXT DEFAULT '[]',row_count INTEGER NOT NULL DEFAULT 0,col_count INTEGER NOT NULL DEFAULT 0,created_at "+ts+" NOT NULL,UNIQUE(workbook_id,name))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS excel_cells (sheet_id TEXT NOT NULL,address TEXT NOT NULL,row_idx INTEGER NOT NULL,col_idx INTEGER NOT NULL,raw_value TEXT DEFAULT '',display_value TEXT DEFAULT '',formula TEXT DEFAULT '',data_type TEXT DEFAULT '',PRIMARY KEY(sheet_id,address))").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_excel_cells_sheet_pos ON excel_cells(sheet_id,row_idx,col_idx)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS excel_field_mappings (id TEXT PRIMARY KEY,project_type TEXT DEFAULT '',calc_type TEXT DEFAULT '',field_key TEXT NOT NULL,field_label TEXT DEFAULT '',workbook_id TEXT NOT NULL,sheet_name TEXT NOT NULL,cell_address TEXT NOT NULL,note TEXT DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,created_at "+ts+" NOT NULL,updated_at "+ts+" NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_excel_field_mappings_lookup ON excel_field_mappings(project_type,calc_type,field_key,enabled)").run();
  schemaReady=true;
}
function assetOut(x){ return {...x,created_at:Number(x.created_at||0),updated_at:Number(x.updated_at||0)}; }

export async function onRequestPost(context){
  const {request}=context, env=adaptEnv(context.env);
  const user=await verifyAuth(request,env); if(!user) return json({ok:false,error:"未登录"},401);
  let body; try{body=await request.json();}catch(e){return json({ok:false,error:"格式有误"},400);}
  try{await ensureSchema(env);}catch(e){return json({ok:false,error:"资料台账初始化失败："+e.message},500);}
  const action=text(body.action,32);
  const needsAdmin=["saveAsset","createWorkbook","saveSheet","saveCells","deleteWorkbook","deleteAsset","saveMapping","deleteMapping"].includes(action);
  if(needsAdmin&&(!isAdmin(env,user)||!passOk(env,request))) return json({ok:false,error:"仅管理员可维护资料台账"},403);

  if(action==="listAssets"){
    const where=[],args=[]; const type=text(body.documentType,30), projectNo=text(body.projectNo,60), lifecycle=text(body.lifecycle,20);
    if(type){where.push("document_type=?");args.push(type);} if(projectNo){where.push("project_no=?");args.push(projectNo);} if(lifecycle){where.push("lifecycle=?");args.push(lifecycle);}
    const sql="SELECT * FROM source_assets"+(where.length?" WHERE "+where.join(" AND "):"")+" ORDER BY updated_at DESC LIMIT 300";
    const rows=await env.DB.prepare(sql).bind(...args).all(); return json({ok:true,assets:(rows.results||[]).map(assetOut)});
  }
  if(action==="saveAsset"){
    const p=body.asset||{}, now=Date.now(); let id=text(p.id,50);
    const fields={title:text(p.title,120),document_type:text(p.document_type,30)||"other",category:text(p.category,30),lifecycle:["active","superseded","archived"].includes(p.lifecycle)?p.lifecycle:"active",effect_status:["current","expired","revised","unknown"].includes(p.effect_status)?p.effect_status:"unknown",doc_no:text(p.doc_no,80),issuer:text(p.issuer,60),issue_date:text(p.issue_date,10),effective_date:text(p.effective_date,10),expiry_date:text(p.expiry_date,10),project_no:text(p.project_no,60),project_type:text(p.project_type,40),region:text(p.region,40),source_ref:text(p.source_ref,240),version_no:text(p.version_no,30),content_hash:text(p.content_hash,64),rag_title:text(p.rag_title,80),note:text(p.note,1000)};
    if(!fields.title) return json({ok:false,error:"资料标题不能为空"},400);
    if(!id){const same=fields.doc_no?await env.DB.prepare("SELECT id FROM source_assets WHERE doc_no=? ORDER BY updated_at DESC LIMIT 1").bind(fields.doc_no).first():await env.DB.prepare("SELECT id FROM source_assets WHERE title=? AND document_type=? ORDER BY updated_at DESC LIMIT 1").bind(fields.title,fields.document_type).first(); id=same?same.id:pageId("asset_");}
    const old=await env.DB.prepare("SELECT id FROM source_assets WHERE id=?").bind(id).first();
    const vals=Object.values(fields);
    if(old) await env.DB.prepare("UPDATE source_assets SET title=?,document_type=?,category=?,lifecycle=?,effect_status=?,doc_no=?,issuer=?,issue_date=?,effective_date=?,expiry_date=?,project_no=?,project_type=?,region=?,source_ref=?,version_no=?,content_hash=?,rag_title=?,note=?,updated_at=? WHERE id=?").bind(...vals,now,id).run();
    else await env.DB.prepare("INSERT INTO source_assets(id,title,document_type,category,lifecycle,effect_status,doc_no,issuer,issue_date,effective_date,expiry_date,project_no,project_type,region,source_ref,version_no,content_hash,rag_title,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,...vals,user.userId,now,now).run();
    const content=text(p.content_text,200000), ver=fields.version_no||("v"+now);
    if(content||fields.content_hash){const dup=await env.DB.prepare("SELECT id FROM source_asset_versions WHERE asset_id=? AND content_hash=? LIMIT 1").bind(id,fields.content_hash).first(); if(!dup)await env.DB.prepare("INSERT INTO source_asset_versions(id,asset_id,version_no,content_hash,content_text,effect_status,created_at) VALUES(?,?,?,?,?,?,?)").bind(pageId("aver_"),id,ver,fields.content_hash,content,fields.effect_status,now).run();}
    const sourceObjectHash=/^[a-f0-9]{64}$/i.test(String(p.source_object_hash||""))?String(p.source_object_hash).toLowerCase():"";
    if(sourceObjectHash){const link=await env.DB.prepare("SELECT asset_id FROM source_asset_objects WHERE asset_id=? AND version_no=?").bind(id,ver).first();if(link)await env.DB.prepare("UPDATE source_asset_objects SET content_hash=?,linked_at=? WHERE asset_id=? AND version_no=?").bind(sourceObjectHash,now,id,ver).run();else await env.DB.prepare("INSERT INTO source_asset_objects(asset_id,version_no,content_hash,linked_at) VALUES(?,?,?,?)").bind(id,ver,sourceObjectHash,now).run();}
    const targetDoc=text(p.replaces_doc_no,80), relation=["replaces","revises","abolishes","cites"].includes(p.relation_type)?p.relation_type:""; if(targetDoc&&relation){await env.DB.prepare("INSERT INTO source_asset_relations(id,from_asset_id,target_doc_no,relation_type,note,created_at) VALUES(?,?,?,?,?,?)").bind(pageId("rel_"),id,targetDoc,relation,text(p.relation_note,500),now).run();if(relation!=="cites"){await env.DB.prepare("UPDATE source_assets SET effect_status=?,lifecycle='superseded',updated_at=? WHERE doc_no=?").bind(relation==="abolishes"?"expired":"revised",now,targetDoc).run();try{await env.DB.prepare("UPDATE rag_files_v2 SET enabled=0 WHERE title IN (SELECT title FROM rag_file_meta WHERE doc_no=?)").bind(targetDoc).run();}catch(e){}}}
    const saved=await env.DB.prepare("SELECT * FROM source_assets WHERE id=?").bind(id).first(); return json({ok:true,asset:assetOut(saved),updated:!!old});
  }
  if(action==="assetVersions"){
    const id=text(body.assetId,50); const rows=await env.DB.prepare("SELECT id,asset_id,version_no,content_hash,effect_status,created_at FROM source_asset_versions WHERE asset_id=? ORDER BY created_at DESC LIMIT 50").bind(id).all(); const rel=await env.DB.prepare("SELECT * FROM source_asset_relations WHERE from_asset_id=? ORDER BY created_at DESC").bind(id).all(); return json({ok:true,versions:rows.results||[],relations:rel.results||[]});
  }
  if(action==="compareVersions"){
    const a=await env.DB.prepare("SELECT * FROM source_asset_versions WHERE id=?").bind(text(body.fromVersionId,50)).first(), b=await env.DB.prepare("SELECT * FROM source_asset_versions WHERE id=?").bind(text(body.toVersionId,50)).first(); if(!a||!b)return json({ok:false,error:"版本不存在"},404);
    const d=diffLines(a.content_text,b.content_text); return json({ok:true,from:a.version_no,to:b.version_no,...d});
  }
  if(action==="bulkSaveAssets"){
    const rows=(body.assets||[]).slice(0,200),results=[];
    for(const p of rows){
      const title=text(p.title,120); if(!title){results.push({ok:false,error:"标题为空"});continue;}
      const now=Date.now(),docNo=text(p.doc_no,80),dtype=text(p.document_type,30)||"other";
      const same=docNo?await env.DB.prepare("SELECT id FROM source_assets WHERE doc_no=? ORDER BY updated_at DESC LIMIT 1").bind(docNo).first():await env.DB.prepare("SELECT id FROM source_assets WHERE title=? AND document_type=? ORDER BY updated_at DESC LIMIT 1").bind(title,dtype).first();
      const id=same?same.id:pageId("asset_");
      if(same) await env.DB.prepare("UPDATE source_assets SET title=?,category=?,lifecycle=?,effect_status=?,issuer=?,effective_date=?,expiry_date=?,project_no=?,project_type=?,region=?,source_ref=?,version_no=?,note=?,updated_at=? WHERE id=?").bind(title,text(p.category,30),text(p.lifecycle,20)||"active",text(p.effect_status,20)||"unknown",text(p.issuer,60),text(p.effective_date,10),text(p.expiry_date,10),text(p.project_no,60),text(p.project_type,40),text(p.region,40),text(p.source_ref,240),text(p.version_no,30),text(p.note,1000),now,id).run();
      else await env.DB.prepare("INSERT INTO source_assets(id,title,document_type,category,lifecycle,effect_status,doc_no,issuer,issue_date,effective_date,expiry_date,project_no,project_type,region,source_ref,version_no,content_hash,rag_title,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,title,dtype,text(p.category,30),text(p.lifecycle,20)||"active",text(p.effect_status,20)||"unknown",docNo,text(p.issuer,60),text(p.issue_date,10),text(p.effective_date,10),text(p.expiry_date,10),text(p.project_no,60),text(p.project_type,40),text(p.region,40),text(p.source_ref,240),text(p.version_no,30),text(p.content_hash,64),text(p.rag_title,80),text(p.note,1000),user.userId,now,now).run();
      results.push({ok:true,id,title,updated:!!same});
    }
    return json({ok:true,accepted:results.filter(x=>x.ok).length,rejected:results.filter(x=>!x.ok).length,results});
  }
  if(action==="listWorkbooks"){
    const rows=await env.DB.prepare("SELECT w.*,a.title AS asset_title,a.project_no,a.project_type,a.region FROM excel_workbooks w LEFT JOIN source_assets a ON a.id=w.asset_id ORDER BY w.updated_at DESC LIMIT 200").all();
    return json({ok:true,workbooks:rows.results||[]});
  }
  if(action==="getWorkbook"){
    const id=text(body.workbookId,50); const wb=await env.DB.prepare("SELECT w.*,a.title AS asset_title,a.source_ref,a.project_no,a.project_type,a.region FROM excel_workbooks w LEFT JOIN source_assets a ON a.id=w.asset_id WHERE w.id=?").bind(id).first();
    if(!wb) return json({ok:false,error:"工作簿不存在"},404);
    const sheets=await env.DB.prepare("SELECT id,name,sheet_index,used_range,headers,row_count,col_count FROM excel_sheets WHERE workbook_id=? ORDER BY sheet_index").bind(id).all();
    return json({ok:true,workbook:wb,sheets:sheets.results||[]});
  }
  if(action==="createWorkbook"){
    const now=Date.now(), title=text(body.title,120), filename=text(body.filename,160), assetId=text(body.assetId,50), contentHash=text(body.contentHash,64);
    if(!title) return json({ok:false,error:"工作簿标题不能为空"},400);
    const old=await env.DB.prepare("SELECT id FROM excel_workbooks WHERE title=? ORDER BY updated_at DESC LIMIT 1").bind(title).first();
    if(old){
      await env.DB.prepare("DELETE FROM excel_cells WHERE sheet_id IN (SELECT id FROM excel_sheets WHERE workbook_id=?)").bind(old.id).run();
      await env.DB.prepare("DELETE FROM excel_sheets WHERE workbook_id=?").bind(old.id).run();
      await env.DB.prepare("UPDATE excel_workbooks SET asset_id=?,filename=?,content_hash=?,sheet_count=0,updated_at=? WHERE id=?").bind(assetId,filename,contentHash,now,old.id).run();
      return json({ok:true,workbookId:old.id,replaced:true});
    }
    const id=pageId("xlsx_"); await env.DB.prepare("INSERT INTO excel_workbooks(id,asset_id,title,filename,content_hash,sheet_count,created_by,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?)").bind(id,assetId,title,filename,contentHash,user.userId,now,now).run();
    return json({ok:true,workbookId:id,replaced:false});
  }
  if(action==="saveSheet"){
    const wb=text(body.workbookId,50), p=body.sheet||{}, name=text(p.name,100); if(!wb||!name) return json({ok:false,error:"缺少工作簿或 Sheet 名称"},400);
    const id=pageId("sheet_"); const now=Date.now();
    const old=await env.DB.prepare("SELECT id FROM excel_sheets WHERE workbook_id=? AND name=?").bind(wb,name).first();
    if(old){await env.DB.prepare("DELETE FROM excel_cells WHERE sheet_id=?").bind(old.id).run(); await env.DB.prepare("DELETE FROM excel_sheets WHERE id=?").bind(old.id).run();}
    await env.DB.prepare("INSERT INTO excel_sheets(id,workbook_id,name,sheet_index,used_range,headers,row_count,col_count,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,wb,name,parseInt(p.sheet_index)||0,text(p.used_range,40),JSON.stringify((p.headers||[]).slice(0,100)),parseInt(p.row_count)||0,parseInt(p.col_count)||0,now).run();
    await env.DB.prepare("UPDATE excel_workbooks SET sheet_count=(SELECT COUNT(*) FROM excel_sheets WHERE workbook_id=?),updated_at=? WHERE id=?").bind(wb,now,wb).run(); return json({ok:true,sheetId:id});
  }
  if(action==="saveCells"){
    const sheetId=text(body.sheetId,50), cells=(body.cells||[]).slice(0,500); if(!sheetId||!cells.length) return json({ok:false,error:"缺少单元格"},400);
    for(const c of cells){const addr=text(c.address,30); if(!addr) continue; await env.DB.prepare("INSERT INTO excel_cells(sheet_id,address,row_idx,col_idx,raw_value,display_value,formula,data_type) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sheet_id,address) DO UPDATE SET raw_value=excluded.raw_value,display_value=excluded.display_value,formula=excluded.formula,data_type=excluded.data_type").bind(sheetId,addr,parseInt(c.row_idx)||0,parseInt(c.col_idx)||0,text(c.raw_value,1000),text(c.display_value,1000),text(c.formula,1000),text(c.data_type,30)).run();}
    return json({ok:true,count:cells.length});
  }
  if(action==="readExcelSheet"){
    const wb=text(body.workbookId,50), name=text(body.sheetName,100); const s=await env.DB.prepare("SELECT * FROM excel_sheets WHERE workbook_id=? AND name=?").bind(wb,name).first(); if(!s) return json({ok:false,error:"Sheet 不存在"},404);
    const cells=await env.DB.prepare("SELECT * FROM excel_cells WHERE sheet_id=? ORDER BY row_idx,col_idx LIMIT 1000").bind(s.id).all(); return json({ok:true,sheet:s,cells:cells.results||[]});
  }
  if(action==="readExcelCell"){
    const wb=text(body.workbookId,50), name=text(body.sheetName,100), addr=text(body.address,30).toUpperCase();
    const row=await env.DB.prepare("SELECT c.*,s.name AS sheet_name,w.title AS workbook_title,w.asset_id,a.source_ref,a.project_no,a.project_type,a.region FROM excel_cells c JOIN excel_sheets s ON s.id=c.sheet_id JOIN excel_workbooks w ON w.id=s.workbook_id LEFT JOIN source_assets a ON a.id=w.asset_id WHERE s.workbook_id=? AND s.name=? AND c.address=?").bind(wb,name,addr).first();
    if(!row) return json({ok:false,error:"未找到该单元格"},404); row.provenance={type:"excel_cell",label:"《"+row.workbook_title+"》→"+row.sheet_name+"!"+row.address,workbookId:wb,sheetName:row.sheet_name,address:row.address,sourceRef:row.source_ref||""}; return json({ok:true,cell:row});
  }
  if(action==="listMappings"){
    const ptype=text(body.projectType,40), ctype=text(body.calcType,30); const rows=await env.DB.prepare("SELECT m.*,w.title AS workbook_title FROM excel_field_mappings m LEFT JOIN excel_workbooks w ON w.id=m.workbook_id WHERE (?='' OR m.project_type=?) AND (?='' OR m.calc_type=?) ORDER BY m.updated_at DESC LIMIT 300").bind(ptype,ptype,ctype,ctype).all(); return json({ok:true,mappings:rows.results||[]});
  }
  if(action==="saveMapping"){
    const p=body.mapping||{}, now=Date.now(), id=text(p.id,50)||pageId("map_"); const key=text(p.field_key,80), wb=text(p.workbook_id,50), sheet=text(p.sheet_name,100), cell=text(p.cell_address,30).toUpperCase();
    if(!key||!wb||!sheet||!cell) return json({ok:false,error:"映射需包含字段、工作簿、Sheet 和单元格"},400);
    const old=await env.DB.prepare("SELECT id FROM excel_field_mappings WHERE id=?").bind(id).first(); const vals=[text(p.project_type,40),text(p.calc_type,30),key,text(p.field_label,120),wb,sheet,cell,text(p.note,500),p.enabled===0?0:1];
    if(old) await env.DB.prepare("UPDATE excel_field_mappings SET project_type=?,calc_type=?,field_key=?,field_label=?,workbook_id=?,sheet_name=?,cell_address=?,note=?,enabled=?,updated_at=? WHERE id=?").bind(...vals,now,id).run(); else await env.DB.prepare("INSERT INTO excel_field_mappings(id,project_type,calc_type,field_key,field_label,workbook_id,sheet_name,cell_address,note,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,...vals,now,now).run(); return json({ok:true,id});
  }
  if(action==="deleteMapping"){
    await env.DB.prepare("DELETE FROM excel_field_mappings WHERE id=?").bind(text(body.id,50)).run(); return json({ok:true});
  }
  if(action==="resolveMappings"){
    const ptype=text(body.projectType,40), ctype=text(body.calcType,30); const rows=await env.DB.prepare("SELECT m.*,w.title AS workbook_title,c.display_value,c.raw_value,c.formula,a.source_ref FROM excel_field_mappings m JOIN excel_workbooks w ON w.id=m.workbook_id JOIN excel_sheets s ON s.workbook_id=w.id AND s.name=m.sheet_name JOIN excel_cells c ON c.sheet_id=s.id AND c.address=m.cell_address LEFT JOIN source_assets a ON a.id=w.asset_id WHERE m.enabled=1 AND (?='' OR m.project_type=?) AND (?='' OR m.calc_type=?)").bind(ptype,ptype,ctype,ctype).all(); return json({ok:true,values:rows.results||[]});
  }
  if(action==="deleteWorkbook"){
    const id=text(body.workbookId,50); await env.DB.prepare("DELETE FROM excel_cells WHERE sheet_id IN (SELECT id FROM excel_sheets WHERE workbook_id=?)").bind(id).run(); await env.DB.prepare("DELETE FROM excel_sheets WHERE workbook_id=?").bind(id).run(); await env.DB.prepare("DELETE FROM excel_workbooks WHERE id=?").bind(id).run(); return json({ok:true});
  }
  if(action==="deleteAsset"){
    const id=text(body.assetId,50);
    await env.DB.prepare("DELETE FROM excel_field_mappings WHERE workbook_id IN (SELECT id FROM excel_workbooks WHERE asset_id=?)").bind(id).run();
    await env.DB.prepare("DELETE FROM excel_cells WHERE sheet_id IN (SELECT s.id FROM excel_sheets s JOIN excel_workbooks w ON w.id=s.workbook_id WHERE w.asset_id=?)").bind(id).run();
    await env.DB.prepare("DELETE FROM excel_sheets WHERE workbook_id IN (SELECT id FROM excel_workbooks WHERE asset_id=?)").bind(id).run();
    await env.DB.prepare("DELETE FROM excel_workbooks WHERE asset_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM source_asset_versions WHERE asset_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM source_asset_relations WHERE from_asset_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM source_asset_objects WHERE asset_id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM source_assets WHERE id=?").bind(id).run(); return json({ok:true});
  }
  return json({ok:false,error:"未知操作"},400);
}
