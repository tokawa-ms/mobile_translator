#!/usr/bin/env pwsh
# Ensures required azd environment variables are set before provisioning.
# Required: SPA_CLIENT_ID, API_AUDIENCE  (you must create the Entra App Registrations first)
$ErrorActionPreference = 'Stop'

function Require-Env([string]$name, [string]$prompt) {
    $current = azd env get-values | Select-String "^$name=" | ForEach-Object { ($_ -split '=', 2)[1].Trim('"') }
    if (-not $current) {
        $value = Read-Host $prompt
        if (-not $value) { throw "$name is required" }
        azd env set $name $value | Out-Null
    }
}

Require-Env 'SPA_CLIENT_ID' 'Enter the SPA App Registration Client ID (GUID)'
Require-Env 'API_AUDIENCE'  'Enter the API App ID URI (e.g. api://<guid>)'
Write-Host "preprovision: env OK"
