param([Parameter(Mandatory=$true)][string]$InputDocx,[Parameter(Mandatory=$true)][string]$OutputPdf)
$ErrorActionPreference='Stop'
$reportApp=$null
$reportDoc=$null
try {
 $reportApp=New-Object -ComObject kwps.Application
 $reportApp.Visible=$false
 $reportApp.DisplayAlerts=0
 $reportDoc=$reportApp.Documents.Open((Resolve-Path -LiteralPath $InputDocx).Path,$false,$true)
 $reportDoc.Repaginate()
 $reportPages=$reportDoc.ComputeStatistics(2)
 $reportDoc.ExportAsFixedFormat([System.IO.Path]::GetFullPath($OutputPdf),17)
 Write-Output "Rendered pages: $reportPages"
} finally {
 if($null -ne $reportDoc){$reportDoc.Close(0)}
 if($null -ne $reportApp){$reportApp.Quit()}
}
