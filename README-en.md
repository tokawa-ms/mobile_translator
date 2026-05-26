# Mobile Translator

Mobile Translator is a PWA that captures speech from a smartphone microphone, translates recognized speech into Japanese, and uses Azure OpenAI to generate recent summaries, long-range summaries, Q&A candidate topics, and suggested questions. The Web app and API run on Azure Container Apps, and application data is persisted in Cosmos DB.

Japanese documentation is available in [README.md](README.md).

## Service specification

### User-facing features

| Feature             | Specification                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Audio capture       | Uses the smartphone browser microphone. The client runs as a PWA.                                                                      |
| Speech recognition  | Uses Azure Speech SDK directly from the browser for continuous recognition. The source language is selected when creating a session.   |
| Translation         | Sends finalized recognition results to the API and translates them into Japanese with Azure AI Translator.                             |
| Recent summary      | Uses Azure OpenAI `gpt-5.4-mini` to summarize recent context automatically every 3 segments during recording, or manually from the UI. |
| Long-range summary  | Uses Azure OpenAI `gpt-5.4` to create a structured summary of the whole session.                                                       |
| Q&A topics          | Generates candidate Q&A topics from the latest recent summary.                                                                         |
| Question generation | Generates a focused Japanese question from a selected topic.                                                                           |
| Persistence         | Stores sessions, segments, translations, summaries, topics, and questions in Cosmos DB.                                                |
| User authentication | Uses MSAL.js to sign users into the organization Microsoft Entra ID tenant.                                                            |

### Architecture

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

### Azure resources

| Resource                                          | Purpose                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Azure Container Apps                              | Hosts the Web PWA and FastAPI API.                                                    |
| Azure Container Registry                          | Stores container images built by azd.                                                 |
| Azure Cosmos DB for NoSQL                         | Stores sessions, segments, translations, summaries, and Q&A data.                     |
| Azure OpenAI                                      | Creates deployments for `gpt-5.4-mini` and `gpt-5.4`.                                 |
| Azure AI Speech                                   | Provides real-time browser speech recognition through the Speech SDK.                 |
| Azure AI Translator                               | Translates recognized text into Japanese.                                             |
| Virtual Network / Private Endpoints / Private DNS | Provides private connectivity from the API to OpenAI, Translator, Cosmos DB, and ACR. |
| Log Analytics / Application Insights              | Provides logs and application monitoring for Container Apps.                          |

### Authentication and roles

| Principal                            | Target              | Permission                                                           |
| ------------------------------------ | ------------------- | -------------------------------------------------------------------- |
| End user                             | API                 | MSAL access token. The API validates `tid`, `iss`, `aud`, and `scp`. |
| API Container App system-assigned MI | Azure OpenAI        | Cognitive Services OpenAI User                                       |
| API Container App system-assigned MI | Speech / Translator | Cognitive Services User                                              |
| API Container App system-assigned MI | Cosmos DB           | Cosmos DB Built-in Data Contributor                                  |
| Container Apps pull user-assigned MI | ACR                 | AcrPull                                                              |

The application does not use API keys. Service-to-service authentication uses managed identity.

## Pre-deployment tasks

### 1. Install required tools

| Tool                        | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| Azure Developer CLI (`azd`) | Provisioning and deployment with `azd up`       |
| Azure CLI (`az`)            | Login, Bicep build, and App Registration checks |
| Docker                      | Building API and Web container images           |
| Node.js 20+                 | Local Web PWA builds                            |
| Python 3.12+                | Local API checks                                |

### 2. Confirm Azure and Entra ID permissions

The deployment operator needs at least the following permissions:

- Permission to create resources in the target Azure subscription.
- Permission to create role assignments from Bicep. Typically this means `Owner`, or `Contributor` plus `User Access Administrator`.
- Permission to create and update Microsoft Entra ID App Registrations.
- Quota and model access to deploy `gpt-5.4-mini` and `gpt-5.4` in the selected Azure OpenAI region.

### 3. Choose regions and model availability

Decide these values before deployment.

| Value                   | Example     | Description                                                                     |
| ----------------------- | ----------- | ------------------------------------------------------------------------------- |
| `AZURE_LOCATION`        | `japaneast` | Primary region for Container Apps, Cosmos DB, Translator, and related resources |
| `AZURE_OPENAI_LOCATION` | `eastus2`   | Azure OpenAI region where `gpt-5.4-mini` and `gpt-5.4` are available            |
| `AZURE_SPEECH_LOCATION` | `japaneast` | Speech resource region. Defaults to `AZURE_LOCATION` if omitted                 |

### 4. Create Entra ID App Registrations

This app uses separate App Registrations for the API and SPA.

1. Create the API App Registration.
2. In **Expose an API**, set an Application ID URI. Example: `api://<api-app-client-id>`
3. Add the scope `access_as_user`.
4. Create the SPA App Registration.
5. Add the `Single-page application` platform and add `http://localhost:5173` as an initial redirect URI.
6. Add API permission from the SPA to the API scope (`api://<api-app-client-id>/access_as_user`) and grant admin consent if required.
7. Keep these values:

| Value                  | Used as                                                 |
| ---------------------- | ------------------------------------------------------- |
| SPA Client ID          | `SPA_CLIENT_ID`                                         |
| API Application ID URI | `API_AUDIENCE`, for example `api://<api-app-client-id>` |
| API scope short name   | `API_SCOPE`. Default: `access_as_user`                  |

After the first deployment, add the deployed Web URL (`https://<web-fqdn>`) to the SPA App Registration redirect URIs.

## Deployment guide

### 1. Sign in to Azure

```powershell
azd auth login
az login
```

### 2. Create an azd environment

```powershell
azd env new mtrans-dev
azd env set AZURE_LOCATION japaneast
azd env set AZURE_OPENAI_LOCATION eastus2
azd env set AZURE_SPEECH_LOCATION japaneast
azd env set SPA_CLIENT_ID <spa-client-id>
azd env set API_AUDIENCE api://<api-app-client-id>
azd env set API_SCOPE access_as_user
```

Only set these if you want to change the deployment names:

```powershell
azd env set AZURE_OPENAI_DEPLOYMENT_MINI gpt-5.4-mini
azd env set AZURE_OPENAI_DEPLOYMENT_FULL gpt-5.4
```

### 3. Validate locally

```powershell
az bicep build --file infra/main.bicep --outfile $env:TEMP\mobile-translator-main.json
```

To validate the Web build:

```powershell
cd src\web
npm.cmd ci
npm.cmd run build -- --mode production
cd ..\..
```

To validate API imports:

```powershell
cd src\api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -c "import app.main; print('OK')"
cd ..\..
```

### 4. Provision and deploy to Azure

For the normal deployment path:

```powershell
azd up
```

For easier troubleshooting, run provisioning and deployment separately:

```powershell
azd provision
azd deploy
```

Immediately after `AcrPull` role assignment creation, Container Apps may temporarily fail to pull images from ACR while RBAC propagates. Wait a few minutes and rerun `azd deploy` if that happens.

### 5. Add the production redirect URI after first deployment

Print the deployed values:

```powershell
azd env get-values
```

Copy `SERVICE_WEB_URI` and add it to the SPA App Registration redirect URIs.

Example:

```text
https://ca-web-<hash>.<region>.azurecontainerapps.io
```

No redeployment is required after adding the redirect URI. Run `azd deploy web` only if you changed Container Apps environment variables or Web code.

### 6. Verify the deployment

1. Open `SERVICE_WEB_URI` in a browser.
2. Sign in with an account from the organization Entra ID tenant.
3. Create a session and select the source language.
4. Start recording and allow microphone access.
5. Confirm that recognized source text and Japanese translations appear incrementally.
6. Speak at least three recognized segments and confirm that a recent summary is generated.
7. Run long summary, Q&A topic generation, and question generation.
8. Confirm that `/api/healthz` returns `{"status":"ok"}` from the same origin.

## Local development

### API

```powershell
cd src\api
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

Set `TENANT_ID`, `API_AUDIENCE`, and the Azure OpenAI / Speech / Translator / Cosmos DB endpoints in `.env`. The template is `src/api/.env.example`. Local execution uses `DefaultAzureCredential`, so the signed-in `az login` user must have the required roles on the target resources.

### Web

```powershell
cd src\web
npm.cmd ci
npm.cmd run dev
```

Use `src/web/.env.local.example` as the `.env.local` template.

```text
VITE_TENANT_ID=<tenant-id>
VITE_CLIENT_ID=<spa-client-id>
VITE_API_SCOPE=api://<api-app-client-id>/access_as_user
VITE_API_BASE_URL=http://localhost:8000
```

## Files that must not be committed to GitHub

`.gitignore` excludes files and directories that may contain real environment values or local artifacts.

| Excluded item                                         | Reason                                                           | Template or source of truth                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `.azure/`                                             | Contains azd subscription, tenant, and environment values.       | `.env.example`                                                       |
| `.env`, `.env.*`, `*.env`, `*.env.*`                  | May contain local tenant IDs, client IDs, endpoints, or secrets. | `.env.example`, `src/api/.env.example`, `src/web/.env.local.example` |
| `*.key`, `*.pem`, `*.pfx`, `*.p12`, certificate files | May contain private keys or certificates.                        | None. Store them in a secure secret store if needed.                 |
| `node_modules/`, `dist/`, `.venv/`, `__pycache__/`    | Generated dependencies or local build artifacts.                 | `package-lock.json`, `requirements.txt`                              |
| `*.parameters.local.json`                             | May contain personal or environment-specific Azure parameters.   | `infra/main.parameters.json`                                         |

## API reference

| Method | Path                                           | Description                                                        |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/healthz`                                 | API health check                                                   |
| POST   | `/api/speech/token`                            | Returns a short-lived Entra ID token formatted for the Speech SDK. |
| POST   | `/api/sessions`                                | Creates a session.                                                 |
| GET    | `/api/sessions`                                | Lists sessions owned by the current user.                          |
| GET    | `/api/sessions/{id}`                           | Gets all documents for a session.                                  |
| POST   | `/api/sessions/{id}/segments`                  | Translates and stores one recognized speech segment.               |
| POST   | `/api/sessions/{id}/summary/recent`            | Generates a recent summary with `gpt-5.4-mini`.                    |
| POST   | `/api/sessions/{id}/summary/long`              | Generates a long-range summary with `gpt-5.4`.                     |
| POST   | `/api/sessions/{id}/topics`                    | Generates Q&A candidate topics from the latest recent summary.     |
| POST   | `/api/sessions/{id}/topics/{topicId}/question` | Generates a question from the selected topic.                      |

## Data model

Cosmos DB database: `mt`; container: `items`; partition key: `/sessionId`.

| `type`     | Content                                                         |
| ---------- | --------------------------------------------------------------- |
| `session`  | Session title, source language, owner user OID                  |
| `segment`  | Source text, Japanese translation, and sequence number          |
| `summary`  | `recent` or `long` summary text, sequence range, and model used |
| `topic`    | Q&A candidate topic and rationale                               |
| `question` | Generated question text for a selected topic                    |

## Operational notes

- The Speech SDK connects from the browser directly to Azure Speech. Therefore the Speech resource has public ingress enabled, while the API brokers short-lived Entra ID tokens in `aad#<resourceId>#<token>` format using managed identity.
- The Web app is externally exposed. The API uses internal ingress. Browsers call `/api/*` on the Web origin, and nginx proxies requests to the API Container App inside the VNet.
- Azure OpenAI, Translator, Cosmos DB, and ACR are accessed through Private Endpoints by the API or Container Apps.
- The application does not use API keys or connection strings for runtime Azure service access. Managed identity is used instead.
- The PWA service worker does not precache API responses or runtime `config.js`.
- `azd down` deletes Azure resources. Confirm Cosmos DB data retention requirements before running it.
