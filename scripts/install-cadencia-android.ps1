param(
  [string]$ApkPath = "",
  [string]$ApkUrl = "",
  [string]$ExpectedSha256 = "1CFE9D6FC1E328C2E5E0D80B21F34A87E584B45CEF1C6974877B844665AB7300",
  [string]$PackageName = "com.cadencia.app"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $current = Split-Path -Parent $PSScriptRoot
  return (Resolve-Path -LiteralPath $current).Path
}

function Find-Adb {
  $candidates = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe",
    "C:\Users\Gabriel\Desktop\Cadencia\.tools\android-sdk\platform-tools\adb.exe",
    "C:\Users\Gabriel\Desktop\FBmaniaco v1\.tools\android-sdk\platform-tools\adb.exe",
    "C:\Users\Gabriel\Desktop\TapalpaDamus\.tools\android-sdk\platform-tools\adb.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $pathAdb = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($pathAdb) {
    return $pathAdb.Source
  }

  throw "No encontre adb.exe. Instala Android Platform Tools o deja el SDK en .tools/android-sdk/platform-tools."
}

function Get-ConnectedDevice {
  param([string]$Adb)

  & $Adb start-server | Out-Null
  $lines = & $Adb devices
  $devices = @()

  foreach ($line in $lines) {
    if ($line -match "^(\S+)\s+(device|unauthorized|offline)$") {
      $devices += [pscustomobject]@{
        Id = $matches[1]
        State = $matches[2]
      }
    }
  }

  if ($devices.Count -eq 0) {
    throw "No veo ningun telefono conectado. Conecta el celular por USB, activa Depuracion USB y acepta el aviso en el telefono."
  }

  $ready = $devices | Where-Object { $_.State -eq "device" } | Select-Object -First 1
  if (-not $ready) {
    throw "El telefono aparece como '$($devices[0].State)'. Desbloquealo y acepta la autorizacion de Depuracion USB."
  }

  return $ready.Id
}

function Ensure-Apk {
  param(
    [string]$Url,
    [string]$ExpectedHash,
    [string]$OutputPath
  )

  $needsDownload = $true
  if (Test-Path -LiteralPath $OutputPath) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath).Hash
    $needsDownload = $hash -ne $ExpectedHash
  }

  if ($needsDownload) {
    if (-not $Url) {
      throw "No encontre el APK esperado en $OutputPath."
    }

    New-Item -ItemType Directory -Force (Split-Path -Parent $OutputPath) | Out-Null
    Invoke-WebRequest -Uri $Url -OutFile $OutputPath
  }

  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath).Hash
  if ($actualHash -ne $ExpectedHash) {
    throw "El APK descargado no coincide con el hash esperado. No lo voy a instalar."
  }

  return (Resolve-Path -LiteralPath $OutputPath).Path
}

function Install-Apk {
  param(
    [string]$Adb,
    [string]$Device,
    [string]$Apk,
    [string]$Package
  )

  $installOutput = & $Adb -s $Device install -r --no-streaming $Apk 2>&1
  if ($LASTEXITCODE -eq 0) {
    return $installOutput
  }

  $text = $installOutput -join "`n"
  if ($text -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match") {
    & $Adb -s $Device uninstall $Package | Out-Null
    $installOutput = & $Adb -s $Device install --no-streaming $Apk 2>&1
    if ($LASTEXITCODE -eq 0) {
      return $installOutput
    }
  }

  throw $text
}

$repoRoot = Resolve-RepoRoot
if (-not $ApkPath) {
  $ApkPath = Join-Path $repoRoot ".tools\apk-audit\cadencia-sideload-v15-meta-domain.apk"
}
$adb = Find-Adb
$apk = Ensure-Apk -Url $ApkUrl -ExpectedHash $ExpectedSha256 -OutputPath $ApkPath
$device = Get-ConnectedDevice -Adb $adb

Write-Host "Instalando Cadencia por USB en $device..."
Install-Apk -Adb $adb -Device $device -Apk $apk -Package $PackageName | Out-Host

& $adb -s $device shell monkey -p $PackageName 1 | Out-Null
Write-Host "Listo. Cadencia quedo instalada y se intento abrir en el telefono."
