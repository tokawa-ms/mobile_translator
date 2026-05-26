param(
    [Parameter(Mandatory = $false)]
    [string]$EnvFile = ".env",

    [Parameter(Mandatory = $false)]
    [string]$AzdEnvironment,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Parse-EnvLine {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Line
    )

    $trimmed = $Line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) { return $null }
    if ($trimmed.StartsWith("#")) { return $null }

    if ($trimmed.StartsWith("export ")) {
        $trimmed = $trimmed.Substring(7).Trim()
    }

    $parts = $trimmed -split "=", 2
    if ($parts.Count -ne 2) { return $null }

    $key = $parts[0].Trim()
    if ([string]::IsNullOrWhiteSpace($key)) { return $null }

    # dotenv の一般的なキー形式に限定
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        Write-Warning "Skipping invalid key: $key"
        return $null
    }

    $value = $parts[1].Trim()

    # 値がシングル/ダブルクォートで囲まれている場合は外す
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        if ($value.Length -ge 2) {
            $value = $value.Substring(1, $value.Length - 2)
        }
    }

    return [pscustomobject]@{
        Key   = $key
        Value = $value
    }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Env file not found: $EnvFile"
}

# azd の存在確認
$null = Get-Command azd -ErrorAction Stop

if (-not [string]::IsNullOrWhiteSpace($AzdEnvironment)) {
    Write-Host "Selecting azd environment: $AzdEnvironment"
    azd env select $AzdEnvironment | Out-Host
}

$lines = Get-Content -LiteralPath $EnvFile
$items = @()

foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    $parsed = Parse-EnvLine -Line $line
    if ($null -ne $parsed) {
        $items += $parsed
    }
}

if ($items.Count -eq 0) {
    Write-Warning "No valid env entries found in $EnvFile"
    exit 0
}

Write-Host "Found $($items.Count) env entries in $EnvFile"

foreach ($item in $items) {
    if ($DryRun) {
        Write-Host "[DryRun] azd env set $($item.Key) <value>"
        continue
    }

    Write-Host "Setting $($item.Key)"
    azd env set $item.Key $item.Value | Out-Host
}

Write-Host "Done."
Write-Host "Tip: run 'azd env get-values' to verify current values."
