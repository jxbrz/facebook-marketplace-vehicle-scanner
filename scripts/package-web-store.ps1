$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$artifactDirectory = Join-Path $root "artifacts"
$archive = Join-Path $artifactDirectory "kelmar-vehicle-scanner-web-store-v$version.zip"
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("kelmar-web-store-" + [System.Guid]::NewGuid().ToString("N"))
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
  "scanner-storage.js",
  "vehicle-catalogue.js",
  "listing-facts.js",
  "filter-domain.js",
  "vehicle-identity.js",
  "listing-details-extractor.js",
  "payload-normalizer.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "styles.css",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "icons/kelmar-logo.png"
)

Push-Location $root
try {
  npm run icons:generate
  npm run validate
  New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  foreach ($relativePath in $runtimeFiles) {
    $source = Join-Path $root $relativePath
    $destination = Join-Path $staging $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
  }
  Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $archive -CompressionLevel Optimal
  node scripts/audit-web-store-package.js $archive
  Write-Output "Created Web Store package: $archive"
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  Pop-Location
}
