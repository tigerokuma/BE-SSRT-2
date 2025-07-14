import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule } from '@nestjs/swagger';
import { swaggerConfig } from './common/config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
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
  
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
