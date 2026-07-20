$ErrorActionPreference = "Continue"
$projectRoot = "E:\craft-agents"
$rootNM = Join-Path -Path $projectRoot -ChildPath "node_modules"

# Prosemirror packages that may need deduplication
$prosePackages = @(
    "prosemirror-model",
    "prosemirror-state",
    "prosemirror-view",
    "prosemirror-transform",
    "prosemirror-commands",
    "prosemirror-keymap",
    "prosemirror-history",
    "prosemirror-inputrules",
    "prosemirror-gapcursor",
    "prosemirror-dropcursor",
    "prosemirror-schema-list",
    "prosemirror-tables",
    "prosemirror-changeset",
    "prosemirror-markdown"
)

$fixed = 0

foreach ($pkg in $prosePackages) {
    $rootPkg = Join-Path -Path $rootNM -ChildPath $pkg
    if (-not (Test-Path -Path $rootPkg)) { continue }
    
    $rootVer = (Get-Content -Path "$rootPkg\package.json" -Raw | ConvertFrom-Json).version
    
    # Find and DELETE nested copies if root version satisfies their dep range
    Get-ChildItem -Path $rootNM -Recurse -Depth 4 -Directory -Filter $pkg -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.FullName -eq $rootPkg) { return }
        
        $nestedPkgPath = Join-Path -Path $_.FullName -ChildPath "package.json"
        if (-not (Test-Path -Path $nestedPkgPath)) { return }
        
        $nestedVer = (Get-Content -Path $nestedPkgPath -Raw | ConvertFrom-Json).version
        
        Write-Host "  FIX  $($_.FullName) ($nestedVer -> DELETE, use root $rootVer)"
        Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        $fixed++
    }
}

# Fix sentry core nesting - delete nested, let it fall back to root
$nestedSentryCore = Join-Path -Path $rootNM -ChildPath "@sentry\react\node_modules\@sentry\core"
if (Test-Path -Path $nestedSentryCore) {
    Write-Host "  FIX  Sentry @sentry/core nesting (DELETE)"
    Remove-Item -Path $nestedSentryCore -Recurse -Force -ErrorAction SilentlyContinue
    $fixed++
}

Write-Host "Fixed $fixed nested copies"
