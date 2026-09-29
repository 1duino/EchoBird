# Download the Store package directly from Microsoft's delivery service when
# the Store UI is unavailable. The bundled resolver is MPL-2.0; see storelib/.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$family = 'ManusAI.Manus_vajzd2mq3s8wj'
$publisher = 'CN=845AA9DF-1559-4AA0-8A94-CE74FEB6A77B'
$installed = Get-AppxPackage -Name ManusAI.Manus | Select-Object -First 1
if ($installed -and $installed.PackageFamilyName -eq $family -and $installed.Status -eq 'Ok') {
    Write-Output "Manus is already installed: $($installed.PackageFullName)"
    return
}

if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw 'The current Manus Windows package supports x64 Windows 10/11 only.'
}

$downloadDir = Join-Path $env:USERPROFILE 'Downloads\Manus'
$resolver = Join-Path $PSScriptRoot 'storelib\scripts\download-store-package.ps1'
& $resolver -ProductId '9PHV7M7V4S5L' -Architecture x64 -Market US -Language en `
    -OutputDirectory $downloadDir -Force | Out-Null

$manifest = Get-Content -Raw -LiteralPath (Join-Path $downloadDir 'package-manifest.json') |
    ConvertFrom-Json
if ($manifest.ProductId -ne '9PHV7M7V4S5L' -or
    $manifest.PackageIdentityName -ne 'ManusAI.Manus') {
    throw 'The Microsoft catalog did not return the expected Manus product.'
}

$packages = @($manifest.Packages)
$main = @($packages | Where-Object {
    $_.FileName -match '^ManusAI\.Manus_\d+\.\d+\.\d+\.\d+_neutral_~_vajzd2mq3s8wj\.Msixbundle$'
})
if ($main.Count -ne 1) {
    throw 'The expected Manus MSIX bundle was not found.'
}

$paths = @()
foreach ($package in $packages) {
    $path = Join-Path $downloadDir $package.FileName
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ($signature.Status -ne 'Valid') {
        throw "Invalid package signature: $path"
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash -ne $package.Sha256) {
        throw "Package hash changed after download: $path"
    }
    $paths += $path
}

$mainPath = Join-Path $downloadDir $main[0].FileName
$mainSignature = Get-AuthenticodeSignature -LiteralPath $mainPath
if ($mainSignature.SignerCertificate.Subject -ne $publisher) {
    throw "Unexpected Manus publisher: $($mainSignature.SignerCertificate.Subject)"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$bundle = [IO.Compression.ZipFile]::OpenRead($mainPath)
try {
    $entry = $bundle.GetEntry('AppxMetadata/AppxBundleManifest.xml')
    if (-not $entry) { throw 'MSIX bundle manifest is missing.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $identity = $xml.SelectSingleNode("//*[local-name()='Bundle']/*[local-name()='Identity']")
    if (-not $identity -or $identity.GetAttribute('Name') -ne 'ManusAI.Manus' -or
        $identity.GetAttribute('Publisher') -ne $publisher) {
        throw 'MSIX bundle identity does not match the official Manus package.'
    }
} finally {
    $bundle.Dispose()
}

$dependencies = @($paths | Where-Object { $_ -ne $mainPath })
if ($dependencies.Count -gt 0) {
    Add-AppxPackage -Path $mainPath -DependencyPath $dependencies
} else {
    Add-AppxPackage -Path $mainPath
}

$installed = Get-AppxPackage -Name ManusAI.Manus | Select-Object -First 1
if (-not $installed -or $installed.PackageFamilyName -ne $family) {
    throw 'Windows did not register the expected Manus package after installation.'
}
Write-Output "Manus installed: $($installed.PackageFullName)"
Write-Output "Installer: $mainPath"
