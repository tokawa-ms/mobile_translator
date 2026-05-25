#!/usr/bin/env sh
set -e
require_env() {
  name=$1; prompt=$2
  current=$(azd env get-values | grep "^${name}=" | sed -e "s/^${name}=//" -e 's/^"//' -e 's/"$//' || true)
  if [ -z "$current" ]; then
    printf "%s: " "$prompt"
    read value
    [ -z "$value" ] && { echo "$name is required" >&2; exit 1; }
    azd env set "$name" "$value" >/dev/null
  fi
}
require_env SPA_CLIENT_ID 'Enter the SPA App Registration Client ID (GUID)'
require_env API_AUDIENCE  'Enter the API App ID URI (e.g. api://<guid>)'
echo "preprovision: env OK"
