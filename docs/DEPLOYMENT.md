# Deployment Guide — OpenCode Pro

This guide walks through deploying OpenCode Pro to Azure from scratch. By the end, you will have a production-ready instance running as an Azure Function, with secrets stored securely in Key Vault and deployments automated via GitHub Actions.

---

## Prerequisites

- An **Azure subscription** with Contributor access
- A **GitHub account** to register the GitHub App
- **Node.js 20+** installed locally (for local development and testing)
- **Azure CLI** installed (`az` command available)
- A GitHub repository where the OpenCode Pro code lives (fork or clone)

---

## Step 1: Clone and Set Up Locally

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
npm ci
```

Copy the environment template and fill in placeholder values:

```bash
cp .env.example .env
```

At this stage you only need to fill in LLM provider keys for local testing (GitHub App credentials come later):

```bash
# .env
OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY=sk-ant-...
```

Verify the project builds and passes lint:

```bash
npm run lint
npm test
```

---

## Step 2: Register a GitHub App

You need a GitHub App to receive webhook events. You can register one manually or use the manifest flow.

### Option A: Manifest Flow (recommended)

The `app.yml` file in the repo root contains a complete GitHub App manifest. Use it to register via the manifest flow:

1. Go to your organization or user's **Settings > Developer settings > GitHub Apps > New GitHub App**
2. Instead of filling the form, look for (or navigate to) the manifest flow URL. For an organization, it is:

   ```
   https://github.com/organizations/<org>/settings/apps/new?url=https://example.com/app.yml
   ```

   Replace `<org>` with your organization name. The `url` parameter points to the raw manifest. You can host the manifest at a public URL or paste its contents into the flow.

3. Alternatively, create the app manually with these settings:

   | Setting | Value |
   |---------|-------|
   | **GitHub App name** | `OpenCode Pro` (or a unique name you choose) |
   | **Homepage URL** | `https://github.com/<owner>/opencode-pro` |
   | **Webhook URL** | Leave blank for now (fill after Azure deploys) |
   | **Webhook secret** | Generate a strong random string and save it |
   | **Permissions** | Metadata: Read, Issues: Write, Pull Requests: Write, Contents: Write, Checks: Write, Discussions: Write |
   | **Events** | Issues, Issue comment, Pull request, Pull request review, Pull request review comment, Check run, Check suite, Push, Create, Pull request review thread |
   | **Where can this app be installed?** | Any account |

4. After creating the app, generate a **private key** and download it. Save the PEM file securely.

5. Note these three values — you will need them in Step 5:
   - **App ID** (number, top-left on the app page)
   - **Private key** (the PEM file contents)
   - **Webhook secret** (the string you generated)

### Option B: Manual Registration

Alternatively, use [probot/settings](https://probot.github.io/docs/development/#configuring-a-github-app) or the [GitHub App manifest endpoint](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest#using-the-github-app-manifest-flow) to register programmatically.

```bash
# Convert app.yml to URL-encoded manifest and open the registration flow
npx probot create --manifest app.yml
```

---

## Step 3: Configure Azure

### Create a Service Principal for OIDC

The deploy workflow authenticates to Azure using OIDC (no secrets in GitHub). Set this up once:

```bash
# Create an app registration
az ad app create \
  --display-name "github-actions-opencode-pro" \
  --sign-in-audience AzureADMyOrg

# Note the appId and tenant from the output
APP_ID=$(az ad app list --display-name "github-actions-opencode-pro" --query "[0].appId" -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

# Create a service principal for the app
az ad sp create --id "$APP_ID"
```

### Add a Federated Credential

Trust GitHub Actions to request tokens for this service principal:

```bash
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-actions-opencode",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<OWNER>/<REPO>:ref:refs/heads/main",
    "description": "OIDC trust for OpenCode Pro deployments",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

Replace `<OWNER>/<REPO>` with your GitHub repository path (e.g., `anomalyco/opencode-pro`).

### Grant Contributor Role

Give the service principal permission to create resources:

```bash
az role assignment create \
  --assignee "$APP_ID" \
  --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID"
```

### Add GitHub Secrets

Add these secrets to your GitHub repository under **Settings > Secrets and variables > Actions**:

| Secret name | Value |
|-------------|-------|
| `AZURE_CLIENT_ID` | The `appId` from the app registration |
| `AZURE_TENANT_ID` | Your Azure tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Your Azure subscription ID |

Also create a **GitHub Environment** named `production` (used by the deploy workflow):

1. Go to **Settings > Environments > New environment**
2. Name it `production`
3. No other configuration is needed for OIDC-based deployments

---

## Step 4: Deploy to Azure

Run the deploy workflow from the **Actions** tab:

1. Navigate to **Actions > Deploy to Azure**
2. Click **Run workflow**
3. Fill in the parameters:

   | Parameter | Suggested value |
   |-----------|-----------------|
   | `location` | `eastus` |
   | `resourceGroupName` | `rg-opencode-pro` |
   | `functionAppName` | `func-opencode-pro-<random>` (must be globally unique) |
   | `keyVaultName` | `kv-opencode-pro-<random>` (must be globally unique) |
   | `storageAccountName` | `stopencodepro<random>` (must be globally unique, lowercase, 3-24 chars) |

   Resource names must be globally unique across Azure. Add a suffix (your initials, a random string) to avoid conflicts.

4. Click **Run workflow**

The workflow will:
- Build and lint the code
- Upload the build artifact
- Deploy the Bicep template (resource group, storage account, Key Vault, App Service Plan, Function App)
- Deploy the function code

After deployment completes, note the **Function App URL** from the Azure portal (under your Function App > Overview). It will look like:

```
https://func-opencode-pro-<unique>.azurewebsites.net
```

The webhook endpoint path is `/api/webhook`. The full webhook URL is:

```
https://func-opencode-pro-<unique>.azurewebsites.net/api/webhook
```

This path is produced by Azure Functions `host.json` (`routePrefix: "api"`) plus the function route `webhook` configured in `src/azure-function.js`.

---

## Step 5: Set Up Key Vault Secrets

The Bicep template creates placeholder secrets in Key Vault. You must replace them with real values.

```bash
# Set your Key Vault name
KEY_VAULT_NAME="kv-opencode-pro-<unique>"

# Store the GitHub App ID
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "github-app-id" \
  --value "12345"

# Store the private key (read from a file)
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "github-private-key" \
  --file ./downloaded-private-key.pem

# Store the webhook secret
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "github-webhook-secret" \
  --value "your-webhook-secret-here"
```

Also store any LLM provider API keys you want the Function App to use:

```bash
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "openai-api-key" \
  --value "sk-..."

az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "anthropic-api-key" \
  --value "sk-ant-..."
```

If you store provider keys in Key Vault, you must also add corresponding `@Microsoft.KeyVault(...)` references to your Function App settings. Edit the Bicep template's `appSettings` array and re-deploy, or add them manually in the Azure portal under your Function App > **Environment variables**.

---

## Step 6: Verify Webhook Delivery

### Update the GitHub App webhook URL

1. Go to your GitHub App's settings page
2. Set **Webhook URL** to `https://func-opencode-pro-<unique>.azurewebsites.net/api/webhook`
3. Set **Webhook secret** to the same value you stored in Key Vault
4. Save changes

### Verify connectivity

1. Go to your GitHub App's **Advanced** tab
2. Under **Recent Deliveries**, every event should show a green checkmark with a 200 response
3. If you see red (failing) deliveries, check the Function App logs (see Troubleshooting below)

### Test the bot

1. Install the app on a test repository
2. Create an issue with `/oc hello` in the body
3. The bot should respond within a few seconds with an AI-generated reply

---

## Step 7: Install the App

### For user accounts

1. Go to your GitHub App's **Install App** page (public page URL)
2. Click **Install** next to your user account
3. Choose **All repositories** or **Only select repositories**
4. Click **Install**

### For organizations

1. An organization owner must navigate to the same install page
2. Click **Install** next to the organization
3. Select repositories
4. Click **Install**

The bot is now active. Add a `.opencode-pro.json` config file to any installed repository to customize its behaviour.

---

## Troubleshooting

### Webhook deliveries fail with 4xx

| Symptom | Likely cause | Solution |
|---------|-------------|----------|
| 401 Unauthorized | Webhook secret mismatch | Verify the secret in Key Vault matches the GitHub App webhook secret exactly |
| 404 Not Found | Wrong webhook URL or route | Confirm the Function App URL ends with `/api/webhook` |
| 500 Internal Server Error | Missing environment variables | Check that `APP_ID`, `PRIVATE_KEY`, and `WEBHOOK_SECRET` are resolved by the Function App |

### Bot does not respond to commands

- Confirm the repository has a `.opencode-pro.json` or `.opencode.jsonc` at its root
- Confirm `autoAssign` and `autoReview` are set to `true` if you expect automatic responses
- Check that the LLM provider API key is set and valid (the bot logs failures as `error` level)
- Ensure the bot is not trying to respond to its own comments (self-response is guarded)

### Key Vault secrets not resolving

The Function App's managed identity must have the `Key Vault Secrets User` role on the Key Vault. The Bicep template sets this up automatically, but if you reconfigure manually, verify with:

```bash
az role assignment list \
  --assignee <function-app-principal-id> \
  --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault>
```

### Function App cold starts

Azure Functions on the Consumption plan experience cold starts after periods of inactivity. The first webhook delivery after a cold start may take 5-15 seconds. Subsequent deliveries are fast. To reduce cold start impact, consider the Premium plan or keep the function warm with a timer trigger on the Consumption plan.

---

## Monitoring and Logs

### View logs in Azure

```bash
# Stream live logs
az webapp log tail \
  --resource-group rg-opencode-pro \
  --name func-opencode-pro-<unique>

# Or view in the Azure Portal: Function App > Monitoring > Log stream
```

### View logs via Application Insights

If Application Insights is connected to your Function App, query logs through Kusto:

```kusto
traces
| where timestamp > ago(1h)
| where severityLevel >= 2  // warnings and errors
| project timestamp, message
```

### Log levels

Set the `LOG_LEVEL` app setting to control verbosity:

| Level | Output |
|-------|--------|
| `debug` | Every webhook event, trigger detection, config loading, LLM calls |
| `info` | Startup messages, comment posts, review completions |
| `warn` | Config file missing, parse failures, expected recoverable issues |
| `error` | Failed API calls, internal exceptions |

Production instances should run at `info` or `warn` to keep log volume manageable.

---

## Next Steps

- Read [CONFIGURATION.md](CONFIGURATION.md) to customize the bot for your repositories
- Read [CONTRIBUTING.md](../CONTRIBUTING.md) to contribute back to the project
- Set up per-repository config files for each installed repo
