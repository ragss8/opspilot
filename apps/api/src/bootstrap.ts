import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('OpsPilot AI API')
    .setDescription(
      'Fleet operations copilot API demonstrating RAG, semantic search, incident classification, prompt engineering, and optional OpenAI or AWS Bedrock providers.',
    )
    .setVersion('1.0.0')
    .addTag('System')
    .addTag('Fleet operations')
    .addTag('AI copilot')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'OpsPilot AI API Docs',
    swaggerOptions: { persistAuthorization: true },
  });
}
