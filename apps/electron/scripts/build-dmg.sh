#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$ELECTRON_DIR")")"

# Helper function to check required file/directory exists
require_path() {
    local path="$1"
    local description="$2"
    local hint="$3"

    if [ ! -e "$path" ]; then
        echo "ERROR: $description not found at $path"
        [ -n "$hint" ] && echo "$hint"
        exit 1
    fi
}

# Sync secrets from 1Password if CLI is available
if command -v op &> /dev/null; then
    echo "1Password CLI detected, syncing secrets..."
    cd "$ROOT_DIR"
    if bun run sync-secrets 2>/dev/null; then
        echo "Secrets synced from 1Password"
    else
        echo "Warning: Failed to sync secrets from 1Password (continuing with existing .env if present)"
    fi
fi

# Load environment variables from .env
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
fi

# Parse arguments
ARCH="arm64"
UPLOAD=false
UPLOAD_LATEST=false
UPLOAD_SCRIPT=false

show_help() {
    cat << EOF
Usage: build-dmg.sh [arm64|x64] [--upload] [--latest] [--script]

Arguments:
  arm64|x64    Target architecture (default: arm64)
  --upload     Upload DMG to S3 after building
  --latest     Also update electron/latest (requires --upload)
  --script     Also upload install-app.sh (requires --upload)

Environment variables (from .env or environment):
  APPLE_SIGNING_IDENTITY    - Code signing identity
  APPLE_ID                  - Apple ID for notarization
  APPLE_TEAM_ID             - Apple Team ID
  APPLE_APP_SPECIFIC_PASSWORD - App-specific password
  S3_VERSIONS_BUCKET_*      - S3 credentials (for --upload)
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        arm64|x64)     ARCH="$1"; shift ;;
        --upload)      UPLOAD=true; shift ;;
        --latest)      UPLOAD_LATEST=true; shift ;;
        --script)      UPLOAD_SCRIPT=true; shift ;;
        -h|--help)     show_help ;;
        *)
            echo "Unknown option: $1"
            echo "Run with --help for usage"
            exit 1
            ;;
    esac
done

# Configuration
BUN_VERSION="bun-v1.4.0"  # Pinned version for reproducible builds
# Download base for Bun. Override with a mirror when GitHub is slow or
# unreachable, e.g. BUN_DOWNLOAD_BASE=https://registry.npmmirror.com/-/binary/bun
BUN_DOWNLOAD_BASE="${BUN_DOWNLOAD_BASE:-https://github.com/oven-sh/bun/releases/download}"

echo "=== Building Craft Agents DMG (${ARCH}) using electron-builder ==="
if [ "$UPLOAD" = true ]; then
    echo "Will upload to S3 after build"
fi

# 1. Clean previous build artifacts
echo "Cleaning previous builds..."
rm -rf "$ELECTRON_DIR/vendor"
rm -rf "$ELECTRON_DIR/node_modules/@anthropic-ai"
rm -rf "$ELECTRON_DIR/packages"
rm -rf "$ELECTRON_DIR/release"

# 2. Install dependencies
echo "Installing dependencies..."
cd "$ROOT_DIR"
bun install

# 3. Download Bun binary with checksum verification
echo "Downloading Bun ${BUN_VERSION} for darwin-${ARCH}..."
mkdir -p "$ELECTRON_DIR/vendor/bun"
BUN_DOWNLOAD="bun-darwin-$([ "$ARCH" = "arm64" ] && echo "aarch64" || echo "x64")"

# Create temp directory to avoid race conditions
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download binary and checksums
curl -fSL "${BUN_DOWNLOAD_BASE}/${BUN_VERSION}/${BUN_DOWNLOAD}.zip" -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip"
curl -fSL "${BUN_DOWNLOAD_BASE}/${BUN_VERSION}/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"

# Verify checksum
echo "Verifying checksum..."
cd "$TEMP_DIR"
grep "${BUN_DOWNLOAD}.zip" SHASUMS256.txt | shasum -a 256 -c -
cd - > /dev/null

# Extract and install
unzip -o "$TEMP_DIR/${BUN_DOWNLOAD}.zip" -d "$TEMP_DIR"
cp "$TEMP_DIR/${BUN_DOWNLOAD}/bun" "$ELECTRON_DIR/vendor/bun/"
chmod +x "$ELECTRON_DIR/vendor/bun/bun"

# 4. Copy the search service's ripgrep binary directly.
#    @vscode/ripgrep >= 1.15 ships the binary in a platform package
#    (@vscode/ripgrep-darwin-<arch>), declared as an optionalDependency of the
#    main package and resolved by lib/index.js at runtime; older versions
#    carried it at @vscode/ripgrep/bin/rg.
RG_SOURCE="$ROOT_DIR/node_modules/@vscode/ripgrep"
require_path "$RG_SOURCE" "@vscode/ripgrep" "Run 'bun install' and 'bun pm trust @vscode/ripgrep' first."
RG_PLATFORM_PKG="@vscode/ripgrep-darwin-${ARCH}"
RG_PLATFORM_SOURCE="$ROOT_DIR/node_modules/${RG_PLATFORM_PKG}"
if [ ! -d "$RG_PLATFORM_SOURCE" ]; then
    echo "Cross-arch build: ${RG_PLATFORM_PKG} not in node_modules — fetching from npm..."
    RG_VERSION=$(node -p "require('$RG_SOURCE/package.json').version")
    RG_PKG_TMP=$(mktemp -d)
    trap "rm -rf $RG_PKG_TMP" RETURN
    (
        cd "$RG_PKG_TMP"
        npm pack "${RG_PLATFORM_PKG}@${RG_VERSION}" >/dev/null
        TARBALL=$(ls vscode-ripgrep-*.tgz | head -1)
        tar -xzf "$TARBALL"
    )
    mkdir -p "$RG_PLATFORM_SOURCE"
    cp -r "$RG_PKG_TMP/package/." "$RG_PLATFORM_SOURCE/"
fi
RG_BIN="$RG_SOURCE/bin/rg"
if [ ! -f "$RG_BIN" ] && [ -d "$RG_PLATFORM_SOURCE" ]; then
    RG_BIN="$RG_PLATFORM_SOURCE/bin/rg"
fi
if [ ! -f "$RG_BIN" ]; then
    echo "ERROR: ripgrep binary not found at $RG_SOURCE/bin/rg or $RG_PLATFORM_SOURCE/bin/rg"
    echo "Run 'bun install' first (platform package provides the binary)."
    exit 1
fi
echo "Copying @vscode/ripgrep (binary: $RG_BIN)..."
mkdir -p "$ELECTRON_DIR/node_modules/@vscode"
rm -rf "$ELECTRON_DIR/node_modules/@vscode/ripgrep"
cp -r "$RG_SOURCE" "$ELECTRON_DIR/node_modules/@vscode/"
if [ -d "$RG_PLATFORM_SOURCE" ]; then
    rm -rf "$ELECTRON_DIR/node_modules/@vscode/${RG_PLATFORM_PKG}"
    cp -r "$RG_PLATFORM_SOURCE" "$ELECTRON_DIR/node_modules/@vscode/"
fi

# 6. Copy network interceptor sources.
#    NOTE (Phase 1 of SDK uplift): the Claude native binary doesn't accept
#    Bun's --preload, so the Claude code path no longer uses these. They're
#    still needed for the **Pi** subprocess (runs on Bun, accepts --preload).
#    Phase 2 will reintroduce equivalent functionality for Claude via SDK
#    hooks or a local proxy.
INTERCEPTOR_SOURCE="$ROOT_DIR/packages/shared/src/unified-network-interceptor.ts"
require_path "$INTERCEPTOR_SOURCE" "Interceptor" "Ensure packages/shared/src/unified-network-interceptor.ts exists."
echo "Copying interceptor (for Pi subprocess)..."
mkdir -p "$ELECTRON_DIR/packages/shared/src"
cp "$INTERCEPTOR_SOURCE" "$ELECTRON_DIR/packages/shared/src/"
for dep in interceptor-common.ts feature-flags.ts interceptor-request-utils.ts; do
  if [ -f "$ROOT_DIR/packages/shared/src/$dep" ]; then
    cp "$ROOT_DIR/packages/shared/src/$dep" "$ELECTRON_DIR/packages/shared/src/"
  fi
done

# 6. Build Electron app
echo "Building Electron app..."
cd "$ROOT_DIR"
bun run electron:build

# 7. Package with electron-builder
echo "Packaging app with electron-builder..."
cd "$ELECTRON_DIR"

# Set up environment for electron-builder
export CSC_IDENTITY_AUTO_DISCOVERY=true

# Propagate mirror overrides for electron-builder downloads (electron dist,
# dmg-builder, winCodeSign) when GitHub is slow or unreachable.
[ -n "$ELECTRON_MIRROR" ] && export ELECTRON_MIRROR
[ -n "$ELECTRON_BUILDER_BINARIES_MIRROR" ] && export ELECTRON_BUILDER_BINARIES_MIRROR

# Build electron-builder arguments
BUILDER_ARGS="--mac --${ARCH}"

# Add code signing if identity is available
if [ -n "$APPLE_SIGNING_IDENTITY" ]; then
    # Strip "Developer ID Application: " prefix if present (electron-builder adds it automatically)
    CSC_NAME_CLEAN="${APPLE_SIGNING_IDENTITY#Developer ID Application: }"
    echo "Using signing identity: $CSC_NAME_CLEAN"
    export CSC_NAME="$CSC_NAME_CLEAN"
fi

# Add notarization if all credentials are available
if [ -n "$APPLE_ID" ] && [ -n "$APPLE_TEAM_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
    echo "Notarization enabled"
    export APPLE_ID="$APPLE_ID"
    export APPLE_TEAM_ID="$APPLE_TEAM_ID"
    export APPLE_APP_SPECIFIC_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"

    # Enable notarization in electron-builder by setting env vars
    # The electron-builder.yml has notarize section commented out,
    # but we can enable it via environment
    export NOTARIZE=true
fi

# Run electron-builder
npx electron-builder $BUILDER_ARGS

# 8. Verify the DMG was built
# electron-builder.yml uses artifactName to output: Craft-Agents-${arch}.dmg
DMG_NAME="Craft-Agents-${ARCH}.dmg"
DMG_PATH="$ELECTRON_DIR/release/$DMG_NAME"

if [ ! -f "$DMG_PATH" ]; then
    echo "ERROR: Expected DMG not found at $DMG_PATH"
    echo "Contents of release directory:"
    ls -la "$ELECTRON_DIR/release/"
    exit 1
fi

echo ""
echo "=== Build Complete ==="
echo "DMG: $ELECTRON_DIR/release/${DMG_NAME}"
echo "Size: $(du -h "$ELECTRON_DIR/release/${DMG_NAME}" | cut -f1)"

# 9. Create manifest.json for upload script
# Read version from package.json
ELECTRON_VERSION=$(cat "$ELECTRON_DIR/package.json" | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
echo "Creating manifest.json (version: $ELECTRON_VERSION)..."
mkdir -p "$ROOT_DIR/.build/upload"
echo "{\"version\": \"$ELECTRON_VERSION\"}" > "$ROOT_DIR/.build/upload/manifest.json"

# 10. Upload to S3 (if --upload flag is set)
if [ "$UPLOAD" = true ]; then
    echo ""
    echo "=== Uploading to S3 ==="

    # Check for S3 credentials
    if [ -z "$S3_VERSIONS_BUCKET_ENDPOINT" ] || [ -z "$S3_VERSIONS_BUCKET_ACCESS_KEY_ID" ] || [ -z "$S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY" ]; then
        cat << EOF
ERROR: Missing S3 credentials. Set these environment variables:
  S3_VERSIONS_BUCKET_ENDPOINT
  S3_VERSIONS_BUCKET_ACCESS_KEY_ID
  S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY

You can add them to .env or export them directly.
EOF
        exit 1
    fi

    # Build upload flags
    UPLOAD_FLAGS="--electron"
    [ "$UPLOAD_LATEST" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --latest"
    [ "$UPLOAD_SCRIPT" = true ] && UPLOAD_FLAGS="$UPLOAD_FLAGS --script"

    cd "$ROOT_DIR"
    bun run scripts/upload.ts $UPLOAD_FLAGS

    echo ""
    echo "=== Upload Complete ==="
fi
