param(
  [Parameter(Mandatory=$true)][string]$SourceDocx,
  [Parameter(Mandatory=$true)][ValidateSet('housing_conversion','commercial_renovation')][string]$Scenario,
  [Parameter(Mandatory=$true)][string]$OutputPath
)

$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-Attr($node,[string]$name){if(!$node){return ''};return $node.GetAttribute($name,'http://schemas.openxmlformats.org/wordprocessingml/2006/main')}

$housing=@(
  @('项目核心指标汇总表','第一章 项目总论',@('项目概况')),
  @('改建条件可行性研判表','第一章 项目总论',@('项目概况','改建条件')),
  @('现状问题诊断及利旧评估表','第六章 改造升级策略及效果',@('项目总体改造升级建议','项目概况')),
  @('区域住房市场供需分析表','第三章 项目市场分析',@('区住房市场分析','住房市场分析')),
  @('竞品对比分析表','第三章 项目市场分析',@('项目周边市场分析','竞品分析')),
  @('客群画像分析表','第五章 项目策划定位',@('客群画像分析','客群画像')),
  @('户型配比及得房率表','第六章 改造升级策略及效果',@('项目总体改造升级建议','户型设计')),
  @('改造内容及成本分摊表','第六章 改造升级策略及效果',@('项目总体改造升级建议','投资估算')),
  @('投资估算汇总表','第九章 投资估算与资金筹措',@('投资估算')),
  @('资金筹措表','第九章 投资估算与资金筹措',@('资金筹措')),
  @('财务评价指标表','第十章 财务评价',@('财务评价')),
  @('实施进度计划表','第八章 项目管理和实施进度计划',@('项目实施进度计划','实施进度')),
  @('风险分析及对策表','第十二章 项目风险分析及对策',@('项目风险分析及对策','风险分析')),
  @('社会效益分析表','第十一章 社会效益评价',@('社会效益评价','社会效益'))
)
$commercial=@(
  @('项目核心指标汇总表','第一章 项目总论',@('项目概况')),
  @('经营现状及趋势分析表','第二章 项目建设必要性',@('遏制经营下滑态势','经营现状','经营情况')),
  @('收益分成规则表（如涉及超额分成模式）','第一章 项目总论',@('项目概况','合作模式','收益分配机制','财务评价')),
  @('区域商业市场供需分析表','第三章 项目市场分析',@('商业市场分析','市场供需')),
  @('区域商业项目列表','第三章 项目市场分析',@('商业市场分析','商业市场格局')),
  @('商业竞品对比分析表','第三章 项目市场分析',@('项目周边商业市场分析','街道商业市场分析','竞品分析')),
  @('商业租金水平研究表','第三章 项目市场分析',@('项目周边商业市场分析','街道商业市场分析','租金水平研究')),
  @('租期免租期标准表','第五章 项目策划定位',@('商业价格定位','价格定位')),
  @('大宗租赁成交案例表','第三章 项目市场分析',@('项目周边商业市场分析','街道商业市场分析','租金水平研究')),
  @('消费者研究/客群画像表','第五章 项目策划定位',@('消费者研究','客群画像')),
  @('商业业态规划及配比表','第五章 项目策划定位',@('商业业态定位','产品定位','运营策略')),
  @('商业价值评分及租金定位表','第五章 项目策划定位',@('商业价格定位','价格定位')),
  @('改造内容及成本明细表','第六章 改造升级策略及效果',@('项目总体改造升级建议','改造升级')),
  @('投资估算汇总表','第九章 投资估算与资金筹措',@('投资估算')),
  @('资金筹措表','第九章 投资估算与资金筹措',@('资金筹措')),
  @('经营收入测算表（改造前/改造后对比）','第十章 财务评价',@('盈利能力分析','经营收入分析')),
  @('集团收入对比表（改造前/改造后）','第十章 财务评价',@('财务评价','集团收入')),
  @('财务评价指标表','第十章 财务评价',@('财务评价')),
  @('敏感性分析表','第十章 财务评价',@('不确定性分析','敏感性分析')),
  @('实施进度计划表','第八章 项目管理和实施进度计划',@('项目实施进度计划','实施进度')),
  @('风险分析及对策表','第十二章 项目风险分析及对策',@('项目风险分析及对策','风险分析')),
  @('社会效益分析表','第十一章 社会效益评价',@('社会效益评价','社会效益'))
)
$definitions=if($Scenario -eq 'housing_conversion'){$housing}else{$commercial}
$prefix=if($Scenario -eq 'housing_conversion'){'gaibao-housing'}else{'gaibao-commercial'}
$label=if($Scenario -eq 'housing_conversion'){'非居改保（住房改造）'}else{'商业改造（自持改造）'}

$zip=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $SourceDocx))
try{
  $entry=$zip.GetEntry('word/document.xml');if(!$entry){throw 'DOCX中缺少 word/document.xml'}
  $reader=[IO.StreamReader]::new($entry.Open());try{[xml]$xml=$reader.ReadToEnd()}finally{$reader.Dispose()}
  $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
  $tables=$xml.SelectNodes('//w:tbl',$ns);if($tables.Count -ne $definitions.Count){throw "源Word表格数量$($tables.Count)与定义数量$($definitions.Count)不一致"}
  $result=[ordered]@{schemaVersion=1;setId="report-table-templates-$prefix-v1";name="$label 可研标准表格模板库";projectType=$prefix;businessScenario=$Scenario;version=1;source=[ordered]@{fileName=[IO.Path]::GetFileName($SourceDocx);physicalTableCount=$tables.Count;logicalTemplateCount=$definitions.Count;note='完整保留源Word表头、行列、合并关系和列宽；空白格由项目材料、数据接口或测算引擎填充。'};templates=@()}
  for($i=0;$i -lt $tables.Count;$i++){
    $def=$definitions[$i];$table=$tables[$i];$segment=[ordered]@{sourceTableNumber=$i+1;gridWidths=@($table.SelectNodes('./w:tblGrid/w:gridCol',$ns)|ForEach-Object{[int](Get-Attr $_ 'w')});rows=@()};$ri=0
    foreach($tr in $table.SelectNodes('./w:tr',$ns)){
      $cells=@();$col=0
      foreach($tc in $tr.SelectNodes('./w:tc',$ns)){
        $spanNode=$tc.SelectSingleNode('./w:tcPr/w:gridSpan',$ns);$span=if($spanNode){[int](Get-Attr $spanNode 'val')}else{1}
        $vNode=$tc.SelectSingleNode('./w:tcPr/w:vMerge',$ns);$vMerge='';if($vNode){$v=Get-Attr $vNode 'val';$vMerge=if($v -eq 'restart'){'restart'}else{'continue'}}
        $text=((($tc.SelectNodes('.//w:t',$ns)|ForEach-Object{$_.InnerText})-join '') -replace '\s+',' ').Trim()
        $shade=$tc.SelectSingleNode('./w:tcPr/w:shd',$ns);$align=$tc.SelectSingleNode('.//w:pPr/w:jc',$ns)
        $role=if($ri -eq 0 -or $text){'static'}else{'value'}
        $cells += [ordered]@{text=$text;col=$col;colSpan=$span;vMerge=$vMerge;fill=if($shade){Get-Attr $shade 'fill'}else{''};align=if($align){Get-Attr $align 'val'}else{''};role=$role};$col+=$span
      }
      $segment.rows+=,([ordered]@{cells=$cells});$ri++
    }
    $result.templates+=,([ordered]@{id=("$prefix-table-{0:d2}" -f ($i+1));title=$def[0];projectType=$prefix;businessScenario=$Scenario;version=1;chapter=$def[1];match=@($def[2]);placement="按源Word标注放置于$($def[1])的相关小节";appendix=$false;longPeriod=$false;sourceTableNumbers=@($i+1);segments=@($segment)})
  }
  $target=Join-Path (Get-Location) $OutputPath;$dir=Split-Path -Parent $target;if(!(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir|Out-Null}
  [IO.File]::WriteAllText($target,($result|ConvertTo-Json -Depth 20 -Compress),[Text.UTF8Encoding]::new($false));Write-Output "已生成 $target：$($definitions.Count)套模板。"
}finally{$zip.Dispose()}
