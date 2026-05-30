# デプロイメントガイド

このガイドは、現在の `azd + Bicep + Azure Container Apps` 実装に合わせた手順です。

## 1. 前提条件

- Azure CLI (`az`)
- Azure Developer CLI (`azd`)
- Docker
- Entra ID App Registration を作成できる権限
- サブスクリプションでリソース作成・ロール割り当て可能な権限

## 2. App Registration 準備

このアプリは 2 つの App Registration を使います。

- SPA App Registration
  - 取得値: `SPA_CLIENT_ID`
  - Redirect URI: 開発時 `http://localhost:5173`
- API App Registration
  - Expose an API: `api://<api-app-client-id>`
  - Scope: `access_as_user`
  - 取得値: `API_AUDIENCE=api://<api-app-client-id>`

## 3. azd 環境の作成

```powershell
azd auth login
az login
azd env new mtrans-dev
```

最低限、以下は必須です。

```powershell
azd env set AZURE_LOCATION japaneast
azd env set SPA_CLIENT_ID <spa-client-id>
azd env set API_AUDIENCE api://<api-app-client-id>
```

`azd up` / `azd provision` 実行時は、`azure.yaml` に従って Windows では `scripts/preprovision.ps1`、POSIX 環境では `scripts/preprovision.sh` が自動実行されます。

必要に応じて以下も設定します。

```powershell
azd env set API_SCOPE access_as_user
azd env set AZURE_OPENAI_LOCATION eastus2
azd env set AZURE_SPEECH_LOCATION japaneast
azd env set PASSKEY_AUTH_CONTEXT_ID <optional-auth-context-id>

azd env set AZURE_OPENAI_DEPLOYMENT_MINI gpt-5.4-mini
azd env set AZURE_OPENAI_DEPLOYMENT_FULL gpt-5.4
azd env set AZURE_OPENAI_MODEL_MINI gpt-4o-mini
azd env set AZURE_OPENAI_MODEL_FULL gpt-4o
```

- `AZURE_OPENAI_DEPLOYMENT_MINI` / `AZURE_OPENAI_DEPLOYMENT_FULL` は、実際に Azure OpenAI リソース上で利用するデプロイ名と一致させてください。
- `AZURE_OPENAI_MODEL_MINI` / `AZURE_OPENAI_MODEL_FULL` は Bicep が Azure OpenAI デプロイを作成する際のモデル名であり、API コンテナのランタイム環境変数としては使われません。

## 4. `.env` から一括反映（任意）

ルート `.env.example` を `.env` としてコピーし値を埋めたうえで、次を実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import-env-to-azd.ps1 -EnvFile .env -AzdEnvironment mtrans-dev
```

この方法では、`.env` に書いた任意の `AZURE_OPENAI_DEPLOYMENT_*` / `AZURE_OPENAI_MODEL_*` / `PASSKEY_AUTH_CONTEXT_ID` もまとめて `azd env` に取り込めます。

確認のみの場合:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import-env-to-azd.ps1 -EnvFile .env -AzdEnvironment mtrans-dev -DryRun
```

## 5. 事前チェック

Bicep の構文チェック:

```powershell
az bicep build --file infra/main.bicep --outfile $env:TEMP\mobile-translator-main.json
```

Web ビルド確認:

```powershell
cd src\web
npm.cmd ci
npm.cmd run build -- --mode production
cd ..\..
```

API import 確認:

```powershell
cd src\api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -c "import app.main; print('OK')"
cd ..\..
```

## 6. デプロイ

通常:

```powershell
azd up
```

切り分け時:

```powershell
azd provision
azd deploy
```

## 7. 初回デプロイ後の設定

```powershell
azd env get-values
```

- `SERVICE_WEB_URI` を確認
- SPA App Registration の Redirect URI に `SERVICE_WEB_URI` を追加

## 8. 動作確認

- `SERVICE_WEB_URI` にアクセス
- サインイン
- セッション作成
- 録音開始し、発話と和訳が表示されることを確認
- 直近要約・長期要約・トピック・質問生成を確認
- `GET /api/healthz` が `{"status":"ok"}` を返すことを確認

## 9. 主要な実装上の補足

- API は内部 Ingress、Web は外部 Ingress
- Web の `/api/*` は Nginx 経由で API へプロキシ
- API の Azure 認証は Managed Identity 前提
- Azure デプロイ時の `SPEECH_RESOURCE_ID` は Container Apps に自動注入される。ローカル API 実行時は `src/api/.env.example` をもとに `.env` へ設定が必要
- OpenAI / Translator / Cosmos / ACR は Private Endpoint を利用
- Speech はブラウザ接続のため public network access 有効

## 10. トラブルシュート

- `AADSTS500011`
  - `API_AUDIENCE` が API 側の URI (`api://<api-app-client-id>`) か確認
- Container Apps が ACR から pull できない
  - `AcrPull` ロールの伝播待ち後に `azd deploy` を再実行
- buildx の OS/manifest エラー
  - `--platform linux/amd64 --provenance=false` でビルド
