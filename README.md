# Mobile Translator

スマホのマイクで聞き取った内容を逐次日本語訳し、Azure OpenAI で直近要約・長期要約・Q&A 候補・質問文を生成する PWA です。Azure Container Apps 上に Web と API をホストし、データは Cosmos DB に永続化します。

English documentation is available in [README-en.md](README-en.md).

## サービス仕様

### ユーザー向け機能

| 機能         | 仕様                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| 音声収録     | スマホブラウザのマイクを使用。PWA として動作します。                                                          |
| 音声認識     | Azure Speech SDK をブラウザから直接利用し、連続認識します。入力言語はユーザーがセッション作成時に選択します。 |
| 翻訳         | 認識済み発話を API に送信し、Azure AI Translator で日本語に翻訳します。                                       |
| 直近要約     | 録音中に 3 セグメントごと、または手動操作で Azure OpenAI `gpt-5.4-mini` を使って直近文脈を要約します。        |
| 長期要約     | 手動操作で Azure OpenAI `gpt-5.4` を使ってセッション全体を構造化要約します。                                  |
| Q&A 候補     | 直近要約から Q&A 候補トピックを生成します。                                                                   |
| 質問生成     | Q&A 候補トピックを選択すると、議論を深める質問文を生成します。                                                |
| 永続化       | セッション、発話、翻訳、要約、トピック、質問を Cosmos DB に保存します。                                       |
| ユーザー認証 | MSAL.js で自社 Microsoft Entra ID テナントにサインインします。                                                |

### アーキテクチャ

```text
Mobile Browser (PWA)
  |
  | HTTPS / MSAL access token
  v
Azure Container Apps - Web (nginx + static PWA, external ingress)
  |
  | /api/* same-origin proxy
  v
Azure Container Apps - API (FastAPI, internal ingress, system-assigned managed identity)
  |-- Azure OpenAI: gpt-5.4-mini / gpt-5.4 (Private Endpoint)
  |-- Azure AI Translator (Private Endpoint)
  |-- Azure Cosmos DB for NoSQL (Private Endpoint)
  `-- Azure Speech token broker

Mobile Browser (Speech SDK)
  |
  | aad#<speech-resource-id>#<entra-token>
  v
Azure AI Speech
```

### Azure リソース

| リソース                                          | 用途                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| Azure Container Apps                              | Web PWA と FastAPI API をホストします。                                     |
| Azure Container Registry                          | azd がビルドしたコンテナイメージを保存します。                              |
| Azure Cosmos DB for NoSQL                         | セッション・発話・翻訳・要約・Q&A 情報を保存します。                        |
| Azure OpenAI                                      | `gpt-5.4-mini` と `gpt-5.4` のデプロイを作成します。                        |
| Azure AI Speech                                   | ブラウザ Speech SDK のリアルタイム音声認識に使用します。                    |
| Azure AI Translator                               | 発話テキストを日本語へ翻訳します。                                          |
| Virtual Network / Private Endpoints / Private DNS | API から OpenAI、Translator、Cosmos、ACR へのプライベート接続を提供します。 |
| Log Analytics / Application Insights              | Container Apps のログとアプリケーション監視に使用します。                   |

### 認証とロール

| 主体                                    | 対象                | 権限                                                                |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------- |
| エンドユーザー                          | API                 | MSAL access token。API は `tid`、`iss`、`aud`、`scp` を検証します。 |
| API Container App の System-Assigned MI | Azure OpenAI        | Cognitive Services OpenAI User                                      |
| API Container App の System-Assigned MI | Speech / Translator | Cognitive Services User                                             |
| API Container App の System-Assigned MI | Cosmos DB           | Cosmos DB Built-in Data Contributor                                 |
| Container Apps pull 用 User-Assigned MI | ACR                 | AcrPull                                                             |

API キーは使用しません。Azure サービス間認証は Managed Identity で行います。

## デプロイ前に行う作業

### 1. 必要なツールを用意する

| ツール                      | 用途                                         |
| --------------------------- | -------------------------------------------- |
| Azure Developer CLI (`azd`) | `azd up` によるプロビジョニングとデプロイ    |
| Azure CLI (`az`)            | ログイン、Bicep build、App Registration 確認 |
| Docker                      | API / Web コンテナイメージのビルド           |
| Node.js 20+                 | Web PWA のローカル build                     |
| Python 3.12+                | API のローカル確認                           |

### 2. Azure と Entra ID の権限を確認する

デプロイ実行者には、少なくとも次の権限が必要です。

- 対象サブスクリプションでリソースを作成できる権限。
- Bicep がロール割り当てを作成できる権限。通常は `Owner`、または `Contributor` + `User Access Administrator` が必要です。
- Microsoft Entra ID で App Registration を作成・更新できる権限。
- Azure OpenAI の対象リージョンで `gpt-5.4-mini` と `gpt-5.4` をデプロイできる quota とモデル利用権限。

### 3. リージョンとモデル availability を決める

次を決めておきます。

| 値                      | 例          | 説明                                                            |
| ----------------------- | ----------- | --------------------------------------------------------------- |
| `AZURE_LOCATION`        | `japaneast` | Container Apps、Cosmos、Translator などの主要リージョン         |
| `AZURE_OPENAI_LOCATION` | `eastus2`   | `gpt-5.4-mini` / `gpt-5.4` が利用できる Azure OpenAI リージョン |
| `AZURE_SPEECH_LOCATION` | `japaneast` | Speech リソースのリージョン。省略時は `AZURE_LOCATION`          |

### 4. Entra ID App Registration を作成する

このアプリでは、API 用 App Registration と SPA 用 App Registration を用意します。

1. API 用 App Registration を作成します。
2. **Expose an API** で Application ID URI を設定します。例: `api://<api-app-client-id>`
3. scope `access_as_user` を追加します。
4. SPA 用 App Registration を作成します。
5. SPA の platform に `Single-page application` を追加し、まず `http://localhost:5173` を redirect URI に追加します。
6. SPA に API scope (`api://<api-app-client-id>/access_as_user`) への permission を追加し、必要に応じて管理者同意を与えます。
7. 次の値を控えます。

| 値                     | 使い道                                          |
| ---------------------- | ----------------------------------------------- |
| SPA Client ID          | `SPA_CLIENT_ID`                                 |
| API Application ID URI | `API_AUDIENCE`。例: `api://<api-app-client-id>` |
| API scope short name   | `API_SCOPE`。既定は `access_as_user`            |

初回デプロイ後に Web の URL が確定したら、SPA App Registration の redirect URI に `https://<web-fqdn>` を追加します。

## デプロイ手順

### 1. Azure にログインする

```powershell
azd auth login
az login
```

### 2. azd environment を作成する

```powershell
azd env new mtrans-dev
azd env set AZURE_LOCATION japaneast
azd env set AZURE_OPENAI_LOCATION eastus2
azd env set AZURE_SPEECH_LOCATION japaneast
azd env set SPA_CLIENT_ID <spa-client-id>
azd env set API_AUDIENCE api://<api-app-client-id>
azd env set API_SCOPE access_as_user
azd env set PASSKEY_AUTH_CONTEXT_ID <auth-context-id>
```

`PASSKEY_AUTH_CONTEXT_ID` は任意です。Entra 側で Authentication Context を設定している場合に指定すると、モバイルのサインインでパスキー系ポリシーに誘導できます。

モデルデプロイ名を変える場合のみ、次も設定します。

```powershell
azd env set AZURE_OPENAI_DEPLOYMENT_MINI gpt-5.4-mini
azd env set AZURE_OPENAI_DEPLOYMENT_FULL gpt-5.4
```

`.env` に値をまとめている場合は、`scripts/import-env-to-azd.ps1` で一括反映できます。

```powershell
# 例: mtrans-dev 環境へ .env の値を一括反映
pwsh -File .\scripts\import-env-to-azd.ps1 -EnvFile .env -AzdEnvironment mtrans-dev

# 反映せず確認だけしたい場合
pwsh -File .\scripts\import-env-to-azd.ps1 -EnvFile .env -AzdEnvironment mtrans-dev -DryRun
```

`.env` を使う場合は `PASSKEY_AUTH_CONTEXT_ID=<auth-context-id>` を追加できます（未設定なら空で問題ありません）。

このリポジトリでは `azd env set API_SCOPE` の値は短縮名 `access_as_user` を使用します。
Web 実行時の完全な scope (`api://<api-app-client-id>/access_as_user`) はインフラ設定側で組み立てられます。

### 3. ローカルで構成を検証する

```powershell
az bicep build --file infra/main.bicep --outfile $env:TEMP\mobile-translator-main.json
```

Web build を確認する場合:

```powershell
cd src\web
npm.cmd ci
npm.cmd run build -- --mode production
cd ..\..
```

API import を確認する場合:

```powershell
cd src\api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -c "import app.main; print('OK')"
cd ..\..
```

### 4. Azure にプロビジョニング・デプロイする

通常は次だけで構いません。

```powershell
azd up
```

問題切り分けをしやすくする場合は、分けて実行します。

```powershell
azd provision
azd deploy
```

ACR の `AcrPull` ロール伝播直後は Container Apps がイメージを pull できないことがあります。その場合は数分待ってから `azd deploy` を再実行してください。

### 5. 初回デプロイ後に redirect URI を追加する

Web URL を確認します。

```powershell
azd env get-values
```

`SERVICE_WEB_URI` の値をコピーし、SPA App Registration の redirect URI に追加します。

例:

```text
https://ca-web-<hash>.<region>.azurecontainerapps.io
```

redirect URI 追加後、再デプロイは不要です。Container Apps の環境変数を変えた場合のみ `azd deploy web` を実行してください。

### 6. 動作確認する

1. `SERVICE_WEB_URI` をブラウザで開きます。
2. 自社 Entra ID アカウントでサインインします。
3. セッションを作成し、入力言語を選びます。
4. 録音を開始し、ブラウザのマイク権限を許可します。
5. 原文と日本語訳が逐次表示されることを確認します。
6. 3 セグメント程度の発話後、直近要約が生成されることを確認します。
7. 長期要約、Q&A トピック生成、質問文生成を実行します。
8. `/api/healthz` が同一オリジンで `{"status":"ok"}` を返すことを確認します。

## ローカル開発

### API

```powershell
cd src\api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

`.env` には `TENANT_ID`、`API_AUDIENCE`、Azure OpenAI / Speech / Translator / Cosmos の endpoint を設定します。テンプレートは `src/api/.env.example` です。ローカル実行では `DefaultAzureCredential` を使うため、`az login` したユーザーに対象リソースのロールが必要です。

### Web

```powershell
cd src\web
npm.cmd ci
npm.cmd run dev
```

`.env.local` のテンプレートは `src/web/.env.local.example` です。

```text
VITE_TENANT_ID=<tenant-id>
VITE_CLIENT_ID=<spa-client-id>
VITE_API_SCOPE=api://<api-app-client-id>/access_as_user
VITE_API_BASE_URL=http://localhost:8000
```

## GitHub 公開時にコミットしないもの

`.gitignore` で、実値を含みうる以下のファイル・ディレクトリを除外しています。

| 除外対象                                           | 理由                                                            | 代替テンプレート                                                     |
| -------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `.azure/`                                          | azd のサブスクリプション、テナント、環境値を含みます。          | `.env.example`                                                       |
| `.env`, `.env.*`, `*.env`, `*.env.*`               | ローカルの tenant、client ID、endpoint、secret を含みうるため。 | `.env.example`, `src/api/.env.example`, `src/web/.env.local.example` |
| `*.key`, `*.pem`, `*.pfx`, `*.p12`, 証明書ファイル | 秘密鍵や証明書を含むため。                                      | なし。必要な場合は安全なシークレット管理に保存してください。         |
| `node_modules/`, `dist/`, `.venv/`, `__pycache__/` | 生成物・ローカル依存関係のため。                                | `package-lock.json`, `requirements.txt`                              |
| `*.parameters.local.json`                          | 個人・環境固有の Azure パラメータを含みうるため。               | `infra/main.parameters.json`                                         |

## API リファレンス

| メソッド | パス                                           | 説明                                            |
| -------- | ---------------------------------------------- | ----------------------------------------------- |
| GET      | `/api/healthz`                                 | API health check                                |
| POST     | `/api/speech/token`                            | Speech SDK 用の短命 Entra ID token を返します。 |
| POST     | `/api/sessions`                                | セッションを作成します。                        |
| GET      | `/api/sessions`                                | 自分のセッション一覧を取得します。              |
| GET      | `/api/sessions/{id}`                           | セッションの全ドキュメントを取得します。        |
| POST     | `/api/sessions/{id}/segments`                  | 発話を翻訳して保存します。                      |
| POST     | `/api/sessions/{id}/summary/recent`            | `gpt-5.4-mini` で直近要約を生成します。         |
| POST     | `/api/sessions/{id}/summary/long`              | `gpt-5.4` で長期要約を生成します。              |
| POST     | `/api/sessions/{id}/topics`                    | 直近要約から Q&A 候補トピックを生成します。     |
| POST     | `/api/sessions/{id}/topics/{topicId}/question` | 選択トピックから質問文を生成します。            |

## データモデル

Cosmos DB database は `mt`、container は `items`、partition key は `/sessionId` です。

| `type`     | 内容                                                         |
| ---------- | ------------------------------------------------------------ |
| `session`  | セッションのタイトル、入力言語、所有ユーザー OID             |
| `segment`  | 発話単位の原文、日本語訳、連番                               |
| `summary`  | `recent` または `long` の要約本文、対象 seq 範囲、利用モデル |
| `topic`    | Q&A 候補トピックと生成根拠                                   |
| `question` | 選択トピックから生成された質問文                             |

## 運用上の注意

- Speech SDK はブラウザから Azure Speech に直接接続します。そのため Speech リソースは public ingress を有効にし、API が Managed Identity で取得した Entra ID token を `aad#<resourceId>#<token>` 形式で短命に渡します。
- Web は外部公開、API は内部 ingress です。ブラウザは Web の `/api/*` を呼び、nginx が VNet 内の API Container App にプロキシします。
- Azure OpenAI、Translator、Cosmos DB、ACR は Private Endpoint 経由で API または Container Apps から利用します。
- API キーや接続文字列は使いません。アプリ実行時の Azure サービス認証は Managed Identity です。
- PWA の service worker は API response と runtime `config.js` を precache しません。
- `azd down` はリソース削除を伴います。実行前に Cosmos DB のデータ保持要件を確認してください。
