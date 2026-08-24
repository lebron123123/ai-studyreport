param(
  [Parameter(Mandatory=$true)][string]$SourcePath,
  [Parameter(Mandatory=$true)][string]$OutputDir,
  [Parameter(Mandatory=$true)][string]$Pages
)

$ErrorActionPreference = 'Stop'
$source = [System.IO.Path]::GetFullPath($SourcePath)
$output = [System.IO.Path]::GetFullPath($OutputDir)
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "PPT source not found" }
[System.IO.Directory]::CreateDirectory($output) | Out-Null
$pageNumbers = $Pages.Split(',') | ForEach-Object { [int]$_.Trim() } | Where-Object { $_ -gt 0 } | Select-Object -Unique
if (-not $pageNumbers) { throw "No slide pages requested" }

$app = $null
$presentation = $null
try {
  try { $app = New-Object -ComObject 'KWPP.Application' }
  catch { $app = New-Object -ComObject 'PowerPoint.Application' }
  $presentation = $app.Presentations.Open($source, $true, $true, $false)
  foreach ($page in $pageNumbers) {
    if ($page -gt $presentation.Slides.Count) { continue }
    $target = Join-Path $output ("slide-{0}.png" -f $page)
    $presentation.Slides.Item($page).Export($target, 'PNG', 960, 540)
  }
}
finally {
  if ($presentation) { try { $presentation.Close() } catch {} }
  if ($app) { try { $app.Quit() } catch {} }
  if ($presentation) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) }
  if ($app) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
