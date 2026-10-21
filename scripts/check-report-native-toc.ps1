param([Parameter(Mandatory=$true)][string]$InputDocx,[Parameter(Mandatory=$true)][string]$OutputDocx,[string]$OutputPdf)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$source=[System.IO.Path]::GetFullPath($InputDocx)
$target=[System.IO.Path]::GetFullPath($OutputDocx)
if($source -eq $target){throw 'QA must use an independent copy.'}
Copy-Item -LiteralPath $source -Destination $target -ErrorAction Stop
$qaApp=$null;$qaDocument=$null
try {
  $qaApp=New-Object -ComObject kwps.Application
  $qaApp.DisplayAlerts=0
  $qaDocument=$qaApp.Documents.Open($target,$false,$false)
  $qaDocument.Activate()
  if($qaDocument.TablesOfContents.Count -ne 1){throw 'Expected one native TOC.'}
  $qaToc=$qaDocument.TablesOfContents.Item(1)
  $qaDocument.Repaginate()
  $beforeText=[string]$qaToc.Range.Text
  $beforePages=[int]$qaDocument.ComputeStatistics(2)
  $links=$qaToc.Range.Hyperlinks
  if($links.Count -lt 2){throw 'Native TOC must contain links to at least two headings.'}
  $jumpChecks=@()
  foreach($index in @(1,$links.Count)){
    $link=$links.Item($index)
    $anchor=[string]$link.SubAddress
    if(-not $qaDocument.Bookmarks.Exists($anchor)){throw 'TOC link target is missing.'}
    $link.Range.Select()
    $selectionBefore=[int]$qaApp.Selection.Range.Start
    $scrollBefore=[int]$qaApp.ActiveWindow.VerticalPercentScrolled
    $link.Follow()
    $destination=$qaDocument.Bookmarks.Item($anchor).Range
    $selectionStart=[int]$qaApp.Selection.Range.Start
    $jumpChecks+=@{anchor=$anchor;page=[int]$destination.Information(3);title=([string]$destination.Text).Trim();selectionBefore=$selectionBefore;selectionAfter=$selectionStart;targetStart=[int]$destination.Start;targetEnd=[int]$destination.End;scrollBefore=$scrollBefore;scrollAfter=[int]$qaApp.ActiveWindow.VerticalPercentScrolled;selectionReachedTarget=($selectionStart -ge $destination.Start -and $selectionStart -le $destination.End)}
  }
  if($OutputPdf){$qaDocument.ExportAsFixedFormat([System.IO.Path]::GetFullPath($OutputPdf),17)}
  if(-not $qaDocument.Bookmarks.Exists('_tc1')){throw 'QA needs a second chapter.'}
  $chapter=$qaDocument.Bookmarks.Item('_tc1').Range
  $pageBefore=[int]$chapter.Information(3)
  $qaStage='find-body-anchor'
  $qaBodyAnchor=$qaDocument.Bookmarks.Item('_rp_end_0_0').Range.End
  $insertion=$qaDocument.Range($qaBodyAnchor,$qaBodyAnchor)
  $qaPadding=(' [System test] Independent QA pagination paragraph.'+[char]13)*100
  $qaStage='insert-body'
  $insertion.InsertAfter($qaPadding)
  $qaStage='body-style'
  $qaDocument.Range($qaBodyAnchor,$qaBodyAnchor+$qaPadding.Length).Style=$qaDocument.Styles.Item(-1)
  $qaStage='body-outline'
  $qaDocument.Range($qaBodyAnchor,$qaBodyAnchor+$qaPadding.Length).ParagraphFormat.OutlineLevel=10
  $qaStage='repaginate-inserted'
  $qaDocument.Repaginate()
  $insertedPages=[int]$qaDocument.ComputeStatistics(2)
  $insertedChapterPage=[int]$qaDocument.Bookmarks.Item('_tc1').Range.Information(3)
  if($insertedPages -le $beforePages -or $insertedChapterPage -le $pageBefore){throw ('QA insertion did not increase pagination: pages '+$beforePages+' -> '+$insertedPages+'; chapter '+$pageBefore+' -> '+$insertedChapterPage)}
  $qaDocument.Repaginate()
  $qaStage='update-toc'
  $null=$qaToc.Update()
  $qaDocument.Repaginate()
  $null=$qaToc.UpdatePageNumbers()
  $qaDocument.Repaginate()
  $afterPages=[int]$qaDocument.ComputeStatistics(2)
  $pageAfter=[int]$qaDocument.Bookmarks.Item('_tc1').Range.Information(3)
  $afterText=[string]$qaToc.Range.Text
  if($afterPages -le $beforePages -or $pageAfter -le $pageBefore -or $afterText -eq $beforeText){throw ('Native TOC did not refresh: pages '+$beforePages+' -> '+$afterPages+'; chapter '+$pageBefore+' -> '+$pageAfter+'; equalText='+($afterText -eq $beforeText))}
  $qaStage='save-updated'
  $qaDocument.Save()
  $hyperlinkCount=[int]$links.Count
  $qaDocument.Close(0)
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($qaDocument)
  $qaStage='reopen-updated'
  $qaDocument=$qaApp.Documents.Open($target,$false,$false)
  if($qaDocument.TablesOfContents.Count -ne 1 -or [string]$qaDocument.TablesOfContents.Item(1).Range.Text -ne $afterText){throw 'Updated native TOC did not survive reopening.'}
  $null=$qaDocument.TablesOfContents.Item(1).UpdatePageNumbers()
  $qaDocument.Save()
  @{nativeTocCount=1;hyperlinks=$hyperlinkCount;jumps=$jumpChecks;jumpsPassed=(@($jumpChecks|Where-Object{-not $_.selectionReachedTarget}).Count -eq 0);beforePages=$beforePages;afterPages=$afterPages;secondChapterBefore=$pageBefore;secondChapterAfter=$pageAfter;updatedAfterEdit=$true;reopenedAndUpdated=$true;output=$target;originalPdf=$OutputPdf}|ConvertTo-Json -Depth 8 -Compress
} catch {
  throw ('Native TOC QA stage='+$qaStage+'; '+$_.Exception.Message+'; '+$_.ScriptStackTrace)
} finally {
  if($null -ne $qaDocument){$qaDocument.Close(0)}
  if($null -ne $qaDocument){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($qaDocument)}
  if($null -ne $qaApp){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($qaApp)}
}
