# RAG 批量迁移与恢复手册

这套工具用于把开发电脑上的知识库完整迁移到机房 PostgreSQL/pgvector，而不是重新上传全部资料。

## 默认迁移内容

- RAG 文档台账、精确文本切片和 1024 维向量；
- 上传时保存的Word、PDF、Excel、图片等原始二进制文件，并逐文件校验SHA-256；
- Wiki 页面及发布状态；
- 正式资料台账、资料版本和资料关系；
- Excel 工作簿、工作表、单元格及字段映射；
- RAG 评测集和检索权重配置。

个人知识库、联网证据和检索历史默认不导出，防止敏感数据被无意迁移。需要时分别增加 `--include-personal`、`--include-evidence`、`--include-history`。

## 一、在开发电脑导出

进入 `local-server` 目录执行：

```powershell
npm run rag:export -- --out=../backups/rag-knowledge-首次迁移.rag.gz
```

若也要迁移个人知识库和已经确认的联网证据：

```powershell
npm run rag:export -- --out=../backups/rag-all.rag.gz --include-personal --include-evidence
```

导出会生成：

- `*.rag.gz`：单文件迁移包；
- `*.rag.gz.sha256`：整包校验值。

导出使用数据库一致性只读快照，不会暂停或修改现有知识库。原件按内容哈希寻址，相同内容即使文件名不同也只保存和迁移一份。

## 二、复制到机房后先验证

```powershell
npm run rag:verify -- --file=D:/transfer/rag-knowledge-首次迁移.rag.gz
```

若文件被截断、修改或复制损坏，验证会失败，不允许进入导入阶段。

## 三、目标服务器导入预检

先部署相同或更新版本代码并执行 `local-server/schema-postgres.sql`，确保 PostgreSQL 已安装 pgvector。随后只做预检：

```powershell
$env:TARGET_DATABASE_URL="postgres://用户名:密码@数据库地址:5432/studydb"
npm run rag:import -- --file=D:/transfer/rag-knowledge-首次迁移.rag.gz --dry-run
```

预检会检查表、字段、主键、向量维度和资料所有者。用户编号不会直接照搬，而是按用户名映射到机房数据库；目标缺少同名用户时会停止，避免资料错挂到其他账号。预检不写入任何记录，也不会显示数据库密码。

## 四、正式导入

```powershell
npm run rag:import -- --file=D:/transfer/rag-knowledge-首次迁移.rag.gz
```

默认 `merge` 模式：相同主键更新，不同主键新增；可重复执行，不会产生重复切片，也不会清空服务器已有知识。导入按100行一批写入，超大知识库可用 `--batch-size=200` 调整，但上限为500，避免单条SQL参数过多。

`replace` 模式会清空迁移范围内的目标表，只用于确定机房库应与本机完全一致的首次部署：

```powershell
npm run rag:import -- --file=D:/transfer/rag-knowledge-首次迁移.rag.gz --mode=replace --confirm-replace
```

执行 replace 前必须另做 PostgreSQL 全库备份。工具故意要求双参数确认，避免误清空。

## 五、导入后验收

1. 后台知识库文档数、切片数、分类数与导出清单一致，并显示“原件已保存”；
2. 向量库状态显示维度 1024，数量与 `rag_vectors` 一致；
3. 用评测集执行一次 RAG 评测；
4. 随机抽查政策文号精确检索、普通语义检索和权限受限资料；
5. 若迁移个人知识库，确认所有源用户名已经在目标服务器建立，并逐用户抽查权限隔离。

## 边界

- 迁移包包含知识正文和向量，按敏感资料保管，不应发送到公开网盘。
- 原件对象目录默认为 `local-data/rag-objects`，可用环境变量 `RAG_OBJECT_ROOT` 指向机房专用数据盘；不要把它放在Git目录或公开静态目录。
- 对象存储上线前已经入库的历史资料只有解析内容，后台会标记“仅解析内容”。这些历史资料需要重新选择原文件上传一次，系统会自动建立原件引用，不需要人工复制目录。
- 从本机迁到机房后，如果两端仍持续写入，不能把它当双向实时同步；应指定机房为正式主库，并定期从正式库做备份。
