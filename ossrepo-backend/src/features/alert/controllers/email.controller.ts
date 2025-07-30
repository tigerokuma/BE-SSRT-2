import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { EmailService } from  '../services/email.service'; 
import { EmailTimeInput } from '../dto/email.dto';

@Controller('email')
export class EmailController {
  constructor(private readonly service: EmailService) {}


  @Post('send-confirmation')
  sendConfirmation(@Body() user_id: string) {
    return this.service.sendConfirmation(user_id);
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