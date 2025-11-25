import { Module } from '@nestjs/common';
import { ConnectionService } from './azure.service';

@Module({
  providers: [ConnectionService],
  exports: [ConnectionService],
})
export class AzureModule {}
