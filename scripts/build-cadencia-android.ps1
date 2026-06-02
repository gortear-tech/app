param(
  [string]$ApiBaseUrl = "https://cadencia-backend.onrender.com",
  [string]$AndroidSdk = "C:\Users\Gabriel\Desktop\Cadencia\.tools\android-sdk",
  [string]$JavaHome = "C:\Users\Gabriel\Desktop\Cadencia\.tools\jdk17\jdk-17.0.19+10",
  [string]$NodeBin = "C:\Users\Gabriel\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $current = Split-Path -Parent $PSScriptRoot
  return (Resolve-Path -LiteralPath $current).Path
}

function Remove-GeneratedAndroidCache {
  param([string]$RepoRoot)

  $targets = @(
    "mobile\android\app\.cxx",
    "mobile\android\app\build",
    "mobile\android\build"
  )

  foreach ($relativePath in $targets) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $relativePath))
    if (-not $target.StartsWith($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Ruta fuera del proyecto: $target"
    }

    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }
}

$repoRoot = Resolve-RepoRoot
$credentialsPath = Join-Path $repoRoot "mobile\credentials.json"
if (-not (Test-Path -LiteralPath $credentialsPath)) {
  throw "Falta mobile\credentials.json. No puedo firmar un APK release reproducible."
}

$credentials = Get-Content -Raw -LiteralPath $credentialsPath | ConvertFrom-Json
$keystorePath = (Resolve-Path -LiteralPath (Join-Path (Join-Path $repoRoot "mobile") $credentials.android.keystore.keystorePath)).Path
$appJson = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "mobile\app.json") | ConvertFrom-Json
$versionCode = [int]$appJson.expo.android.versionCode
$outputDir = Join-Path $repoRoot ".tools\apk-audit"
$outputApk = Join-Path $outputDir "Cadencia-v$versionCode.apk"

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdk
$env:ANDROID_SDK_ROOT = $AndroidSdk
$env:NODE_ENV = "production"
$env:EXPO_PUBLIC_API_BASE_URL = $ApiBaseUrl
$env:CADENCIA_ANDROID_KEYSTORE_PATH = $keystorePath
$env:CADENCIA_ANDROID_KEYSTORE_PASSWORD = $credentials.android.keystore.keystorePassword
$env:CADENCIA_ANDROID_KEY_ALIAS = $credentials.android.keystore.keyAlias
$env:CADENCIA_ANDROID_KEY_PASSWORD = $credentials.android.keystore.keyPassword
$env:Path = "$JavaHome\bin;$AndroidSdk\platform-tools;$AndroidSdk\build-tools\36.0.0;$NodeBin;$env:Path"

Remove-GeneratedAndroidCache -RepoRoot $repoRoot

Push-Location (Join-Path $repoRoot "mobile\android")
try {
  .\gradlew.bat --no-daemon :app:assembleRelease :app:lintRelease
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "mobile\android\app\build\outputs\apk\release\app-release.apk") -Destination $outputApk -Force
Get-ChildItem -LiteralPath $outputDir -File -Include *.apk,*.idsig |
  Where-Object { $_.FullName -ne $outputApk } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputApk).Hash
Write-Host "APK: $outputApk"
Write-Host "SHA-256: $hash"
