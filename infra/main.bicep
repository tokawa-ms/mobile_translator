targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the the environment which is used to generate a short unique hash used in all resources.')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('Tenant ID for Entra ID auth (defaults to deployment tenant)')
param tenantId string = tenant().tenantId

@description('Client ID of the SPA App Registration used by the PWA')
param spaClientId string

@description('Application ID URI / audience of the API App Registration (e.g. api://<guid>)')
param apiAudience string

@description('API scope short name')
param apiScope string = 'access_as_user'

@description('Optional Entra Authentication Context ID used to steer mobile sign-in toward passkey-friendly policy')
param passkeyAuthContextId string = ''

@description('Azure OpenAI region (overrides location for OpenAI)')
param openAiLocation string = location

@description('Azure OpenAI deployment name for the mini model')
param deploymentMiniName string = 'gpt-5.4-mini'

@description('Azure OpenAI deployment name for the full model')
param deploymentFullName string = 'gpt-5.4'

@description('Azure OpenAI model name for the mini deployment')
param modelMiniName string = 'gpt-4o-mini'

@description('Azure OpenAI model name for the full deployment')
param modelFullName string = 'gpt-4o'

@description('Speech region (defaults to location)')
param speechLocation string = location

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }
var rgName = 'rg-${environmentName}'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgName
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    resourceToken: resourceToken
    tags: tags
    tenantId: tenantId
    spaClientId: spaClientId
    apiAudience: apiAudience
    apiScope: apiScope
    passkeyAuthContextId: passkeyAuthContextId
    openAiLocation: openAiLocation
    deploymentMiniName: deploymentMiniName
    deploymentFullName: deploymentFullName
    modelMiniName: modelMiniName
    modelFullName: modelFullName
    speechLocation: speechLocation
  }
}

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenantId
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.acrLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = resources.outputs.acrName
output AZURE_CONTAINER_APPS_ENVIRONMENT_NAME string = resources.outputs.acaEnvName
output AZURE_CONTAINER_APPS_ENVIRONMENT_ID string = resources.outputs.acaEnvId
output SERVICE_API_NAME string = resources.outputs.apiAppName
output SERVICE_API_URI string = resources.outputs.apiAppUri
output SERVICE_WEB_NAME string = resources.outputs.webAppName
output SERVICE_WEB_URI string = resources.outputs.webAppUri
output API_BASE_URL string = ''
output SPA_CLIENT_ID string = spaClientId
output API_AUDIENCE string = apiAudience
output API_SCOPE string = apiScope
output CLIENT_API_SCOPE string = '${apiAudience}/${apiScope}'
