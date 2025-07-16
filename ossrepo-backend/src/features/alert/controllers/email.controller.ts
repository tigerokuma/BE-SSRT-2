import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { EmailService } from  '../services/email.service'; 
import { EmailTimeInput } from '../dto/email.dto';

@Controller('email')
export class EmailController {
  constructor(private readonly service: EmailService) {}


  @Post('send-confirmation')
  sendConfirmation() {
    return this.service.sendConfirmation();
  }

  @Get('confirm-email')
  confirmEmail(@Query('token') token: string) {
    return this.service.confirmEmail(token);
  }

  @Post('add-time')
  addEmailTime(@Body() emailTimeInput: EmailTimeInput){
    return this.service.addEmailTime(emailTimeInput);
  }
}