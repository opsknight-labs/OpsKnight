import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Check for existing integrations
  const integrations = await prisma.integration.findMany({ take: 1 });

  if (integrations.length > 0) {
    console.log('ID=' + integrations[0].id);
    console.log('KEY=' + integrations[0].key);
    console.log('TYPE=' + integrations[0].type);
  } else {
    // Get or create a service first
    let service = await prisma.service.findFirst();
    if (!service) {
      service = await prisma.service.create({
        data: {
          name: 'Test Service',
          description: 'Service for testing integrations',
        },
      });
      console.log('Created test service: ' + service.id);
    }

    // Create a test integration
    const integration = await prisma.integration.create({
      data: {
        name: 'Test Integration',
        type: 'WEBHOOK',
        key: 'test-integration-key-' + Date.now(),
        serviceId: service.id,
      },
    });
    console.log('ID=' + integration.id);
    console.log('KEY=' + integration.key);
    console.log('TYPE=' + integration.type);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
