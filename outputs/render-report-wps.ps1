param([string]$InputDocx,[string]$OutputPdf)
$ErrorActionPreference = 'Stop'
$taskInput = (Resolve-Path -LiteralPath $InputDocx).Path
$taskPdf = [System.IO.Path]::GetFullPath($OutputPdf)
if (!(Test-Path -LiteralPath $taskInput)) { throw 'Missing report' }
$taskApp = New-Object -ComObject kwps.Application
$taskDocument = $null
try {
  $taskApp.Visible = $false
  $taskApp.DisplayAlerts = 0
  $taskDocument = $taskApp.Documents.Open($taskInput, $false, $true)
  $taskDocument.Repaginate()
  $taskPages = $taskDocument.ComputeStatistics(2)
  $taskDocument.ExportAsFixedFormat($taskPdf, 17)
  [pscustomobject]@{pages=$taskPages;tables=$taskDocument.Tables.Count;pdf=$taskPdf} | ConvertTo-Json -Compress
} finally {
  if ($null -ne $taskDocument) { $taskDocument.Close(0) }
  $taskApp.Quit()
}
