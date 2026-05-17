# Azure — GitHub Actions Self-Hosted Runner Deployment

Automated deployment of a complete Azure network with a self-hosted GitHub Actions runner using OpenID Connect (OIDC) authentication and Bicep infrastructure-as-code. The VM auto-registers as a runner on first boot via cloud-init — no manual SSH or setup steps required.

---

## Architecture

```
  ┌───────────────────────────────────────────────────────────────┐
  │                        Resource Group                         │
  │                                                               │
  │  ┌─────────────────────────────────────────────────────────┐  │
  │  │              VNet (10.0.0.0/16)                         │  │
  │  │  ┌───────────────────────────────────────────────────┐  │  │
  │  │  │         Subnet (10.0.1.0/24)                      │  │  │
  │  │  │  ┌──────────┐                                    │  │  │
  │  │  │  │   NSG    │ ◄── 4 outbound rules                │  │  │
  │  │  │  │          │     (actions, github, storage)      │  │  │
  │  │  │  └──────────┘                                    │  │  │
  │  │  │       │                                           │  │  │
  │  │  │  ┌──────────┐  ┌──────────┐                      │  │  │
  │  │  │  │   VM     │  │  Public  │                      │  │  │
  │  │  │  │  Ubuntu  │◄─┤    IP    │                      │  │  │
  │  │  │  │  22.04   │  └──────────┘                      │  │  │
  │  │  │  │          │                                     │  │  │
  │  │  │  │ SSH key  │  cloud-init auto-registers          │  │  │
  │  │  │  │ auth     │  runner on first boot               │  │  │
  │  │  │  └──────────┘                                    │  │  │
  │  │  └───────────────────────────────────────────────────┘  │  │
  │  └─────────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────────┘
```

- **VNet**: `10.0.0.0/16` address space with a single subnet (`10.0.1.0/24`)
- **NSG**: Attached to the subnet with 4 outbound rules for secure runner operation
- **VM**: `Standard_B2s` (2 vCPU, 4 GB), Ubuntu 22.04, SSH public key authentication, public IP
- **cloud-init**: Installs the Actions runner binary, requests a registration token via the GitHub API, and registers the runner with your repository on first boot

---

## Azure Deployment Workflow

The workflow defined in `.github/workflows/deploy-azure.yml` deploys the full network and VM to Azure on demand.

### Trigger

Manually triggered via the **Actions** tab on GitHub using the `workflow_dispatch` event. No push or PR triggers are configured.

### Input Parameters

| Parameter | Required | Default | Description |
|---|---|---|---|
| `location` | Yes | `eastus` | Azure region for all deployed resources |
| `resourceGroupName` | Yes | `actions-runner-rg` | Name of the Azure resource group |
| `vnetName` | No | `actions-vnet` | Name of the virtual network |
| `vnetAddressPrefix` | No | `10.0.0.0/16` | Address space for the virtual network |
| `subnetName` | No | `runner-subnet` | Name of the subnet within the VNet |
| `subnetAddressPrefix` | No | `10.0.1.0/24` | Address prefix for the subnet |
| `vmName` | No | `github-runner-vm` | Name of the virtual machine |
| `vmSize` | No | `Standard_B2s` | VM SKU (2 vCPU, 4 GB RAM) |
| `adminUsername` | Yes | `azureuser` | Admin username for the VM |
| `adminSSHKey` | Yes | — | SSH public key for VM authentication |
| `githubRepo` | Yes | — | Target repository in `owner/repo` format |

> **Note:** The NSG name is automatically derived as `{vnetName}-nsg` and is not independently configurable via the workflow UI.

### What It Does

| Step | Action |
|---|---|
| 1. **OIDC Login** | Authenticates to Azure using federated credentials — no secrets or passwords |
| 2. **Create Resource Group** | Creates or verifies the resource group in the specified region |
| 3. **Prepare cloud-init** | Processes the cloud-init template, injecting the runner token and repo details |
| 4. **Deploy Infrastructure** | Deploys VNet, subnet, NSG, and VM via `main.bicep` |
| 5. **Runner Registration** | VM auto-registers as a self-hosted runner via cloud-init on first boot |
| 6. **Outputs** | Displays the runner status URL for the target repository |

---

## Required GitHub Secrets

The following secrets must be configured in your GitHub repository under **Settings > Secrets and variables > Actions**:

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID of the Entra ID app registration |
| `AZURE_TENANT_ID` | Directory (tenant) ID of your Entra ID tenant |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID where resources will be deployed |
| `GH_RUNNER_TOKEN` | GitHub Personal Access Token with `repo` scope for runner registration |

**Note:** No Azure client secret is needed. Authentication is handled entirely via OIDC federated credentials.

### Generating `GH_RUNNER_TOKEN`

The cloud-init script calls the GitHub API to request a runner registration token. This requires a Personal Access Token with the appropriate permissions:

1. Go to **GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens**
2. Click **Generate new token**
3. Under **Repository access**, select your target repository
4. Under **Permissions**, set **Administration** to **Read and write**
5. Generate the token and copy it
6. Add the token as the `GH_RUNNER_TOKEN` secret in your repository

The Administration permission is required because the [Actions runner registration token API](https://docs.github.com/en/rest/actions/self-hosted-runners#create-a-registration-token-for-a-repository) is scoped under Administration access.

---

## Azure Prerequisites

Before using the workflow, set up federated credentials in Azure Entra ID so GitHub Actions can authenticate without secrets.

### 1. Create an App Registration

In the Azure Portal, navigate to **Entra ID > App registrations > New registration**:

- **Name:** Give it a descriptive name (e.g., `github-actions-runner-deploy`)
- **Supported account types:** Single tenant
- **Redirect URI:** Leave blank (not needed)

Note the **Application (client) ID** and **Directory (tenant) ID** from the overview page.

### 2. Add a Federated Credential

Create a federated credential that trusts GitHub Actions for your repository:

```bash
az ad app federated-credential create \
  --id <APPLICATION_CLIENT_ID> \
  --parameters '{
    "name": "github-actions-runner",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<OWNER>/<REPO>:ref:refs/heads/main",
    "description": "OIDC trust for GitHub Actions runner deployment",
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

Add the four required secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `GH_RUNNER_TOKEN`) to your GitHub repository as described in the section above.

---

## NSG Rules

The Network Security Group is deployed with the following outbound rules. These rules are scoped to the required GitHub Actions and Azure service endpoints to allow the runner to communicate with GitHub while maintaining a focused security posture:

| Rule | Priority | Protocol | Destination | Purpose |
|---|---|---|---|---|
| `AllowVnetOutBoundOverwrite` | 200 | TCP:443 | VirtualNetwork | Allow communication within the VNet |
| `AllowOutBoundActions` | 210 | *:443 | Azure Actions IPs | Connect to GitHub Actions service |
| `AllowOutBoundGitHub` | 220 | *:443 | GitHub IP ranges | Access GitHub API and services |
| `AllowStorageOutbound` | 230 | *:443 | Storage | Access Azure Storage endpoints |

All rules allow only outbound traffic on port 443. No inbound rules beyond the default SSH (port 22) rule are configured by default.

---

## Checking Runner Status

Once the deployment completes and the VM boots, verify the runner has registered successfully.

**GitHub UI:**

Navigate to the runner settings for your repository:

```
https://github.com/<owner>/<repo>/settings/actions/runners
```

A registered runner will appear with a green **Idle** status, ready to pick up workflow jobs.

**GitHub CLI:**

```bash
gh api /repos/<owner>/<repo>/actions/runners
```

This returns a JSON list of all registered runners. Look for your runner by name (defaults to the VM name) and check the `status` field — `online` means the runner is connected and ready.

---

## Cleanup

To remove all deployed resources, delete the resource group:

```bash
az group delete --name actions-runner-rg
```

This deletes the resource group and all resources contained within it, including the VNet, subnet, NSG, VM, public IP, and associated disks.

**Important:** After deleting the VM, an orphaned runner entry remains in GitHub. The VM cannot deregister itself when it is forcibly deleted. Remove the orphaned runner manually:

1. Go to **GitHub > Your repository > Settings > Actions > Runners**
2. Find the offline runner in the list
3. Click **Remove** to permanently delete the runner registration

---

## File Structure

```
├── main.bicep                     # Complete infrastructure (VNet, subnet, NSG, VM, NIC, public IP)
├── cloud-init-runner.yml          # cloud-init template for VM auto-registration
├── actions-nsg-deployment.bicep   # Standalone NSG deployment (backward compatibility)
└── .github/workflows/
    └── deploy-azure.yml           # GitHub Actions deployment workflow
```