#!/bin/sh
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = {
  tenantId: "${TENANT_ID:-}",
  clientId: "${CLIENT_ID:-}",
  apiScope: "${API_SCOPE:-}",
  apiBaseUrl: "${API_BASE_URL:-}"
};
EOF
