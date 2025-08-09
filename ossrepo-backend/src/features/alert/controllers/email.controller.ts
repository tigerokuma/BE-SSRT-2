import { Controller, Post, Body, Get, Query, Param } from '@nestjs/common';
import { EmailService } from  '../services/email.service'; 
import { EmailTimeInput, User } from '../dto/email.dto';

@Controller('email')
export class EmailController {
  constructor(private readonly service: EmailService) {}


  @Post('send-confirmation')
  sendConfirmation(@Body() body: User) {
    return this.service.sendConfirmation(body.user_id);
  }

  @Get('check-confimation/:user_id')
  async checkConfimation(@Param('user_id') user_id: string) {
    return await this.service.checkConfirmation(user_id);
  }

  @Get('email-time/:user_id')
  async getEmailTime(@Param('user_id') user_id: string) {
    return await this.service.getUserEmailTime(user_id);
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