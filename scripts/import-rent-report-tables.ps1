param(
  [Parameter(Mandatory=$true)][string]$SourceDocx,
  [string]$OutputPath = "data/report-table-templates-rent-v1.json"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 创景苑正文70张物理表归并为33套业务模板。长周期附表只存一个逻辑模板，
# 但保留Word原稿的分段页（segments），供网页折叠和Word“续表”输出共用。
$definitions = @(
  @{id="rent-unit-standard"; title="住房各类套型基本指标"; tables=@(3); headerRows=1; staticCols=@(0); chapter="第一章 总论"; match=@("项目背景","主要前提条件","产品定位")},
  @{id="rent-unit-mix"; title="户型配比情况"; tables=@(4); headerRows=1; staticCols=@(0); chapter="第一章 总论"; match=@("项目背景","户型配比","产品定位")},
  @{id="rent-assumptions"; title="项目经济测算假设前提一览表"; tables=@(5); headerRows=1; staticCols=@(0,1,2,3); chapter="第一章 总论"; match=@("项目背景","主要前提条件","一般假设")},
  @{id="rent-main-indicators"; title="主要经济技术指标表"; tables=@(8); headerRows=1; staticCols=@(0,1,3); chapter="第一章 总论"; match=@("项目概况","项目建设规模和内容","项目建设规模")},
  @{id="rent-invest-funding-summary"; title="投资估算和资金筹措汇总表"; tables=@(9); headerRows=1; staticCols=@(0,1); chapter="第一章 总论"; match=@("项目概况","项目投资估算和资金筹措")},
  @{id="rent-finance-summary"; title="项目财务分析汇总表"; tables=@(10); headerRows=1; staticCols=@(0,1); chapter="第一章 总论"; match=@("项目概况","项目财务分析","财务评价")},
  @{id="rent-market-cases"; title="项目周边住宅租金案例一览表"; tables=@(11); headerRows=1; staticCols=@(0); chapter="第三章 项目市场分析"; match=@("项目定价分析","周边租金调研")},
  @{id="rent-case-adjustment-summary"; title="所选案例租金修正汇总表"; tables=@(12); headerRows=2; staticCols=@(0); blankFirstRows=@(2,3,4,7); chapter="第三章 项目市场分析"; match=@("项目定价分析","周边租金调研")},
  @{id="rent-regional-projects"; title="区域运营租赁住房表"; tables=@(13); headerRows=1; staticCols=@(0); chapter="第三章 项目市场分析"; match=@("周边保障性租赁住房项目租金分析")},
  @{id="rent-occupancy-benchmark"; title="保障性租赁住房出租率汇总表"; tables=@(14); headerRows=1; staticCols=@(); chapter="第三章 项目市场分析"; match=@("出租率分析")},
  @{id="rent-comparison-instances"; title="交易实例表"; tables=@(17); headerRows=1; staticCols=@(0); chapter="第五章 项目定位与建设规模"; match=@("价格定位","住宅租金")},
  @{id="rent-comparison-factors"; title="比较因素条件说明表"; tables=@(18); headerRows=1; staticCols=@(0,1); chapter="第五章 项目定位与建设规模"; match=@("价格定位","住宅租金")},
  @{id="rent-comparison-index"; title="比较因素条件修正指数表"; tables=@(19); headerRows=1; staticCols=@(0,1); chapter="第五章 项目定位与建设规模"; match=@("价格定位","住宅租金")},
  @{id="rent-price-result"; title="所选案例租金汇总表"; tables=@(20); headerRows=1; staticCols=@(0); blankFirstRows=@(1,2,3,6); chapter="第五章 项目定位与建设规模"; match=@("价格定位","住宅租金")},
  @{id="rent-site-indicators"; title="总图指标表"; tables=@(22); headerRows=1; staticCols=@(0,1,3); chapter="第七章 规划建筑方案建议"; match=@("总平面布置","总图指标","景观和绿化设计")},
  @{id="rent-construction-schedule"; title="项目开发建设进度计划表"; tables=@(23); headerRows=2; staticCols=@(0,1); blankHeaderFromCol=2; chapter="第九章 项目招投标及实施进度安排"; match=@("项目实施进度")},
  @{id="rent-residual-method"; title="剩余法测算表"; tables=@(24); headerRows=1; staticCols=@(0,1,2); chapter="第十章 投资估算与资金筹措"; match=@("投资估算")},
  @{id="rent-land-price"; title="项目地价计算表"; tables=@(25); headerRows=1; staticCols=@(0); chapter="第十章 投资估算与资金筹措"; match=@("投资估算")},
  @{id="rent-building-standard"; title="住房建设标准与造价标准"; tables=@(26); headerRows=2; staticCols=@(0,1,2,3,4,5,6); preserveAll=$true; chapter="第十章 投资估算与资金筹措"; match=@("投资估算")},
  @{id="rent-investment-estimate"; title="投资估算表"; tables=@(27); headerRows=1; staticCols=@(0,1,2,4); chapter="第十章 投资估算与资金筹措"; match=@("投资估算")},
  @{id="rent-total-investment-summary"; title="总投资估算汇总表"; tables=@(28); headerRows=1; staticCols=@(0,1); chapter="第十章 投资估算与资金筹措"; match=@("投资估算汇总")},
  @{id="rent-funding-plan"; title="资金筹措表"; tables=@(29); headerRows=1; staticCols=@(0,1); chapter="第十章 投资估算与资金筹措"; match=@("资金筹措")},
  @{id="rent-tax-reference"; title="房地产租赁运营所涉及的主要税费"; tables=@(31); headerRows=1; staticCols=@(0,1,2); preserveAll=$true; chapter="第十一章 财务评价"; match=@("税费","财务评价基础数据和假设")},
  @{id="rent-operating-cost-reference"; title="出租运营费用取值基数和费率"; tables=@(32); headerRows=1; staticCols=@(0,1,2); preserveAll=$true; chapter="第十一章 财务评价"; match=@("运营费用")},
  @{id="rent-depreciation"; title="固定资产折旧表"; tables=@(33); headerRows=1; staticCols=@(0); chapter="第十一章 财务评价"; match=@("折旧和摊销")},
  @{id="rent-sensitivity"; title="敏感性分析表"; tables=@(34); headerRows=1; staticCols=@(0); chapter="第十一章 财务评价"; match=@("敏感性分析")},
  @{id="rent-appendix-investment"; title="附表1：总投资估算表"; tables=@(36); headerRows=1; staticCols=@(0,1,2,4); appendix=$true; chapter="附表"; match=@("附表")},
  @{id="rent-appendix-income-tax"; title="附表2：经营收入与营业税金及附加表"; tables=@(37,38,39,40,41,42); headerRows=1; staticCols=@(0,1); blankHeaderFromCol=2; appendix=$true; longPeriod=$true; chapter="附表"; match=@("附表")},
  @{id="rent-appendix-debt"; title="附表3：还本付息表"; tables=@(43,44); headerRows=1; staticCols=@(0,1); blankHeaderFromCol=2; appendix=$true; longPeriod=$true; chapter="附表"; match=@("附表")},
  @{id="rent-appendix-profit"; title="附表4：损益表"; tables=@(45,46,47,48,49,50); headerRows=1; staticCols=@(0,1); blankHeaderFromCol=2; appendix=$true; longPeriod=$true; chapter="附表"; match=@("附表")},
  @{id="rent-appendix-equity-cashflow"; title="附表5：资本金现金流量表"; tables=@(51,52,53,54,55,56,57); headerRows=1; staticCols=@(0,1); blankHeaderFromCol=2; appendix=$true; longPeriod=$true; chapter="附表"; match=@("附表")},
  @{id="rent-appendix-adjusted-profit"; title="附表6：调整损益表"; tables=@(58,59,60,61,62,63); headerRows=1; staticCols=@(0,1); blankHeaderFromCol=2; appendix=$true; longPeriod=$true; chapter="附表"; match=@("附表")},
  @{id="rent-appendix-project-cashflow"; title="附表7：全投资现金流量表"; tables=@(64,65,66,67,68,69,70); headerRows=1; staticCols=@(0,1); blankHeaderFromCol=2; appendix=$true; longPeriod=$true; chapter="附表"; match=@("附表")}
)

function Get-Attr($node, [string]$name) {
  if(-not $node){ return $null }
  return $node.GetAttribute($name, 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
}

$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $SourceDocx))
try {
  $entry = $zip.GetEntry('word/document.xml')
  if(-not $entry){ throw 'DOCX中缺少 word/document.xml' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $ns = [Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
  $tables = $xml.SelectNodes('//w:tbl',$ns)

  $result = [ordered]@{
    schemaVersion = 1
    setId = 'report-table-templates-rent-v1'
    name = '出租类可研标准表格模板库（创景苑1:1结构）'
    projectType = 'rent'
    version = 1
    source = [ordered]@{
      fileName = [IO.Path]::GetFileName($SourceDocx)
      physicalTableCount = $tables.Count
      logicalTemplateCount = $definitions.Count
      mappedPhysicalTableCount = 61
      excludedPhysicalTables = @(
        [ordered]@{numbers=@(1,2); reason='封面及编制人员信息表，不属于正文业务表模板'},
        [ordered]@{numbers=@(6,7,15,16,21,30); reason='与已收录模板结构重复，仅出现于不同章节位置'},
        [ordered]@{numbers=@(35); reason='与财务分析汇总结构重复，由测算引擎输出'}
      )
      note = '项目专属数据已置空；保留表头、行项目、单位、合并关系和原Word分段方式。'
    }
    templates = @()
  }

  foreach($def in $definitions){
    $template = [ordered]@{
      id = $def.id; title = $def.title; projectType = 'rent'; version = 1
      chapter = $def.chapter; match = @($def.match)
      appendix = [bool]$def.appendix; longPeriod = [bool]$def.longPeriod
      sourceTableNumbers = @($def.tables); segments = @()
    }
    foreach($number in $def.tables){
      $table = $tables[$number-1]
      if(-not $table){ throw "找不到源表 $number" }
      $gridWidths = @($table.SelectNodes('./w:tblGrid/w:gridCol',$ns) | ForEach-Object { [int](Get-Attr $_ 'w') })
      $segment = [ordered]@{ sourceTableNumber=$number; gridWidths=$gridWidths; rows=@() }
      $rowIndex = 0
      foreach($tr in $table.SelectNodes('./w:tr',$ns)){
        $cells=@(); $col=0
        foreach($tc in $tr.SelectNodes('./w:tc',$ns)){
          $spanNode=$tc.SelectSingleNode('./w:tcPr/w:gridSpan',$ns)
          $span=if($spanNode){[int](Get-Attr $spanNode 'val')}else{1}
          $vNode=$tc.SelectSingleNode('./w:tcPr/w:vMerge',$ns)
          $vMerge=''
          if($vNode){$v=Get-Attr $vNode 'val';$vMerge=if($v -eq 'restart'){'restart'}else{'continue'}}
          $text=(($tc.SelectNodes('.//w:t',$ns)|ForEach-Object{$_.InnerText}) -join '') -replace '\s+',' '
          $keep = [bool]$def.preserveAll -or ($rowIndex -lt [int]$def.headerRows) -or (@($def.staticCols) -contains $col)
          if($rowIndex -lt [int]$def.headerRows -and $null -ne $def.blankHeaderFromCol -and $col -ge [int]$def.blankHeaderFromCol){$keep=$false}
          if(@($def.blankFirstRows) -contains $rowIndex -and $col -eq 0){$keep=$false}
          if(-not $keep){$text=''}
          $shadeNode=$tc.SelectSingleNode('./w:tcPr/w:shd',$ns)
          $fill=if($shadeNode){Get-Attr $shadeNode 'fill'}else{''}
          $alignNode=$tc.SelectSingleNode('.//w:pPr/w:jc',$ns)
          $align=if($alignNode){Get-Attr $alignNode 'val'}else{''}
          $cells += [ordered]@{ text=$text.Trim(); col=$col; colSpan=$span; vMerge=$vMerge; fill=$fill; align=$align; role=if($keep){'static'}else{'value'} }
          $col += $span
        }
        $segment.rows += ,([ordered]@{cells=$cells})
        $rowIndex++
      }
      $template.segments += ,$segment
    }
    $result.templates += ,$template
  }

  $target = Join-Path (Get-Location) $OutputPath
  $dir = Split-Path -Parent $target
  if(-not (Test-Path -LiteralPath $dir)){ New-Item -ItemType Directory -Path $dir | Out-Null }
  # 运行时模板保留完全相同的数据结构，只去掉缩进和换行。
  # 这样浏览器、后台编辑和Word导出无需任何适配，同时避免大型Word表格被
  # PowerShell的美化JSON放大近十倍。需要人工审阅时可临时格式化，不把
  # 格式化副本作为运行时资产提交。
  $json = $result | ConvertTo-Json -Depth 20 -Compress
  [IO.File]::WriteAllText($target, $json, [Text.UTF8Encoding]::new($false))
  $bytes = [IO.FileInfo]::new($target).Length
  Write-Output "已生成 $target：$($definitions.Count)套逻辑模板，源物理表$($tables.Count)张，紧凑存储${bytes}字节。"
} finally {
  $zip.Dispose()
}
