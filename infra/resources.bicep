@description('Primary location')
param location string

@description('Short hash token used to make resource names unique')
@minLength(5)
param resourceToken string

param tags object

param tenantId string
param spaClientId string
param apiAudience string
param apiScope string

param openAiLocation string
param deploymentMiniName string
param deploymentFullName string
param modelMiniName string
param modelFullName string
param speechLocation string

var effectiveOpenAiLocation = empty(openAiLocation) ? location : openAiLocation
var effectiveSpeechLocation = empty(speechLocation) ? location : speechLocation

// ---------- Networking ----------
var vnetAddressPrefix = '10.50.0.0/16'
var acaSubnetPrefix = '10.50.0.0/23'
var peSubnetPrefix = '10.50.2.0/24'

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: 'vnet-${resourceToken}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [vnetAddressPrefix] }
    subnets: [
      {
        name: 'aca'
        properties: {
          addressPrefix: acaSubnetPrefix
          delegations: [
            {
              name: 'container-apps'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'pe'
        properties: {
          addressPrefix: peSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource acaSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-01-01' existing = {
  parent: vnet
  name: 'aca'
}

resource peSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-01-01' existing = {
  parent: vnet
  name: 'pe'
}

// ---------- Private DNS Zones ----------
var dnsZoneNames = [
  'privatelink.documents.azure.com'
  'privatelink.openai.azure.com'
  'privatelink.cognitiveservices.azure.com'
  'privatelink.azurecr.io'
]

resource dnsZones 'Microsoft.Network/privateDnsZones@2020-06-01' = [
  for z in dnsZoneNames: {
    name: z
    location: 'global'
    tags: tags
  }
]

resource dnsZoneLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [
  for (z, i) in dnsZoneNames: {
    name: '${z}/link-${resourceToken}'
    location: 'global'
    properties: {
      registrationEnabled: false
      virtualNetwork: { id: vnet.id }
    }
    dependsOn: [dnsZones[i]]
  }
]

// ---------- Log Analytics + App Insights ----------
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${resourceToken}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

// ---------- ACR ----------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: 'acr${resourceToken}'
  location: location
  tags: tags
  sku: { name: 'Premium' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// ---------- Cosmos DB ----------
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: 'cosmos-${resourceToken}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [{ locationName: location, failoverPriority: 0 }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    publicNetworkAccess: 'Disabled'
    capabilities: []
    disableLocalAuth: true
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'mt'
  properties: { resource: { id: 'mt' } }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'items'
  properties: {
    resource: {
      id: 'items'
      partitionKey: { paths: ['/sessionId'], kind: 'Hash' }
      indexingPolicy: { indexingMode: 'consistent', automatic: true }
    }
    options: { throughput: 400 }
  }
}

resource cosmosPe 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: 'pe-cosmos-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: { id: peSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'cosmos'
        properties: {
          privateLinkServiceId: cosmos.id
          groupIds: ['Sql']
        }
      }
    ]
  }
}

resource cosmosPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: cosmosPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'cosmos'
        properties: { privateDnsZoneId: dnsZones[0].id }
      }
    ]
  }
}

// ---------- Azure OpenAI ----------
resource aoai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'aoai-${resourceToken}'
  location: effectiveOpenAiLocation
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: 'aoai-${resourceToken}'
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true
    networkAcls: { defaultAction: 'Deny', ipRules: [], virtualNetworkRules: [] }
  }
}

resource aoaiMini 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aoai
  name: deploymentMiniName
  sku: { name: 'GlobalStandard', capacity: 50 }
  properties: {
    model: { format: 'OpenAI', name: modelMiniName }
  }
}

resource aoaiFull 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aoai
  name: deploymentFullName
  sku: { name: 'GlobalStandard', capacity: 30 }
  properties: {
    model: { format: 'OpenAI', name: modelFullName }
  }
  dependsOn: [aoaiMini]
}

resource aoaiPe 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: 'pe-aoai-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: { id: peSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'aoai'
        properties: {
          privateLinkServiceId: aoai.id
          groupIds: ['account']
        }
      }
    ]
  }
  // Avoid race where account exists but backend provisioning is still Accepted.
  dependsOn: [
    aoaiMini
    aoaiFull
  ]
}

resource aoaiPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: aoaiPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'openai', properties: { privateDnsZoneId: dnsZones[1].id } }
      { name: 'cog', properties: { privateDnsZoneId: dnsZones[2].id } }
    ]
  }
}

// ---------- Speech ----------
// Speech requires public ingress for browser-based SDK; keep public ON but disable local auth.
resource speech 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'speech-${resourceToken}'
  location: effectiveSpeechLocation
  tags: tags
  kind: 'SpeechServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: 'speech-${resourceToken}'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
  }
}

// ---------- Translator ----------
resource translator 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'translator-${resourceToken}'
  location: location
  tags: tags
  kind: 'TextTranslation'
  sku: { name: 'S1' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: 'translator-${resourceToken}'
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true
  }
}

resource translatorPe 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: 'pe-translator-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: { id: peSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'translator'
        properties: {
          privateLinkServiceId: translator.id
          groupIds: ['account']
        }
      }
    ]
  }
}

resource translatorPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: translatorPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'cog', properties: { privateDnsZoneId: dnsZones[2].id } }
    ]
  }
}

// ---------- ACR Private Endpoint ----------
resource acrPe 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: 'pe-acr-${resourceToken}'
  location: location
  tags: tags
  properties: {
    subnet: { id: peSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'acr'
        properties: {
          privateLinkServiceId: acr.id
          groupIds: ['registry']
        }
      }
    ]
  }
}

resource acrPeDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: acrPe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      { name: 'acr', properties: { privateDnsZoneId: dnsZones[3].id } }
    ]
  }
}

// ---------- Container Apps Environment ----------
resource acaEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'acaenv-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
    vnetConfiguration: {
      internal: false
      infrastructureSubnetId: acaSubnet.id
    }
  }
}

// ---------- User-Assigned Identity for ACR pulls (system MI used for runtime) ----------
// Use System-Assigned on the app, plus a UAMI for ACR pull at deploy-time
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'uami-${resourceToken}'
  location: location
  tags: tags
}

// ---------- Role Assignments ----------
// Role definition IDs
var roleAcrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var roleCogServicesUser = 'a97b65f3-24c7-4388-baec-2e87135dc908' // Cognitive Services User (for Translator/Speech via AAD)
var roleAoaiUser = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User

resource raAcrUami 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, uami.id, roleAcrPull)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAcrPull)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// API container app (declared below) gets MI; grant roles after creation
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-api-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: { '${uami.id}': {} }
  }
  properties: {
    environmentId: acaEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: uami.id
        }
      ]
      secrets: []
    }
    template: {
      containers: [
        {
          name: 'api'
          image: 'mcr.microsoft.com/k8se/quickstart:latest'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'TENANT_ID', value: tenantId }
            { name: 'API_AUDIENCE', value: apiAudience }
            { name: 'API_SCOPE', value: apiScope }
            { name: 'AZURE_OPENAI_ENDPOINT', value: 'https://${aoai.name}.openai.azure.com/' }
            { name: 'AZURE_OPENAI_DEPLOYMENT_MINI', value: deploymentMiniName }
            { name: 'AZURE_OPENAI_DEPLOYMENT_FULL', value: deploymentFullName }
            { name: 'SPEECH_REGION', value: effectiveSpeechLocation }
            { name: 'SPEECH_ENDPOINT', value: 'https://${effectiveSpeechLocation}.api.cognitive.microsoft.com' }
            { name: 'SPEECH_RESOURCE_ID', value: speech.id }
            {
              name: 'TRANSLATOR_ENDPOINT'
              value: 'https://${translator.name}.cognitiveservices.azure.com/translator/text/v3.0'
            }
            { name: 'TRANSLATOR_REGION', value: location }
            { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'COSMOS_DATABASE', value: 'mt' }
            { name: 'COSMOS_CONTAINER', value: 'items' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
            { name: 'CORS_ALLOWED_ORIGINS', value: '*' }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
  dependsOn: [raAcrUami, cosmosPeDns, aoaiPeDns, translatorPeDns]
}

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-web-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${uami.id}': {} }
  }
  properties: {
    environmentId: acaEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: uami.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: 'mcr.microsoft.com/k8se/quickstart:latest'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'TENANT_ID', value: tenantId }
            { name: 'CLIENT_ID', value: spaClientId }
            { name: 'API_SCOPE', value: '${apiAudience}/${apiScope}' }
            { name: 'API_BASE_URL', value: '' }
            { name: 'API_UPSTREAM', value: 'https://${apiApp.properties.configuration.ingress.fqdn}' }
            { name: 'NGINX_ENVSUBST_FILTER', value: '^API_UPSTREAM$' }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
  dependsOn: [raAcrUami]
}

// ---------- API MI role assignments ----------
resource raApiAoai 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aoai
  name: guid(aoai.id, apiApp.id, roleAoaiUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleAoaiUser)
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource raApiSpeech 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: speech
  name: guid(speech.id, apiApp.id, roleCogServicesUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleCogServicesUser)
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource raApiTranslator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: translator
  name: guid(translator.id, apiApp.id, roleCogServicesUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleCogServicesUser)
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- Cosmos data plane RBAC ----------
// Built-in "Cosmos DB Built-in Data Contributor" role definition id is fixed: 00000000-0000-0000-0000-000000000002
var cosmosBuiltInDataContributor = '00000000-0000-0000-0000-000000000002'

resource cosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, apiApp.id, cosmosBuiltInDataContributor)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosBuiltInDataContributor}'
    principalId: apiApp.identity.principalId
    scope: cosmos.id
  }
}

// ---------- Outputs ----------
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output acaEnvName string = acaEnv.name
output acaEnvId string = acaEnv.id
output apiAppName string = apiApp.name
output apiAppUri string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
output webAppName string = webApp.name
output webAppUri string = 'https://${webApp.properties.configuration.ingress.fqdn}'
