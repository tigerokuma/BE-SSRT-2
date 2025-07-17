import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule } from '@nestjs/swagger';
import { swaggerConfig } from './common/config/swagger.config';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bull';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Setup Bull Board for queue monitoring
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  
  const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
    queues: [
      new BullAdapter(app.get(getQueueToken('repository-setup'))),
      new BullAdapter(app.get(getQueueToken('health-analysis'))),
      new BullAdapter(app.get(getQueueToken('commit-backfill'))),
    ],
    serverAdapter,
  });
  
  app.use('/admin/queues', serverAdapter.getRouter());
  
  // Enable CORS for local development and production
  app.enableCors({
    origin: [
      'http://localhost:3000',      // React dev server
      'http://localhost:3001',      // Alternative React port
      'http://localhost:5173',      // Vite dev server
      'http://localhost:8080',      // Vue/other dev servers
      'http://127.0.0.1:3000',      // Alternative localhost
      'http://127.0.0.1:5173',      // Alternative localhost
      // Add your production domains here
      // 'https://yourapp.com',
      // 'https://www.yourapp.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });

  // Enable validation pipes for DTOs
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));
  
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
