$ErrorActionPreference = 'Stop'
$runtime = 'C:\Users\HP\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
foreach ($district in @('futian','nanshan','luohu')) {
    Write-Host "=== District $district ==="
    if (!(Test-Path "outputs/$district-source/audit/coverage.json")) {
        & $runtime scripts/extract-baoan.py --district $district
        if ($LASTEXITCODE -ne 0) { throw "Extraction failed: $district" }
    }
    if (!(Test-Path "outputs/$district-source/basemap.json")) {
        & $runtime scripts/extract-baoan-basemap.py --district $district
        if ($LASTEXITCODE -ne 0) { throw "Basemap failed: $district" }
    }
    if (!(Test-Path "project-map/$district-lod-v2/index.json")) {
        & $runtime scripts/build-baoan-lod.py --district $district
        if ($LASTEXITCODE -ne 0) { throw "Build failed: $district" }
    }
    if (!(Test-Path "project-map/$district-lod-v2/overview.glb")) {
        node scripts/build-district-overview.mjs $district
        if ($LASTEXITCODE -ne 0) { throw "Overview failed: $district" }
    }
}
