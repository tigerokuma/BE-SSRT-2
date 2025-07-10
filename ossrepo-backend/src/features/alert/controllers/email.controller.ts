import { Controller, Post, Body } from '@nestjs/common';
import { EmailService } from  '../services/email.service'; 

@Controller('email')
export class EmailController {
  constructor(private readonly service: EmailService) {}


  @Post('addEmail')
  addEmail(@Body() body: any) {
    return this.service.addEmail(body);
  }
}