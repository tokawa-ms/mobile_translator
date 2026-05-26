# デプロイメントガイド

このドキュメントでは、Mobile Translator を Azure にデプロイするために必要な設定をまとめています。

## 1. 前提条件

### ツール

- **Azure CLI** (`az`) - [インストール手順](https://learn.microsoft.com/cli/azure/install-azure-cli)
- **Azure Developer CLI** (`azd`) - [インストール手順](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- **Docker** - コンテナイメージをビルドする場合

### Azure サブスクリプション

- Azure サブスクリプションのアクセス権限
- リソースグループ作成権限
- App Registration 管理権限

### Azure リソース（事前作成が必要）

| リソース                 | 必要性     | 備考                                       |
| ------------------------ | ---------- | ------------------------------------------ |
| Azure OpenAI             | 必須       | gpt-5.4-mini, gpt-5.4 デプロイメント       |
| Azure AI Translator      | 必須       | 翻訳機能用                                 |
| Azure AI Speech          | 必須       | 音声認識・トークン発行用                   |
| Azure Cosmos DB          | 必須       | NoSQL データベース                         |
| Azure Container Registry | オプション | イメージプッシュ先（`azd` が自動作成可能） |

## 2. Entra ID App Registration 設定

### 2.1 SPA (Web フロントエンド) App Registration

1. **Microsoft Entra 管理センター** → **App registrations** → **New registration**
2. **Name**: `mobile-translator-spa`
3. **Supported account types**: `Accounts in this organizational directory only`
4. **Redirect URI** を追加:
   - Platform: **Single-page application (SPA)**
   - URI: `https://<YOUR_WEB_APP_URL>` (例: `https://translator.contoso.com`)
   - 開発時: `http://localhost:5173`

5. **Configuration** → **Authentication**
   - **Implicit grant and hybrid flows**: 未チェック
   - **Treat application as a public client**: OFF

6. **Certificates & secrets**
   - クライアントシークレットは不要（SPA は public client）

7. **API permissions** を追加:
   - **Add a permission** → **APIs my organization uses** → API App Registration を検索
   - Scope: `api://[API_CLIENT_ID]/access_as_user` を選択
   - **Grant admin consent**

**出力値**: `SPA_CLIENT_ID`

### 2.2 API App Registration

1. **Microsoft Entra 管理センター** → **App registrations** → **New registration**
2. **Name**: `mobile-translator-api`
3. **Supported account types**: `Accounts in this organizational directory only`
4. **Redirect URI**: スキップ（API は Web UI を持たない）

5. **Expose an API**
   - **Application ID URI**: `api://[API_CLIENT_ID]` (自動生成、コピーを保存)
   - **Add a scope**
     - Scope name: `access_as_user`
     - Admin consent display name: `Access as user`
     - Admin consent description: `Allow the app to access as a user`

6. **API permissions**
   - **Add a permission** → **Microsoft Graph** → **Delegated permissions**
   - 認証要件に応じた権限を選択

**出力値**: `API_CLIENT_ID`, `API_AUDIENCE` (= `api://[API_CLIENT_ID]`)

## 3. 環境変数・パラメーター

### 3.1 Azure Developer CLI の環境変数

`azd provision` 実行前に以下を設定します。

```bash
# PowerShell
$env:AZURE_ENV_NAME = "mt-dev"                    # 環境名（リソース名に使用）
$env:AZURE_LOCATION = "japaneast"                 # Azure リージョン
$env:AZURE_SUBSCRIPTION_ID = "xxxx-xxxx-..."      # サブスクリプション ID
$env:SPA_CLIENT_ID = "[SPA_CLIENT_ID]"           # SPA App Registration
$env:API_AUDIENCE = "api://[API_CLIENT_ID]"      # API App Registration の Application ID URI
$env:API_SCOPE = "access_as_user"                # API スコープ名
$env:AZURE_OPENAI_LOCATION = "eastus"            # Azure OpenAI のリージョン
$env:AZURE_OPENAI_DEPLOYMENT_MINI = "gpt-5.4-mini"  # mini モデルのデプロイ名
$env:AZURE_OPENAI_DEPLOYMENT_FULL = "gpt-5.4"       # full モデルのデプロイ名
$env:AZURE_SPEECH_LOCATION = "japaneast"         # Speech リージョン
```

```bash
# Bash/Zsh
export AZURE_ENV_NAME="mt-dev"
export AZURE_LOCATION="japaneast"
export AZURE_SUBSCRIPTION_ID="xxxx-xxxx-..."
export SPA_CLIENT_ID="[SPA_CLIENT_ID]"
export API_AUDIENCE="api://[API_CLIENT_ID]"
export API_SCOPE="access_as_user"
export AZURE_OPENAI_LOCATION="eastus"
export AZURE_OPENAI_DEPLOYMENT_MINI="gpt-5.4-mini"
export AZURE_OPENAI_DEPLOYMENT_FULL="gpt-5.4"
export AZURE_SPEECH_LOCATION="japaneast"
```

### 3.2 API 環境変数 (`.env` / コンテナ環境変数)

API コンテナが実行時に参照する環境変数（Bicep で注入）:

```env
# Entra ID
TENANT_ID=[TENANT_ID]                                    # テナント ID
API_AUDIENCE=api://[API_CLIENT_ID]                       # SPA が要求する API audience
API_SCOPE=access_as_user

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://[resource].openai.azure.com/
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_DEPLOYMENT_MINI=gpt-5.4-mini
AZURE_OPENAI_DEPLOYMENT_FULL=gpt-5.4

# Speech
SPEECH_REGION=japaneast
SPEECH_ENDPOINT=https://japaneast.api.cognitive.microsoft.com
SPEECH_RESOURCE_ID=/subscriptions/[SUB_ID]/resourceGroups/[RG]/providers/Microsoft.CognitiveServices/accounts/[SPEECH_RESOURCE]

# Translator
TRANSLATOR_ENDPOINT=https://[resource].cognitiveservices.azure.com/
TRANSLATOR_REGION=japaneast

# Cosmos
COSMOS_ENDPOINT=https://[resource].documents.azure.com:443/
COSMOS_DATABASE=mt
COSMOS_CONTAINER=items

# CORS
CORS_ALLOWED_ORIGINS=https://[YOUR_WEB_APP_URL]

# 翻訳言語
TARGET_LANGUAGE=ja
```

**注**: Azure CLI の認証情報（`AZURE_CLIENT_ID` など）は Managed Identity で自動設定されます。

### 3.3 Web フロントエンド設定

#### ビルド時 (Vite 環境変数)

`.env` または docker-entrypoint.d/40-generate-config.sh で設定:

```env
VITE_TENANT_ID=[TENANT_ID]
VITE_CLIENT_ID=[SPA_CLIENT_ID]
VITE_API_SCOPE=access_as_user
VITE_API_BASE_URL=/api                    # nginx プロキシ経由で localhost
```

#### 実行時 (Nginx コンフィグ)

`nginx.conf` で `/api/*` を API コンテナにプロキシ:

```nginx
location /api/ {
    proxy_pass http://api:8000/;
}
```

#### Nginx ホストヘッダー設定

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

## 4. Bicep パラメーター

`infra/main.parameters.json` に設定する値:

| パラメーター         | 値                                | 出所                    |
| -------------------- | --------------------------------- | ----------------------- |
| `environmentName`    | `${AZURE_ENV_NAME}`               | 環境変数                |
| `location`           | `${AZURE_LOCATION}`               | 環境変数                |
| `tenantId`           | `${TENANT_ID}`                    | Entra ID → テナント ID  |
| `spaClientId`        | `${SPA_CLIENT_ID}`                | SPA App Registration    |
| `apiAudience`        | `${API_AUDIENCE}`                 | `api://[API_CLIENT_ID]` |
| `apiScope`           | `${API_SCOPE}`                    | `access_as_user`        |
| `openAiLocation`     | `${AZURE_OPENAI_LOCATION}`        | 環境変数                |
| `deploymentMiniName` | `${AZURE_OPENAI_DEPLOYMENT_MINI}` | Azure OpenAI            |
| `deploymentFullName` | `${AZURE_OPENAI_DEPLOYMENT_FULL}` | Azure OpenAI            |
| `speechLocation`     | `${AZURE_SPEECH_LOCATION}`        | 環境変数                |

## 5. コンテナレジストリ

### 5.1 Azure Container Registry

`azd` は自動的に ACR を作成できます。手動で指定する場合:

```bash
az acr create --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME --sku Basic --admin-enabled true
```

### 5.2 Docker イメージのビルド・プッシュ

**注意**: [ユーザーメモ](../README.md#docker-aca-tips) を参照。ACA は `linux/amd64` のみをサポートし、provenance attestation によるエラーを避ける必要があります。

```bash
# API
docker buildx build --platform linux/amd64 --provenance=false \
  -t $ACR_URL/api:latest --push src/api/

# Web
docker buildx build --platform linux/amd64 --provenance=false \
  -t $ACR_URL/web:latest --push src/web/
```

## 6. デプロイメント手順

### 6.1 初期セットアップ

```bash
# Azure にサインイン
az login --tenant [TENANT_ID]
az account set --subscription [SUBSCRIPTION_ID]

# azd テンプレート初期化
azd init
```

### 6.2 リソースプロビジョニング

```bash
# 環境変数を設定（上記 3.1 を参照）

# リソースをプロビジョニング
azd provision

# ⚠️ このステップで以下をインタラクティブに入力することが想定されています
# - SPA_CLIENT_ID
# - API_AUDIENCE
# (scripts/preprovision.ps1 / preprovision.sh 参照)
```

### 6.3 デプロイ

```bash
# コンテナをビルド・デプロイ
azd deploy
```

### 6.4 確認

```bash
# デプロイされたリソースを確認
azd env list
az containerapp list -g rg-${AZURE_ENV_NAME} -o table
```

## 7. 実行時の依存関係

### API 依存関係

| 依存関係         | バージョン | 用途                        |
| ---------------- | ---------- | --------------------------- |
| `fastapi`        | 0.115.6    | API フレームワーク          |
| `uvicorn`        | 0.34.0     | ASGI サーバー               |
| `azure-identity` | 1.19.0     | Entra ID + Managed Identity |
| `azure-cosmos`   | 4.9.0      | Cosmos DB クライアント      |
| `openai`         | 1.59.4     | Azure OpenAI クライアント   |
| `python-jose`    | 3.3.0      | JWT 検証                    |
| その他           | —          | `requirements.txt` 参照     |

### Web 依存関係

| 依存関係                                 | バージョン | 用途                |
| ---------------------------------------- | ---------- | ------------------- |
| `@azure/msal-react`                      | 2.2.0      | Entra ID 認証       |
| `react`                                  | 18.3.1     | UI フレームワーク   |
| `microsoft-cognitiveservices-speech-sdk` | 1.42.0     | 音声認識            |
| `vite-plugin-pwa`                        | 0.21.1     | PWA サポート        |
| その他                                   | —          | `package.json` 参照 |

## 8. ネットワーク・セキュリティ

### 8.1 プライベートエンドポイント

Bicep は以下のリソースにプライベートエンドポイントを作成します：

- Azure OpenAI
- Azure AI Translator
- Azure Cosmos DB
- Azure Container Registry

### 8.2 VNET 構成

```
VNET: 10.50.0.0/16
├── ACA Subnet: 10.50.0.0/23
└── Private Endpoint Subnet: 10.50.2.0/24
```

### 8.3 NSG / ファイアウォール

- ACA は外部トラフィックを受け入れる（Web コンテナ）
- API コンテナは ACA 内部ネットワーク通信のみ
- All Azure services にアクセス可能（Managed Identity）

## 9. トラブルシューティング

### 問題: `"Selected tag uses an invalid operating system''"`

**原因**: Docker buildx が provenance attestation を付加している

**解決策**:

```bash
docker buildx build --platform linux/amd64 --provenance=false -t <image>:latest .
```

### 問題: `MSAL redirect URI mismatch`

**確認事項**:

- SPA App Registration の **Redirect URIs** がデプロイ後の Web URL と一致しているか
- 開発時は `http://localhost:5173` を追加

### 問題: `Cosmos DB connection timeout`

**確認事項**:

- API コンテナが **Managed Identity** を持っているか
- Cosmos DB の **Access Control** で Managed Identity に権限があるか
- VNet がプライベートエンドポイントに接続できているか

### 問題: Azure OpenAI `DeploymentNotFound`

**確認事項**:

- `AZURE_OPENAI_DEPLOYMENT_MINI` / `AZURE_OPENAI_DEPLOYMENT_FULL` が Azure OpenAI リソースに存在するか
- デプロイ名は大文字小文字を区別するか確認

## 10. チェックリスト

デプロイ前に以下を確認してください：

- [ ] Azure サブスクリプションへのアクセス権
- [ ] Entra ID テナント ID を入手
- [ ] SPA App Registration を作成 → `SPA_CLIENT_ID` を記録
- [ ] API App Registration を作成 → `API_CLIENT_ID` を記録
- [ ] SPA アプリに API スコープ権限を追加
- [ ] `AZURE_ENV_NAME`, `AZURE_LOCATION` を設定
- [ ] Azure OpenAI リソースと デプロイ (gpt-5.4-mini, gpt-5.4) を確認
- [ ] Azure AI Translator リソースを確認
- [ ] Azure AI Speech リソースを確認
- [ ] Azure Cosmos DB アカウントを確認
- [ ] Docker/`azd` をインストール
- [ ] `azd provision` を実行
- [ ] `azd deploy` を実行
- [ ] デプロイされたアプリにアクセスして動作確認
