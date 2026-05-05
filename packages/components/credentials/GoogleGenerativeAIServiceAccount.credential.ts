import { INodeParams, INodeCredential } from '../src/Interface'

class GoogleGenerativeAIServiceAccountCredential implements INodeCredential {
    label: string
    name: string
    version: number
    description: string
    inputs: INodeParams[]

    constructor() {
        this.label = 'Google Generative AI (Service Account)'
        this.name = 'googleGenerativeAIServiceAccount'
        this.version = 1.0
        this.description =
            'Authenticate to <code>generativelanguage.googleapis.com</code> with a GCP service account. The associated project must have the Generative Language API enabled.'
        this.inputs = [
            {
                label: 'Service Account JSON',
                name: 'googleApplicationCredentials',
                description: 'Full contents of the service account JSON key file',
                placeholder: `{
    "type": "service_account",
    "project_id": "...",
    "private_key_id": "...",
    "private_key": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n",
    "client_email": "...",
    "client_id": "...",
    "auth_uri": "...",
    "token_uri": "...",
    "auth_provider_x509_cert_url": "...",
    "client_x509_cert_url": "..."
}`,
                type: 'string',
                rows: 4
            }
        ]
    }
}

module.exports = { credClass: GoogleGenerativeAIServiceAccountCredential }
