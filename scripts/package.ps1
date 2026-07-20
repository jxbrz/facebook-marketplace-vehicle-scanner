$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$artifactDirectory = Join-Path $root "artifacts"
$archive = Join-Path $artifactDirectory "facebook-marketplace-vehicle-scanner-v$version.zip"
$runtimeFiles = @(
  "manifest.json",
  "background.js",
  "content.js",
  "category-detector.js",
  "listing-category-pipeline.js",
  "mileage-utils.js",
  "scanner-lifecycle.js",
  "scanner-diagnostics.js",
  "scanner-runtime.js",
  "vehicle-identity.js",
  "listing-details-extractor.js",
  "payload-normalizer.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "styles.css",
  "icons",
  "README.md",
  "CHANGELOG.md",
  "STABLE_EXTENSION_ID.txt"
)

Push-Location $root
try {
  npm run validate
  New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }
  Compress-Archive -LiteralPath $runtimeFiles -DestinationPath $archive
  Write-Output "Created $archive"
} finally {
  Pop-Location
}
