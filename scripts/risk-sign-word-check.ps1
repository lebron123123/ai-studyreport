param([string[]]$Kinds = @('draft','approved'))
$ErrorActionPreference = 'Stop'
foreach ($riskKind in $Kinds) {
  $riskWord = New-Object -ComObject Word.Application
  $riskWord.Visible = $false
  $riskWord.DisplayAlerts = 0
  try {
    $riskInput = (Resolve-Path -LiteralPath "outputs/0909-risk-sign-$riskKind.docx").Path
    $riskDoc = $riskWord.Documents.Open($riskInput, $false, $true)
    try {
      $riskPdf = [IO.Path]::ChangeExtension($riskInput, '.pdf')
      $riskDoc.ExportAsFixedFormat($riskPdf, 17)
      Write-Output "$riskKind pages=$($riskDoc.ComputeStatistics(2))"
    } finally { $riskDoc.Close(0) }
  } finally { try { $riskWord.Quit() } catch { Write-Warning ('Word cleanup: '+$_.Exception.Message) } }
}
