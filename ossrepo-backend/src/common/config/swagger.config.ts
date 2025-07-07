import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('OSS Repo Tracker API')
  .setDescription('API documentation for OSS services')
  .setVersion('1.0')
  .build();