param(
  [string]$Version = '156.0.1',
  [string]$WorkDir = 'C:\opium-build',
  [ValidateSet('all', 'fetch', 'prepare', 'bootstrap', 'build', 'package')]
  [string]$Step = 'all'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$engine = Join-Path $WorkDir 'engine'
$tarball = Join-Path $WorkDir 'firefox-source.tar.xz'
$enginePosix = '/' + ($engine -replace ':', '' -replace '\\', '/').ToLower()
$dist = Join-Path $root 'dist'

if ($WorkDir -match ' ') { throw "WorkDir darf keine Leerzeichen enthalten: $WorkDir" }
if (-not (Test-Path 'C:\mozilla-build\start-shell.bat')) {
  New-Item -ItemType Directory -Force $WorkDir | Out-Null
  Invoke-WebRequest 'https://ftp.mozilla.org/pub/mozilla/libraries/win32/MozillaBuildSetup-Latest.exe' -OutFile "$WorkDir\MozillaBuildSetup.exe"
  Start-Process "$WorkDir\MozillaBuildSetup.exe" '/S' -Wait
}

function Invoke-Moz([string]$cmd) {
  $env:USE_MINTTY = '0'
  & cmd /c "C:\mozilla-build\start-shell.bat -c `"cd $enginePosix && $cmd`""
  if ($LASTEXITCODE -ne 0) { throw "Fehlgeschlagen: $cmd" }
}

function Step-Fetch {
  New-Item -ItemType Directory -Force $WorkDir | Out-Null
  $url = "https://archive.mozilla.org/pub/firefox/releases/$Version/source/firefox-$Version.source.tar.xz"
  $expected = [long](Invoke-WebRequest $url -Method Head -UseBasicParsing).Headers['Content-Length']
  $last = -1; $stall = 0
  while ((Test-Path $tarball) -and (Get-Item $tarball).Length -lt $expected) {
    $now = (Get-Item $tarball).Length
    Write-Host ("Quellcode-Download: {0:N0} / {1:N0} MB" -f ($now / 1MB), ($expected / 1MB))
    if ($now -eq $last) { $stall++ } else { $stall = 0 }
    if ($stall -ge 6) { Remove-Item $tarball -Force; break }
    $last = $now
    Start-Sleep 10
  }
  if (-not (Test-Path $tarball)) {
    Invoke-WebRequest $url -OutFile $tarball -UseBasicParsing
  }
  if (-not (Test-Path "$engine\mach")) {
    & "$env:SystemRoot\System32\tar.exe" -xf $tarball -C $WorkDir
    Rename-Item (Join-Path $WorkDir "firefox-$Version") 'engine'
    if (-not (Test-Path "$engine\mach")) { throw 'Entpacken fehlgeschlagen' }
  }
}

function Step-Prepare { python "$root\scripts\prepare.py" $engine; if ($LASTEXITCODE) { throw 'prepare fehlgeschlagen' } }
function Step-Bootstrap { Invoke-Moz './mach --no-interactive bootstrap --application-choice browser' }
function Step-Build { Invoke-Moz './mach build' }
function Step-Package {
  Invoke-Moz './mach package && ./mach build installer'
  New-Item -ItemType Directory -Force $dist | Out-Null
  Get-ChildItem "$engine\obj-opium\dist\install\sea\*.exe", "$engine\obj-opium\dist\*.zip" -ErrorAction SilentlyContinue |
    ForEach-Object {
      $name = if ($_.Extension -eq '.exe') { "Opium-$Version-setup.exe" } else { "Opium-$Version-portable.zip" }
      Copy-Item $_.FullName (Join-Path $dist $name) -Force
    }
  Get-ChildItem $dist
}

switch ($Step) {
  'fetch'     { Step-Fetch }
  'prepare'   { Step-Prepare }
  'bootstrap' { Step-Bootstrap }
  'build'     { Step-Build }
  'package'   { Step-Package }
  'all'       { Step-Fetch; Step-Prepare; Step-Bootstrap; Step-Build; Step-Package }
}
