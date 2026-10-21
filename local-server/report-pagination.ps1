param([Parameter(Mandatory=$true)][string]$InputDocx,[string]$OutputDocx,[string]$OutputPdf)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Get-ReportPaginationSha256([string]$LiteralPath) {
  $reportHashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
  $reportHashStream = $null
  try {
    # WPS keeps a writable handle after SaveAs2. Read-only access may coexist
    # with it; export still must pass the before/after hash and page checks.
    $reportHashStream = [System.IO.File]::Open($LiteralPath,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
    return [System.BitConverter]::ToString($reportHashAlgorithm.ComputeHash($reportHashStream)).Replace('-','').ToLowerInvariant()
  }
  finally { if ($null -ne $reportHashStream) { $reportHashStream.Dispose() }; $reportHashAlgorithm.Dispose() }
}
$reportApp = $null
$reportDocument = $null
$reportPdfProof = $null
if ($OutputPdf) {
  if (-not $OutputDocx) { throw 'Report PDF requires this request prepared Word document' }
  $reportPdfPath = [System.IO.Path]::GetFullPath($OutputPdf)
  if ($reportPdfPath -eq [System.IO.Path]::GetFullPath($InputDocx) -or $reportPdfPath -eq [System.IO.Path]::GetFullPath($OutputDocx) -or [System.IO.File]::Exists($reportPdfPath)) { throw 'Report PDF output must be a separate new file' }
}
try {
  $reportApp = New-Object -ComObject kwps.Application
  # COM can attach to the user's existing WPS session. Never change application
  # visibility/alerts or quit it; this request owns only the document it opens.
  $reportDocument = $reportApp.Documents.Open($InputDocx, $false, [string]::IsNullOrEmpty($OutputDocx))
  if ($OutputDocx) {
    if ($reportDocument.TablesOfContents.Count -lt 1) { throw 'Report has no native table of contents' }
    $null = $reportDocument.Fields.Update()
    for ($reportTocIndex=1; $reportTocIndex -le $reportDocument.TablesOfContents.Count; $reportTocIndex++) {
      $reportDocument.TablesOfContents.Item($reportTocIndex).Update()
    }
  }
  $reportDocument.Repaginate()
  if ($OutputDocx) {
    for ($reportTocIndex=1; $reportTocIndex -le $reportDocument.TablesOfContents.Count; $reportTocIndex++) {
      $reportDocument.TablesOfContents.Item($reportTocIndex).UpdatePageNumbers()
    }
    $reportDocument.Repaginate()
    # Save to a separate, request-local file; never overwrite the caller's source.
    $reportDocument.SaveAs2([System.IO.Path]::GetFullPath($OutputDocx),12)
  }
  $reportPages = [int]$reportDocument.ComputeStatistics(2)
  if ($OutputPdf) {
    if ($reportPages -lt 1) { throw 'Report PDF has no actual page count before export' }
    $reportPreparedPath = [System.IO.Path]::GetFullPath($OutputDocx)
    $reportPreparedHashBefore = Get-ReportPaginationSha256 $reportPreparedPath
    try { $reportDocument.ExportAsFixedFormat($reportPdfPath,17) } catch { throw ('Report PDF export failed: ' + $_.Exception.Message) }
    $reportPreparedHashAfter = Get-ReportPaginationSha256 $reportPreparedPath
    $reportPagesAfterPdf = [int]$reportDocument.ComputeStatistics(2)
    if ($reportPreparedHashBefore -ne $reportPreparedHashAfter -or $reportPagesAfterPdf -ne $reportPages) { throw 'Report PDF export changed the prepared Word document or actual page count' }
    if (-not [System.IO.File]::Exists($reportPdfPath) -or (Get-Item -LiteralPath $reportPdfPath).Length -lt 5) { throw 'Report PDF export returned no valid file' }
    $reportPdfProof = @{preparedDocumentSha256=$reportPreparedHashBefore;preparedDocumentSha256After=$reportPreparedHashAfter;pagesBeforeExport=$reportPages;pagesAfterExport=$reportPagesAfterPdf;sha256=(Get-ReportPaginationSha256 $reportPdfPath)}
  }
  $reportVersion = 'unknown'
  try { $reportVersion = [string]$reportApp.Version } catch { }
  $reportSections = New-Object System.Collections.Generic.List[object]
  $reportTables = New-Object System.Collections.Generic.List[object]
  $reportProblems = New-Object System.Collections.Generic.List[string]
  $reportSectionRanges = New-Object System.Collections.Generic.List[object]
  try {
    # Underscore-prefixed TOC bookmarks are hidden by default. Query positions
    # after actual pagination; Information(3) is the physical page number,
    # unaffected by page-number restarts in headers/footers.
    $reportDocument.Bookmarks.ShowHidden = $true
    for ($reportBookmarkIndex = 1; $reportBookmarkIndex -le $reportDocument.Bookmarks.Count; $reportBookmarkIndex++) {
      $reportBookmark = $reportDocument.Bookmarks.Item($reportBookmarkIndex)
      $reportBookmarkName = [string]$reportBookmark.Name
      if ($reportBookmarkName -notmatch '^_tc(\d+)_(\d+)$') { continue }
      $reportEndName = '_rp_end_' + $Matches[1] + '_' + $Matches[2]
      try {
        if (-not $reportDocument.Bookmarks.Exists($reportEndName)) { throw 'missing section end boundary' }
        $reportStartPosition = [int]$reportBookmark.Range.Start
        $reportEndPosition = [int]$reportDocument.Bookmarks.Item($reportEndName).Range.Start
        if ($reportEndPosition -le $reportStartPosition) { throw 'invalid section boundary' }
        $reportStartRange = $reportDocument.Range($reportStartPosition, $reportStartPosition)
        $reportEndRange = $reportDocument.Range($reportEndPosition - 1, $reportEndPosition - 1)
        $reportSections.Add(@{bookmark=$reportBookmarkName;title=([string]$reportBookmark.Range.Text).Trim();startPage=[int]$reportStartRange.Information(3);endPage=[int]$reportEndRange.Information(3)})
        $reportSectionRanges.Add(@{bookmark=$reportBookmarkName;start=$reportStartPosition;end=$reportEndPosition})
      } catch { $reportProblems.Add('Section boundary unavailable: ' + $reportBookmarkName) }
    }
  } catch { $reportProblems.Add('WPS bookmark pagination API unavailable') }
  try {
    for ($reportTableIndex = 1; $reportTableIndex -le $reportDocument.Tables.Count; $reportTableIndex++) {
      try {
        $reportTableRange = $reportDocument.Tables.Item($reportTableIndex).Range
        $reportTableStart = [int]$reportTableRange.Start
        $reportTableEnd = [int]$reportTableRange.End - 1
        $reportTableStartRange = $reportDocument.Range($reportTableStart, $reportTableStart)
        $reportTableEndRange = $reportDocument.Range($reportTableEnd, $reportTableEnd)
        $reportTableSection = $null
        foreach ($reportSectionRange in $reportSectionRanges) {
          if ($reportTableStart -ge $reportSectionRange.start -and $reportTableEnd -le $reportSectionRange.end) { $reportTableSection=$reportSectionRange.bookmark;break }
        }
        $reportTables.Add(@{index=$reportTableIndex;sectionBookmark=$reportTableSection;startPage=[int]$reportTableStartRange.Information(3);endPage=[int]$reportTableEndRange.Information(3)})
      } catch { $reportProblems.Add('Table range unavailable: ' + $reportTableIndex) }
    }
  } catch { $reportProblems.Add('WPS table pagination API unavailable') }
  $reportDiagnosticStatus = 'available'
  if ($reportProblems.Count -gt 0) { $reportDiagnosticStatus = 'partial' }
  if ($reportSections.Count -eq 0) {
    $reportProblems.Add('No verifiable report section bookmarks')
    $reportDiagnosticStatus = 'partial'
    if ($reportTables.Count -eq 0) { $reportDiagnosticStatus = 'unavailable' }
  }
  $reportLayout = @{pages=$reportPages;rendererVersion=$reportVersion;diagnostics=@{status=$reportDiagnosticStatus;sections=@($reportSections.ToArray());tables=@($reportTables.ToArray());reason=($reportProblems -join '; ')}}
  if ($null -ne $reportPdfProof) { $reportLayout.pdf = $reportPdfProof }
  $reportLayout | ConvertTo-Json -Depth 8 -Compress
} finally {
  if ($null -ne $reportDocument) { $reportDocument.Close(0) }
}
