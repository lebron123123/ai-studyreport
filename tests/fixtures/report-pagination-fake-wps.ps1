param([string]$Script,[string]$Directory,[string]$Mode='success',[switch]$WithPdf,[switch]$WithoutPrepared)
$ErrorActionPreference = 'Stop'
$global:reportMockCalls = [System.Collections.Generic.List[string]]::new()
$global:reportMockMode = $Mode
$global:reportMockExported = $false
$global:reportMockWriter = $null
$global:reportMockLegacyReadBlocked = $false
$global:reportMockPrepared = Join-Path $Directory 'prepared.docx'
$reportMockInput = Join-Path $Directory 'input.docx'
[System.IO.File]::WriteAllText($reportMockInput,'caller source remains unchanged')
$reportMockToc = [pscustomobject]@{}
$reportMockToc | Add-Member ScriptMethod Update { $global:reportMockCalls.Add('toc-update') }
$reportMockToc | Add-Member ScriptMethod UpdatePageNumbers { $global:reportMockCalls.Add('toc-pages') }
$reportMockTocs = [pscustomobject]@{Count=1;Toc=$reportMockToc}
$reportMockTocs | Add-Member ScriptMethod Item { param($Index) return $this.Toc }
$reportMockFields = [pscustomobject]@{}
$reportMockFields | Add-Member ScriptMethod Update { $global:reportMockCalls.Add('fields-update') }
$global:reportMockDocument = [pscustomobject]@{TablesOfContents=$reportMockTocs;Fields=$reportMockFields;Bookmarks=[pscustomobject]@{Count=0;ShowHidden=$false};Tables=[pscustomobject]@{Count=0}}
$global:reportMockDocument | Add-Member ScriptMethod Repaginate { $global:reportMockCalls.Add('repaginate') }
$global:reportMockDocument | Add-Member ScriptMethod SaveAs2 {
  param($File,$Format)
  $global:reportMockCalls.Add('save:'+$Format)
  [System.IO.File]::WriteAllText($File,'prepared exact DOCX fixture')
  if ($global:reportMockMode -in @('writer-locked','writer-locked-hash-change')) {
    # This is a real Windows sharing lock, not a simulated hash exception.
    # Like WPS, retain a writable handle that permits other readers only.
    $global:reportMockWriter = [System.IO.File]::Open($File,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::Read)
    try {
      $reportLegacyReader = [System.IO.File]::OpenRead($File)
      $reportLegacyReader.Dispose()
    } catch [System.IO.IOException] { $global:reportMockLegacyReadBlocked = $true }
    if (-not $global:reportMockLegacyReadBlocked) { throw 'Fixture did not reproduce the real Windows writer lock' }
  }
}
$global:reportMockDocument | Add-Member ScriptMethod ComputeStatistics {
  param($Statistic)
  $global:reportMockCalls.Add('pages:'+$Statistic)
  if ($global:reportMockExported -and $global:reportMockMode -eq 'page-change') { return 121 }
  return 120
}
$global:reportMockDocument | Add-Member ScriptMethod ExportAsFixedFormat {
  param($File,$Format)
  $global:reportMockCalls.Add('pdf:'+$Format)
  $global:reportMockExported = $true
  if ($global:reportMockMode -eq 'pdf-error') { throw 'fake export failure' }
  if ($global:reportMockMode -eq 'empty-pdf') { [System.IO.File]::WriteAllText($File,'');return }
  [System.IO.File]::WriteAllText($File,"%PDF-1.7`nfake rendered fixture`n%%EOF")
  if ($global:reportMockMode -eq 'hash-change') { [System.IO.File]::AppendAllText($global:reportMockPrepared,'changed by exporter') }
  if ($global:reportMockMode -eq 'writer-locked-hash-change') {
    $reportChangedBytes = [System.Text.Encoding]::UTF8.GetBytes('changed by retained writer')
    $null = $global:reportMockWriter.Seek(0,[System.IO.SeekOrigin]::End)
    $global:reportMockWriter.Write($reportChangedBytes,0,$reportChangedBytes.Length)
    $global:reportMockWriter.Flush()
  }
}
$global:reportMockDocument | Add-Member ScriptMethod Close {
  param($Save)
  $global:reportMockCalls.Add('close-own:'+$Save)
  if ($null -ne $global:reportMockWriter) { $global:reportMockWriter.Dispose(); $global:reportMockWriter=$null }
}
$reportMockDocuments = [pscustomobject]@{Count=2}
$reportMockDocuments | Add-Member ScriptMethod Open {
  param($File,$Confirm,$ReadOnly)
  $global:reportMockCalls.Add('open-own:'+$ReadOnly)
  if ($global:reportMockMode -eq 'open-error') { throw 'fake open failure' }
  return $global:reportMockDocument
}
$global:reportMockApp = [pscustomobject]@{Documents=$reportMockDocuments;Version='fake-WPS-12'}
$global:reportMockApp | Add-Member ScriptMethod Quit { $global:reportMockCalls.Add('QUIT-USER-APP');throw 'Do not quit shared WPS' }
$global:reportMockApp | Add-Member ScriptProperty Visible { return $true } { param($Value) $global:reportMockCalls.Add('CHANGE-USER-VISIBLE');throw 'Do not hide shared WPS' }
$global:reportMockApp | Add-Member ScriptProperty DisplayAlerts { return 1 } { param($Value) $global:reportMockCalls.Add('CHANGE-USER-ALERTS');throw 'Do not change shared WPS alerts' }
# Intercept every COM construction; no branch below can launch a real app.
function New-Object {
  param([Parameter(Position=0)][string]$TypeName,[Parameter(Position=1)][object[]]$ArgumentList,[string]$ComObject)
  if ($ComObject) {
    if ($ComObject -ne 'kwps.Application') { throw 'Unexpected COM request blocked' }
    $global:reportMockCalls.Add('fake-com')
    return $global:reportMockApp
  }
  return Microsoft.PowerShell.Utility\New-Object @PSBoundParameters
}
$reportMockArgs = @{InputDocx=$reportMockInput}
if (-not $WithoutPrepared) { $reportMockArgs.OutputDocx=$global:reportMockPrepared }
if ($WithPdf) { $reportMockArgs.OutputPdf=Join-Path $Directory 'prepared.pdf' }
try {
  $reportMockOutput = & $Script @reportMockArgs
  $reportMockResult = @{ok=$true;layout=($reportMockOutput | ConvertFrom-Json)}
} catch { $reportMockResult = @{ok=$false;error=$_.Exception.Message} }
finally { if ($null -ne $global:reportMockWriter) { $global:reportMockWriter.Dispose(); $global:reportMockWriter=$null } }
$reportMockResult.calls = @($global:reportMockCalls.ToArray())
$reportMockResult.legacyReadBlocked = $global:reportMockLegacyReadBlocked
$reportMockResult.inputText = [System.IO.File]::ReadAllText($reportMockInput)
$reportMockResult | ConvertTo-Json -Depth 12 -Compress
