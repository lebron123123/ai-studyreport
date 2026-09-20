// PostgreSQL publication: vectors, exact text, ledger and publication receipt commit together.
export async function publishContribution(env, id, user) {
  if (env.DEPLOY_MODE !== 'local' || !env.DB?._transaction || !env.AI) throw new Error('发布需要 PostgreSQL 事务服务及可用的向量模型');
  const row = await env.DB.prepare('SELECT * FROM knowledge_contributions WHERE id=?').bind(id).first();
  if (!row || row.status !== 'approved' || !['wiki','material'].includes(row.kind)) throw new Error('资料尚未通过审核');
  const meta = JSON.parse(row.meta || '{}');
  if (meta.publication?.state === 'published') return {state:'published',title:meta.publication.title,existing:true};
  const wiki = row.target_module.startsWith('知识 Wiki');
  const target = await env.DB.prepare(wiki ? 'SELECT * FROM wiki_pages WHERE id=?' : 'SELECT * FROM source_assets WHERE id=?').bind(row.target_ref).first();
  if (!target) throw new Error('已分流资料不存在，请核查台账');
  if (wiki && target.status !== 'draft') throw new Error('Wiki已独立发布或归档，请在知识Wiki核查，不能重复覆盖');
  const version = wiki ? null : await env.DB.prepare('SELECT * FROM source_asset_versions WHERE asset_id=? ORDER BY created_at DESC LIMIT 1').bind(target.id).first();
  const content = wiki ? target.content : version?.content_text;
  if (!content || content.trim().length < 60 || !target.source_ref) throw new Error('正文不足60字或缺少来源，请先核验原文');
  const title = ((wiki ? '【Wiki】' : '【资料】') + target.id + '｜' + target.title).slice(0,80);
  const category = wiki ? '业务逻辑' : (['policy','rule'].includes(target.document_type) ? '政策文件' : '未分类');
  const parts = [];
  for (let i=0;i<content.length;i+=900) parts.push(content.slice(i,i+1000));
  const vectors=[];
  const deadline=Date.now()+75000;
  for(let i=0;i<parts.length;i+=16){
    const batch=parts.slice(i,i+16);
    if(Date.now()>=deadline)throw new Error('索引处理超时，请稍后重试；尚未发布');
    let timer;
    const result=await Promise.race([
      env.AI.run('@cf/baai/bge-m3',{text:batch}),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('向量模型响应超时，请检查模型服务后重试')),Math.min(30000,deadline-Date.now()));})
    ]).finally(()=>clearTimeout(timer));
    if(!Array.isArray(result?.data)||result.data.length!==batch.length||result.data.some(v=>!Array.isArray(v)||!v.length||v.some(n=>!Number.isFinite(n))))throw new Error('向量模型返回不完整，请重试发布');
    vectors.push(...result.data);
  }
  return env.DB._transaction(async DB=>{
    const current=await DB.prepare('SELECT * FROM knowledge_contributions WHERE id=? FOR UPDATE').bind(id).first();
    const currentMeta=JSON.parse(current.meta||'{}');
    if(currentMeta.publication?.state==='published')return {...currentMeta.publication,existing:true};
    if(current.status!=='approved'||current.target_ref!==row.target_ref)throw new Error('审核状态已变化，请刷新');
    const locked=await DB.prepare(wiki?'SELECT * FROM wiki_pages WHERE id=? FOR UPDATE':'SELECT * FROM source_assets WHERE id=? FOR UPDATE').bind(target.id).first();
    const latest=wiki?null:await DB.prepare('SELECT * FROM source_asset_versions WHERE asset_id=? ORDER BY created_at DESC LIMIT 1').bind(target.id).first();
    if(!locked||locked.updated_at!==target.updated_at||(wiki?(locked.content!==content||locked.status!=='draft'):latest?.id!==version.id))throw new Error('资料已修改，请重新核对后发布');
    const now=Date.now(), ids=parts.map((_,i)=>'conpub_'+id+'_'+i);
    for(let i=0;i<parts.length;i++){
      const md={title,chapter:category,section:target.source_ref,category,level:category==='政策文件'?1:2,docNo:target.doc_no||'',issuer:target.issuer||'',sourceRef:target.source_ref,text:parts[i]};
      await DB.prepare('INSERT INTO rag_vectors(id,embedding,metadata) VALUES(?,?::vector,?::jsonb) ON CONFLICT(id) DO UPDATE SET embedding=EXCLUDED.embedding,metadata=EXCLUDED.metadata').bind(ids[i],'['+vectors[i].join(',')+']',JSON.stringify(md)).run();
      await DB.prepare('INSERT INTO rag_text_chunks(id,title,chapter,section,text,category,doc_no,issuer,source_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=EXCLUDED.text').bind(ids[i],title,category,target.source_ref,parts[i],category,md.docNo,md.issuer,target.source_ref,now).run();
    }
    await DB.prepare("INSERT INTO rag_files_v2(title,ids,chunks,category,level,enabled,security,dept_scope,effective_date,expiry_date,content_hash,version,updated_at,created_at) VALUES(?,?,?,?,?,1,?,?,?,?, '',1,?,?)").bind(title,JSON.stringify(ids),ids.length,category,category==='政策文件'?1:2,target.security||meta.security||1,target.dept_scope||meta.deptScope||'全部门',target.effective_date||'',target.expiry_date||'',now,now).run();
    await DB.prepare('INSERT INTO rag_file_meta(title,doc_no,issuer,source_ref,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(title) DO UPDATE SET source_ref=EXCLUDED.source_ref,updated_at=EXCLUDED.updated_at').bind(title,target.doc_no||'',target.issuer||'',target.source_ref,now).run();
    if(wiki)await DB.prepare("UPDATE wiki_pages SET status='published',vector_ids=?,version=version+1,updated_at=?,published_at=? WHERE id=?").bind(JSON.stringify(ids),now,now,target.id).run();
    else await DB.prepare('UPDATE source_assets SET rag_title=?,note=?,updated_at=? WHERE id=?').bind(title,'投稿审核并发布；正文及来源已由管理员确认；效力信息以台账为准',now,target.id).run();
    const publication={state:'published',title,chunks:ids.length,publishedAt:now,publishedBy:user.username};
    await DB.prepare('UPDATE knowledge_contributions SET meta=? WHERE id=?').bind(JSON.stringify({...currentMeta,publication}),id).run();
    return publication;
  });
}
