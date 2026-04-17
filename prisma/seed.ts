import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const defaultServers = [
  {
    name: 'GitHub',
    slug: 'github',
    description: 'Access repositories, issues, PRs, and code search across GitHub',
    iconUrl: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    category: 'Development',
    websiteUrl: 'https://github.com',
    docsUrl: 'https://docs.github.com',
    color: '#6e40c9',
    isDefault: true,
    configSchema: { apiKey: { type: 'string', label: 'Personal Access Token', required: true } },
  },
  {
    name: 'Slack',
    slug: 'slack',
    description: 'Send messages, search channels, and manage your workspace',
    iconUrl: 'https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png',
    category: 'Communication',
    websiteUrl: 'https://slack.com',
    docsUrl: 'https://api.slack.com',
    color: '#4A154B',
    isDefault: true,
    configSchema: { botToken: { type: 'string', label: 'Bot Token', required: true } },
  },
  {
    name: 'Notion',
    slug: 'notion',
    description: 'Read and write to your Notion workspace, pages, and databases',
    iconUrl: 'https://www.notion.so/images/logo-ios.png',
    category: 'Productivity',
    websiteUrl: 'https://notion.so',
    docsUrl: 'https://developers.notion.com',
    color: '#000000',
    isDefault: true,
    configSchema: { apiKey: { type: 'string', label: 'Integration Token', required: true } },
  },
  {
    name: 'Linear',
    slug: 'linear',
    description: 'Manage issues, projects, and sprints in your Linear workspace',
    iconUrl: 'https://linear.app/favicon.ico',
    category: 'Project Management',
    websiteUrl: 'https://linear.app',
    docsUrl: 'https://developers.linear.app',
    color: '#5E6AD2',
    isDefault: true,
    configSchema: { apiKey: { type: 'string', label: 'API Key', required: true } },
  },
  {
    name: 'Google Drive',
    slug: 'google-drive',
    description: 'Browse, read, and search your Google Drive files and folders',
    iconUrl: 'https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png',
    category: 'Storage',
    websiteUrl: 'https://drive.google.com',
    docsUrl: 'https://developers.google.com/drive',
    color: '#1fa463',
    isDefault: true,
    configSchema: { serviceAccountJson: { type: 'textarea', label: 'Service Account JSON', required: true } },
  },
  {
    name: 'Stripe',
    slug: 'stripe',
    description: 'Query payments, customers, subscriptions, and financial data',
    iconUrl: 'https://b.stripecdn.com/manage-statics-srv/assets/public/images/favicon/apple-touch-icon.png',
    category: 'Payments',
    websiteUrl: 'https://stripe.com',
    docsUrl: 'https://stripe.com/docs/api',
    color: '#635BFF',
    isDefault: true,
    configSchema: { secretKey: { type: 'string', label: 'Secret Key', required: true } },
  },
  {
    name: 'Airtable',
    slug: 'airtable',
    description: 'Read and update records in your Airtable bases and tables',
    iconUrl: 'https://airtable.com/images/favicon/baymax/favicon-32x32.png',
    category: 'Database',
    websiteUrl: 'https://airtable.com',
    docsUrl: 'https://airtable.com/developers/web/api',
    color: '#FCB400',
    isDefault: true,
    configSchema: { apiKey: { type: 'string', label: 'Personal Access Token', required: true } },
  },
  {
    name: 'Figma',
    slug: 'figma',
    description: 'Access design files, components, and assets from Figma',
    iconUrl: 'https://static.figma.com/app/icon/1/favicon.ico',
    category: 'Design',
    websiteUrl: 'https://figma.com',
    docsUrl: 'https://www.figma.com/developers/api',
    color: '#F24E1E',
    isDefault: true,
    configSchema: { accessToken: { type: 'string', label: 'Personal Access Token', required: true } },
  },
  {
    name: 'Jira',
    slug: 'jira',
    description: 'Manage Jira issues, sprints, boards, and project workflows',
    iconUrl: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png',
    category: 'Project Management',
    websiteUrl: 'https://www.atlassian.com/software/jira',
    docsUrl: 'https://developer.atlassian.com/cloud/jira',
    color: '#0052CC',
    isDefault: true,
    configSchema: {
      email: { type: 'string', label: 'Email', required: true },
      apiToken: { type: 'string', label: 'API Token', required: true },
      domain: { type: 'string', label: 'Domain (e.g. yourco.atlassian.net)', required: true },
    },
  },
  {
    name: 'HubSpot',
    slug: 'hubspot',
    description: 'Access CRM data, contacts, deals, and marketing campaigns',
    iconUrl: 'https://www.hubspot.com/hubfs/HubSpot_Logos/HubSpot-Inversed-Favicon.png',
    category: 'CRM',
    websiteUrl: 'https://hubspot.com',
    docsUrl: 'https://developers.hubspot.com',
    color: '#FF7A59',
    isDefault: true,
    configSchema: { accessToken: { type: 'string', label: 'Private App Token', required: true } },
  },
  {
    name: 'Shopify',
    slug: 'shopify',
    description: 'Query products, orders, customers, and store analytics',
    iconUrl: 'https://cdn.shopify.com/shopifycloud/brochure/assets/brand-assets/shopify-logo-primary-logo-456baa801ee65a0a4f72b2bc2d4a4278.svg',
    category: 'E-Commerce',
    websiteUrl: 'https://shopify.com',
    docsUrl: 'https://shopify.dev/docs/api',
    color: '#96BF48',
    isDefault: true,
    configSchema: {
      shopDomain: { type: 'string', label: 'Shop Domain', required: true },
      accessToken: { type: 'string', label: 'Admin API Token', required: true },
    },
  },
  {
    name: 'Asana',
    slug: 'asana',
    description: 'Manage tasks, projects, teams, and timelines in Asana',
    iconUrl: 'https://asana.com/favicon.ico',
    category: 'Project Management',
    websiteUrl: 'https://asana.com',
    docsUrl: 'https://developers.asana.com',
    color: '#F06A6A',
    isDefault: true,
    configSchema: { accessToken: { type: 'string', label: 'Personal Access Token', required: true } },
  },
  {
    name: 'PostgreSQL',
    slug: 'postgresql',
    description: 'Query and manage your PostgreSQL databases with natural language',
    iconUrl: 'https://www.postgresql.org/media/img/about/press/elephant.png',
    category: 'Database',
    websiteUrl: 'https://postgresql.org',
    docsUrl: 'https://www.postgresql.org/docs',
    color: '#336791',
    isDefault: true,
    configSchema: { connectionUrl: { type: 'string', label: 'Connection URL', required: true } },
  },
  {
    name: 'AWS',
    slug: 'aws',
    description: 'Manage S3, Lambda, EC2, and other AWS services via natural language',
    iconUrl: 'https://a0.awsstatic.com/libra-css/images/logos/aws_logo_smile_1200x630.png',
    category: 'Cloud',
    websiteUrl: 'https://aws.amazon.com',
    docsUrl: 'https://docs.aws.amazon.com',
    color: '#FF9900',
    isDefault: true,
    configSchema: {
      accessKeyId: { type: 'string', label: 'Access Key ID', required: true },
      secretAccessKey: { type: 'string', label: 'Secret Access Key', required: true },
      region: { type: 'string', label: 'Region', required: false },
    },
  },
  {
    name: 'Twilio',
    slug: 'twilio',
    description: 'Send SMS, make calls, and manage communications programmatically',
    iconUrl: 'https://www.twilio.com/assets/icons/twilio-icon-512.png',
    category: 'Communication',
    websiteUrl: 'https://twilio.com',
    docsUrl: 'https://www.twilio.com/docs',
    color: '#F22F46',
    isDefault: true,
    configSchema: {
      accountSid: { type: 'string', label: 'Account SID', required: true },
      authToken: { type: 'string', label: 'Auth Token', required: true },
    },
  },
]

async function main() {
  console.log('🌱 Seeding database...')

  for (const server of defaultServers) {
    await prisma.mcpServer.upsert({
      where: { slug: server.slug },
      update: server,
      create: server,
    })
  }

  console.log(`✅ Seeded ${defaultServers.length} MCP servers`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
