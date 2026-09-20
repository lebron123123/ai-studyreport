param([Parameter(Mandatory=$true)][string]$InputDocx)
$ErrorActionPreference = 'Stop'
$reportApp = $null
$reportDocument = $null
try {
  $reportApp = New-Object -ComObject kwps.Application
  $reportApp.Visible = $false
  $reportApp.DisplayAlerts = 0
  $reportDocument = $reportApp.Documents.Open($InputDocx, $false, $true)
  $reportDocument.Repaginate()
  Write-Output $reportDocument.ComputeStatistics(2)
} finally {
  if ($null -ne $reportDocument) { $reportDocument.Close(0) }
  if ($null -ne $reportApp) { $reportApp.Quit() }
}
