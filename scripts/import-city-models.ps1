param([Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$targetRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../project-map/models'))
[IO.Directory]::CreateDirectory($targetRoot) | Out-Null
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  # Only geography assets. Never execute or import bundled launchers, characters or game code.
  $names = @('landmarks.glb','landmark-detail.glb','landmark-detail.json','terrain-detail.json','LANDMARK_ATTRIBUTION.md')
  $records = @()
  foreach ($name in $names) {
    $entry = $zip.Entries | Where-Object { $_.FullName.EndsWith('/web/city/' + $name) }
    if (!$entry) { throw "Missing asset: $name" }
    $dest = Join-Path $targetRoot $name
    if (Test-Path -LiteralPath $dest) { throw "Refusing to overwrite existing asset: $dest" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest)
    $records += @{file=$name;bytes=$entry.Length;sha256=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLower()}
  }
  $manifest = Get-Content -LiteralPath (Join-Path $targetRoot 'landmark-detail.json') -Raw | ConvertFrom-Json
  if ((Get-FileHash -LiteralPath (Join-Path $targetRoot 'landmark-detail.glb') -Algorithm SHA256).Hash.ToLower() -ne $manifest.assetStats.sha256) { throw 'Model hash mismatch' }
  $entry = $zip.Entries | Where-Object { $_.FullName.EndsWith('/web/city/city.json') }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $city = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  $items = @{}
  foreach ($m in $city.landmarks) { $items[$m.id]=$m }
  foreach ($m in $manifest.landmarks) { $items[$m.id]=$m }
  $catalog = @{schemaVersion=1;origin=$city.meta.originWGS84;scale=$city.meta.horizontalScale;replacedMeshPrefixes=$manifest.replacedMeshPrefixes;assets=$records;landmarks=@($items.Values | Sort-Object id);source='linranff/GTA_SZ d61d243; user supplied exploration archive';importedAt='2026-09-13'}
  $modelIds = @()
  foreach ($file in @('landmarks.glb','landmark-detail.glb')) {
    $bytes=[IO.File]::ReadAllBytes((Join-Path $targetRoot $file))
    $gltf=[Text.Encoding]::UTF8.GetString($bytes,20,[BitConverter]::ToInt32($bytes,12)) | ConvertFrom-Json
    foreach ($node in $gltf.nodes) { if ($node.name -match '^(landmark|detail)_([^_]+)_') { $modelIds += $Matches[2] } }
  }
  $catalog.modelIds=@($modelIds | Sort-Object -Unique)
  $catalog | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $targetRoot 'catalog.json') -Encoding utf8
  Write-Output ('Imported {0} assets; {1} landmark entries' -f $records.Count,$items.Count)
} finally { $zip.Dispose() }
