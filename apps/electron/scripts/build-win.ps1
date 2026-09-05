# Build script for Windows NSIS installer
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronDir = Split-Path -Parent $ScriptDir
$RootDir = Split-Path -Parent (Split-Path -Parent $ElectronDir)

# Configuration
$BunVersion = "bun-v1.4.0"  # Pinned version for reproducible builds

Write-Host "=== Building Craft Agents Windows Installer using electron-builder ===" -ForegroundColor Cyan

# Debug: System information
Write-Host ""
Write-Host "=== Debug: System Information ===" -ForegroundColor Magenta
Write-Host "OS: $([System.Environment]::OSVersion.VersionString)"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host "Hostname: $env:COMPUTERNAME"
Write-Host "User: $env:USERNAME"
Write-Host "Temp: $env:TEMP"
Write-Host "Working Dir: $(Get-Location)"

# Debug: Check Windows Defender status
Write-Host ""
Write-Host "=== Debug: Windows Defender Status ===" -ForegroundColor Magenta
try {
    $defenderStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($defenderStatus) {
        Write-Host "Real-time Protection: $($defenderStatus.RealTimeProtectionEnabled)"
        Write-Host "Antivirus Enabled: $($defenderStatus.AntivirusEnabled)"
        Write-Host "On Access Protection: $($defenderStatus.OnAccessProtectionEnabled)"
        Write-Host "IO AV Protection: $($defenderStatus.IoavProtectionEnabled)"
    } else {
        Write-Host "Could not get Defender status"
    }
} catch {
    Write-Host "Defender status check failed: $_"
}

# Debug: List exclusions
Write-Host ""
Write-Host "=== Debug: Defender Exclusions ===" -ForegroundColor Magenta
try {
    $prefs = Get-MpPreference -ErrorAction SilentlyContinue
    if ($prefs.ExclusionPath) {
        Write-Host "Path Exclusions: $($prefs.ExclusionPath -join ', ')"
    }
    if ($prefs.ExclusionProcess) {
        Write-Host "Process Exclusions: $($prefs.ExclusionProcess -join ', ')"
    }
} catch {
    Write-Host "Could not get exclusions: $_"
}
Write-Host ""

# 0. Kill any lingering processes that might lock files
Write-Host "Killing any lingering node/npm processes..."
$processesToKill = @('node', 'npm', 'electron', 'electron-builder')
foreach ($procName in $processesToKill) {
    Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  Killing $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor Yellow
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
# Give processes time to fully terminate
Start-Sleep -Seconds 2

# 1. Clean previous build artifacts (with retry for locked files)
Write-Host "Cleaning previous builds..."
$foldersToClean = @(
    "$ElectronDir\packages",
    "$ElectronDir\release"
)
foreach ($folder in $foldersToClean) {
    if (Test-Path $folder) {
        $retries = 3
        for ($i = 1; $i -le $retries; $i++) {
            try {
                Remove-Item -Recurse -Force $folder -ErrorAction Stop
                break
            } catch {
                if ($i -eq $retries) { throw }
                Write-Host "  Retrying cleanup of $folder (attempt $i)..." -ForegroundColor Yellow
                Start-Sleep -Seconds 2
            }
        }
    }
}

# 2. Install dependencies (offline + frozen: node_modules must already be in
#    sync with bun.lock. Online resolution is unreliable on some networks and
#    can hang for minutes; if this step fails, run `bun install` manually once.)
Write-Host "Installing dependencies (offline, frozen lockfile)..."
Push-Location $RootDir
try {
    bun install --frozen-lockfile --offline
} finally {
    Pop-Location
}

# 3. Bun binary for Windows — reuse cached copy when present, else download.
# Use baseline build - works on all x64 CPUs (no AVX2 requirement).
# github.com is unreachable from some networks (e.g. CN); download falls back
# to the npmmirror binary mirror, which also carries SHASUMS256.txt.
$BunExePath = "$ElectronDir\vendor\bun\bun.exe"
$BunDownload = "bun-windows-x64-baseline"

$needBunDownload = $true
if (Test-Path $BunExePath) {
    $existingSize = (Get-Item $BunExePath).Length
    if ($existingSize -gt 30000000) {
        Write-Host "Reusing cached Bun binary: $BunExePath ($([math]::Round($existingSize / 1MB, 1)) MB)" -ForegroundColor Green
        $needBunDownload = $false
    } else {
        Write-Host "Cached bun.exe looks truncated ($existingSize bytes), re-downloading..." -ForegroundColor Yellow
    }
}

if ($needBunDownload) {
    Write-Host "Downloading Bun $BunVersion for Windows x64 (baseline)..."
    New-Item -ItemType Directory -Force -Path "$ElectronDir\vendor\bun" | Out-Null

    $TempDir = Join-Path $env:TEMP "bun-download-$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

    function Download-FirstAvailable($urls, $outFile) {
        foreach ($url in $urls) {
            try {
                Write-Host "  Downloading from $url..."
                Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing
                if ((Get-Item $outFile).Length -gt 0) { return }
            } catch {
                Write-Host "  Failed ($($_.Exception.Message))" -ForegroundColor Yellow
            }
        }
        throw "All download sources failed for $outFile"
    }

    try {
        $MirrorBase = "https://registry.npmmirror.com/-/binary/bun/$BunVersion"
        $GithubBase = "https://github.com/oven-sh/bun/releases/download/$BunVersion"

        # Download binary and checksums (mirror first, GitHub fallback)
        Download-FirstAvailable @("$MirrorBase/$BunDownload.zip", "$GithubBase/$BunDownload.zip") "$TempDir\$BunDownload.zip"
        Download-FirstAvailable @("$MirrorBase/SHASUMS256.txt", "$GithubBase/SHASUMS256.txt") "$TempDir\SHASUMS256.txt"

        # Verify checksum
        Write-Host "Verifying checksum..."
        $ExpectedHash = (Get-Content "$TempDir\SHASUMS256.txt" | Select-String "$BunDownload.zip").ToString().Split(" ")[0]
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $ActualHash = [System.BitConverter]::ToString($sha256.ComputeHash([System.IO.File]::ReadAllBytes("$TempDir\$BunDownload.zip"))).Replace("-","").ToLower()

        if ($ActualHash -ne $ExpectedHash) {
            throw "Checksum verification failed! Expected: $ExpectedHash, Got: $ActualHash"
        }
        Write-Host "Checksum verified successfully" -ForegroundColor Green

        # Extract and install using robocopy for better file handle management
        Write-Host "Extracting Bun..."
        Expand-Archive -Path "$TempDir\$BunDownload.zip" -DestinationPath $TempDir -Force

        # Unblock in temp first (before copy)
        Unblock-File -Path "$TempDir\$BunDownload\bun.exe" -ErrorAction SilentlyContinue

        # Use robocopy with retries - handles transient file locks better than Copy-Item
        # /R:5 = 5 retries, /W:3 = 3 second wait between retries, /NP = no progress, /NFL /NDL = quiet
        Write-Host "Copying bun.exe with robocopy..."
        robocopy "$TempDir\$BunDownload" "$ElectronDir\vendor\bun" bun.exe /R:5 /W:3 /NP /NFL /NDL
        # Robocopy exit codes: 0-7 are success, 8+ are errors
        if ($LASTEXITCODE -ge 8) {
            throw "robocopy failed with exit code $LASTEXITCODE"
        }

        Write-Host "Bun extracted to: $BunExePath" -ForegroundColor Green

        # Give Windows time to release any file handles from the copy
        Write-Host "Waiting for file handles to release..."
        Start-Sleep -Seconds 3
    } finally {
        Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
    }
}

# 4. Copy ripgrep (sourced from @vscode/ripgrep; the JS wrapper resolves the
#    binary from the platform-specific optional dependency @vscode/ripgrep-win32-x64).
#    The JS wrapper @vscode/ripgrep resolves the binary from the platform-specific
#    optional dependency (e.g. @vscode/ripgrep-win32-x64). Both must be staged.
$RgWrapper = "$RootDir\node_modules\@vscode\ripgrep"
$RgPlatform = "$RootDir\node_modules\@vscode\ripgrep-win32-x64"
if (-not (Test-Path $RgWrapper)) {
    Write-Host "ERROR: @vscode/ripgrep wrapper not found at $RgWrapper" -ForegroundColor Red
    Write-Host "Run 'bun install' from the repository root first."
    exit 1
}
if (-not (Test-Path "$RgPlatform\bin\rg.exe")) {
    Write-Host "ERROR: @vscode/ripgrep binary not found at $RgPlatform\bin\rg.exe" -ForegroundColor Red
    Write-Host "Run 'bun install' and 'bun pm trust @vscode/ripgrep'."
    exit 1
}
Write-Host "Copying @vscode/ripgrep (wrapper + win32-x64 binary)..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\node_modules\@vscode" | Out-Null
Remove-Item -Recurse -Force "$ElectronDir\node_modules\@vscode\ripgrep" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$ElectronDir\node_modules\@vscode\ripgrep-win32-x64" -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force $RgWrapper "$ElectronDir\node_modules\@vscode\"
Copy-Item -Recurse -Force $RgPlatform "$ElectronDir\node_modules\@vscode\"
# 6. Copy network interceptor sources (for Pi subprocess; Claude no longer
#    uses --preload — Phase 2 will move that to SDK hooks or a local proxy).
$InterceptorSource = "$RootDir\packages\shared\src\unified-network-interceptor.ts"
if (-not (Test-Path $InterceptorSource)) {
    Write-Host "ERROR: Interceptor not found at $InterceptorSource" -ForegroundColor Red
    exit 1
}
Write-Host "Copying interceptor (for Pi subprocess)..."
New-Item -ItemType Directory -Force -Path "$ElectronDir\packages\shared\src" | Out-Null
Copy-Item $InterceptorSource "$ElectronDir\packages\shared\src\"
foreach ($dep in @("interceptor-common.ts", "feature-flags.ts", "interceptor-request-utils.ts")) {
    $depPath = "$RootDir\packages\shared\src\$dep"
    if (Test-Path $depPath) {
        Copy-Item $depPath "$ElectronDir\packages\shared\src\"
    }
}

# 5b. Build and stage Pi agent server (bun build → resources/pi-agent-server/).
#     The packaged app resolves piServerPath from resources/pi-agent-server/index.js
#     at runtime (see packages/shared/…/runtime-resolver.ts:resolveServerPath).
Write-Host "Building Pi agent server..."

Push-Location "$RootDir\packages\pi-agent-server"
try {
    # Bundle + thin launcher: Pi 0.85+ ships top-level entry guards that throw
    # when the bundle runs as the direct entry (argv[1] === import.meta.url).
    & bun build src/index.ts --outfile=dist/bundle.js --target=bun --format=esm --external koffi
    if ($LASTEXITCODE -ne 0) { throw "Pi agent server build failed" }
    & bun scripts/write-launcher.ts
    if ($LASTEXITCODE -ne 0) { throw "Pi agent server launcher failed" }
} finally {
    Pop-Location
}

Write-Host "Staging Pi agent server into resources..."
$PiAgentSource = "$RootDir\packages\pi-agent-server\dist"
$PiAgentDest = "$ElectronDir\resources\pi-agent-server"
New-Item -ItemType Directory -Force -Path $PiAgentDest | Out-Null
Remove-Item -Recurse -Force "$PiAgentDest\*" -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force "$PiAgentSource\*" $PiAgentDest

# 6. Build Electron app
Write-Host "Building Electron app..."

# Build main process via the shared cross-platform script (single source of
# truth for OAuth defines; loads .env itself; includes node-fetch/abort-controller shims)
Write-Host "  Building main process..."
Push-Location $RootDir
try {
    bun run electron:build:main
    if ($LASTEXITCODE -ne 0) { throw "Main process build failed" }
} finally {
    Pop-Location
}

# Build preload
Write-Host "  Building preload..."
Push-Location $RootDir
try {
    bun run electron:build:preload
    if ($LASTEXITCODE -ne 0) { throw "Preload build failed" }
} finally {
    Pop-Location
}

# Build renderer (frontend)
Write-Host "  Building renderer (frontend)..."
Push-Location $RootDir
try {
    # Clean previous renderer build
    $RendererDir = "$ElectronDir\dist\renderer"
    if (Test-Path $RendererDir) { Remove-Item -Recurse -Force $RendererDir }

    # Run vite build
    npx vite build --config apps/electron/vite.config.ts
    if ($LASTEXITCODE -ne 0) { throw "Renderer build failed" }

    # Verify renderer was built
    if (-not (Test-Path "$RendererDir\index.html")) {
        throw "Renderer build verification failed: index.html not found"
    }
    Write-Host "  Renderer build verified: $RendererDir" -ForegroundColor Green
} finally {
    Pop-Location
}

# Copy all resources and bundled assets using the shared script.
# Single source of truth — matches Mac/Linux build (bun run build:copy).
# Copies: resources (icons, DMG bg), docs, tool-icons, themes, permissions, config-defaults.
Write-Host "  Copying resources and bundled assets..."
Push-Location $ElectronDir
try {
    bun scripts/copy-assets.ts
    if ($LASTEXITCODE -ne 0) { throw "Asset copy failed" }
    Write-Host "  Assets copied" -ForegroundColor Green
} finally {
    Pop-Location
}

# 7. Package with electron-builder
Write-Host "Packaging app with electron-builder..."

# Debug: Show bun.exe file info
Write-Host ""
Write-Host "=== Debug: bun.exe File Info ===" -ForegroundColor Magenta
$BunExe = "$ElectronDir\vendor\bun\bun.exe"
if (Test-Path $BunExe) {
    $fileInfo = Get-Item $BunExe
    Write-Host "Path: $($fileInfo.FullName)"
    Write-Host "Size: $([math]::Round($fileInfo.Length / 1MB, 2)) MB"
    Write-Host "Created: $($fileInfo.CreationTime)"
    Write-Host "Modified: $($fileInfo.LastWriteTime)"
    Write-Host "Attributes: $($fileInfo.Attributes)"

    # Check Zone.Identifier (Mark of the Web)
    $zoneFile = "$BunExe`:Zone.Identifier"
    if (Test-Path $zoneFile -ErrorAction SilentlyContinue) {
        Write-Host "Zone.Identifier: EXISTS (file may be blocked)" -ForegroundColor Yellow
    } else {
        Write-Host "Zone.Identifier: None (file is unblocked)"
    }

    # Check file hash
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hash = [System.BitConverter]::ToString($sha256.ComputeHash([System.IO.File]::ReadAllBytes($BunExe))).Replace("-","").ToLower()
    Write-Host "SHA256: $hash"
} else {
    Write-Host "ERROR: bun.exe not found at $BunExe" -ForegroundColor Red
}

# Debug: List vendor directory contents
Write-Host ""
Write-Host "=== Debug: vendor/bun Directory ===" -ForegroundColor Magenta
Get-ChildItem "$ElectronDir\vendor\bun" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  $($_.Name) - $($_.Length) bytes"
}

# Debug: Check for processes that might have files open
Write-Host ""
Write-Host "=== Debug: Potentially Relevant Processes ===" -ForegroundColor Magenta
$relevantProcesses = Get-Process | Where-Object {
    $_.ProcessName -match 'node|npm|bun|electron|defender|antimalware|mpcmdrun'
} | Select-Object ProcessName, Id, CPU, WorkingSet64
if ($relevantProcesses) {
    $relevantProcesses | ForEach-Object {
        Write-Host "  $($_.ProcessName) (PID: $($_.Id)) - Memory: $([math]::Round($_.WorkingSet64 / 1MB, 1)) MB"
    }
} else {
    Write-Host "  No relevant processes found"
}
Write-Host ""

# NOTE: bun.exe is now copied via extraResources in electron-builder.yml
# This avoids EBUSY errors from the npm node module collector.
# See electron-builder.yml for details.

# Verify bun.exe is accessible (not locked by another process)
Write-Host "  Verifying $BunExe is accessible..."
$retryCount = 0
$maxRetries = 6
while ($retryCount -lt $maxRetries) {
    try {
        # Try to open the file exclusively to verify no other process has it locked
        $stream = [System.IO.File]::Open($BunExe, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
        $stream.Close()
        $stream.Dispose()
        Write-Host "  File is accessible" -ForegroundColor Green
        break
    } catch {
        $retryCount++
        if ($retryCount -ge $maxRetries) {
            Write-Host "  WARNING: File may be locked after $maxRetries attempts, proceeding anyway..." -ForegroundColor Yellow
        } else {
            Write-Host "  File locked, waiting 5 seconds (attempt $retryCount/$maxRetries)..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
}

# Force garbage collection to release any managed file handles
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()

# Run electron-builder with retry logic for EBUSY errors
Push-Location $ElectronDir
$maxBuilderRetries = 3
$builderRetry = 0
$builderSuccess = $false

while (-not $builderSuccess -and $builderRetry -lt $maxBuilderRetries) {
    $builderRetry++
    Write-Host "  electron-builder attempt $builderRetry of $maxBuilderRetries..." -ForegroundColor Cyan

    # Clean release directory before each attempt to avoid stale files
    if (Test-Path "$ElectronDir\release") {
        Write-Host "  Cleaning release directory before attempt..."
        Remove-Item -Recurse -Force "$ElectronDir\release" -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    npx electron-builder --win --x64 2>&1 | Tee-Object -Variable builderOutput

    if ($LASTEXITCODE -eq 0) {
        $builderSuccess = $true
        Write-Host "  electron-builder succeeded on attempt $builderRetry" -ForegroundColor Green
    } else {
        Write-Host "  electron-builder failed with exit code $LASTEXITCODE" -ForegroundColor Yellow

        if ($builderRetry -lt $maxBuilderRetries) {
            Write-Host "  Waiting 10 seconds before retry..." -ForegroundColor Yellow

            # Kill any processes that might be holding file locks
            Get-Process -Name 'node', 'npm' -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "    Killing $($_.ProcessName) (PID: $($_.Id))..." -ForegroundColor Yellow
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }

            Start-Sleep -Seconds 10
        }
    }
}

Pop-Location

if (-not $builderSuccess) {
    throw "electron-builder failed after $maxBuilderRetries attempts"
}

# 8. Verify the installer was built
$InstallerPath = Get-ChildItem -Path "$ElectronDir\release" -Filter "*.exe" | Select-Object -First 1

if (-not $InstallerPath) {
    Write-Host "ERROR: Installer not found in $ElectronDir\release" -ForegroundColor Red
    Write-Host "Contents of release directory:"
    Get-ChildItem "$ElectronDir\release"
    exit 1
}

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Green
Write-Host "Installer: $($InstallerPath.FullName)"
Write-Host "Size: $([math]::Round($InstallerPath.Length / 1MB, 2)) MB"
