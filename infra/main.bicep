targetScope = 'subscription'

@description('Azure region for all deployed resources')
param location string = 'eastus'

@description('Name of the resource group to create or use')
param resourceGroupName string

@description('Name of the Function App (globally unique)')
param functionAppName string

@description('Name of the Key Vault (globally unique)')
param keyVaultName string

@description('Name of the Storage Account (globally unique)')
param storageAccountName string

// ---------------------------------------------------------------------------
// Resource Group
// ---------------------------------------------------------------------------
resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}

// ---------------------------------------------------------------------------
// Module: deploy all resources into the target resource group
// ---------------------------------------------------------------------------
module infra 'modules/infra.bicep' = {
  name: 'opencode-pro-infra'
  scope: resourceGroup
  params: {
    location: location
    functionAppName: functionAppName
    keyVaultName: keyVaultName
    storageAccountName: storageAccountName
  }
}