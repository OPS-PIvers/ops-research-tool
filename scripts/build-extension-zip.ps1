<#
  Build (and optionally version-bump) the Chrome extension zip for Chrome Web
  Store upload.

  Usage (from anywhere):
    powershell -ExecutionPolicy Bypass -File scripts\build-extension-zip.ps1
    powershell -ExecutionPolicy Bypass -File scripts\build-extension-zip.ps1 -Bump

  -Bump increments the manifest's patch version (e.g. 0.1.0 -> 0.1.1) BEFORE
  building — use it for every Web Store update, since Chrome rejects a re-upload
  that doesn't raise the version.

  Output: extension\dist\ops-research-tool-v<version>.zip (gitignored). The zip
  has manifest.json at the ROOT, excludes dist\ and vendor\README.md, and uses
  forward-slash entry paths (Web Store-safe). Re-zip with the SAME version any
  time to refresh the artifact; bump only when you're about to publish.
#>
param([switch]$Bump)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot     = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$src          = Join-Path $repoRoot 'extension'
$manifestPath = Join-Path $src 'manifest.json'

# Read (and optionally bump) the version via a targeted regex so the manifest's
# exact formatting is preserved (ConvertTo-Json would reflow the whole file).
$manifestText = Get-Content $manifestPath -Raw
$m = [regex]::Match($manifestText, '"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"')
if (-not $m.Success) { throw "No semantic version found in $manifestPath" }
$maj = [int]$m.Groups[1].Value; $min = [int]$m.Groups[2].Value; $pat = [int]$m.Groups[3].Value

if ($Bump) {
  $pat++
  $newVer = "$maj.$min.$pat"
  $manifestText = $manifestText.Substring(0, $m.Index) + ('"version": "' + $newVer + '"') + $manifestText.Substring($m.Index + $m.Length)
  [System.IO.File]::WriteAllText($manifestPath, $manifestText)
  Write-Output ("Bumped manifest version -> " + $newVer + " (commit this change).")
}
$ver = "$maj.$min.$pat"

$distDir = Join-Path $src 'dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$zipPath = Join-Path $distDir ("ops-research-tool-v" + $ver + ".zip")
if ([System.IO.File]::Exists($zipPath)) { [System.IO.File]::Delete($zipPath) }

$skip = 'dist/'
$files = Get-ChildItem -Path $src -Recurse -File | Where-Object {
  $rel = $_.FullName.Substring($src.Length + 1).Replace('\','/')
  ($rel -notlike ($skip + '*')) -and ($rel -ne 'vendor/README.md')
}
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    $entry = $f.FullName.Substring($src.Length + 1).Replace('\','/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry, 'Optimal') | Out-Null
  }
} finally { $zip.Dispose() }

$r = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$names = $r.Entries | ForEach-Object { $_.FullName }
$r.Dispose()
if (-not ($names -contains 'manifest.json')) { throw "manifest.json is not at the zip root!" }

Write-Output ("Built: " + $zipPath)
Write-Output ("Version " + $ver + " | " + $names.Count + " entries | " + [math]::Round((Get-Item $zipPath).Length/1KB) + " KB | manifest at root OK")
Write-Output "Upload this zip to the Chrome Web Store dev dashboard; installed users auto-update within hours."
