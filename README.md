# Azure — GitHub Actions OIDC + Bicep NSG Deployment

Automated deployment of an Azure Network Security Group (NSG) using GitHub Actions with OpenID Connect (OIDC) authentication and Bicep infrastructure-as-code. No secrets stored in GitHub — authentication is handled entirely via federated credentials in Azure Entra ID.

---

## Azure Deployment Workflow

The workflow defined in `.github/workflows/` deploys an NSG to Azure on demand.

### Trigger

Manually triggered via the **Actions** tab on GitHub using the `workflow_dispatch` event. No push or PR triggers are configured.

### Input Parameters

| Parameter | Default | Description |
|---|---|---|
| `location` | `eastus` | Azure region for resource group and NSG deployment |
| `resourceGroupName` | `actions-nsg-rg` | Name of the Azure resource group |
| `nsgName` | `actions_NSG` | Name of the Network Security Group resource |

### What It Does

| Step | Action |
|---|---|
| 1. **OIDC Login** | Authenticates to Azure using federated credentials — no secrets or passwords |
| 2. **Create Resource Group** | Creates or verifies the resource group in the specified region |
| 3. **Deploy NSG** | Deploys NSG rules from the `actions-nsg-deployment.bicep` Bicep template |

---

## Required GitHub Secrets

The following secrets must be configured in your GitHub repository under **Settings > Secrets and variables > Actions**:

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID of the Entra ID app registration |
| `AZURE_TENANT_ID` | Directory (tenant) ID of your Entra ID tenant |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID where resources will be deployed |

**Note:** No client secret is needed. Authentication is handled entirely via OIDC federated credentials.

---

## Azure Prerequisites

Before using the workflow, set up federated credentials in Azure Entra ID so GitHub Actions can authenticate without secrets.

### 1. Create an App Registration

In the Azure Portal, navigate to **Entra ID > App registrations > New registration**:

- **Name:** Give it a descriptive name (e.g., `github-actions-nsg-deploy`)
- **Supported account types:** Single tenant
- **Redirect URI:** Leave blank (not needed)

Note the **Application (client) ID** and **Directory (tenant) ID** from the overview page.

### 2. Add a Federated Credential

Create a federated credential that trusts GitHub Actions for your repository:

```bash
az ad app federated-credential create \
  --id <APPLICATION_CLIENT_ID> \
  --parameters '{
    "name": "github-actions-nsg",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<OWNER>/<REPO>:ref:refs/heads/main",
    "description": "OIDC trust for GitHub Actions NSG deployment",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

Replace `<APPLICATION_CLIENT_ID>` with the client ID from step 1, and `<OWNER>/<REPO>` with your GitHub repository path.

You can also add this credential via the Azure Portal under your app registration's **Certificates & secrets > Federated credentials > Add credential**. Select **GitHub Actions deploying Azure resources** as the scenario.

### 3. Grant Contributor Role

Assign the `Contributor` role to the app registration at the subscription scope so it can create resource groups and deploy resources:

```bash
az role assignment create \
  --assignee <APPLICATION_CLIENT_ID> \
  --role Contributor \
  --scope /subscriptions/<SUBSCRIPTION_ID>
```

### 4. Add Secrets to GitHub

Add the three required secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) to your GitHub repository as described in the section above.

---

## Cleanup

To remove all deployed resources, delete the resource group:

```bash
az group delete --name actions-nsg-rg
```

This deletes the resource group and all resources contained within it, including the deployed NSG.