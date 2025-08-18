import { 
  Controller, Post, Body, Get, Query, Param, Logger,
  BadRequestException, BadGatewayException 
} from '@nestjs/common';
import { EmailService } from '../services/email.service'; 
import { EmailTimeInput, User } from '../dto/email.dto';

@Controller('email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(private readonly emailService: EmailService) {}

  @Post('send-confirmation')
  async sendConfirmation(@Body() body: User) {
    if (!body?.user_id) {
      this.logger.warn('sendConfirmation called without user_id');
      throw new BadRequestException('Missing user_id in request body');
    }
    try {
      await this.emailService.sendConfirmation(body.user_id);
      return { success: true, message: 'Confirmation email sent' };
    } catch (err) {
      this.logger.error(`Failed to send confirmation email for user: ${body.user_id}`, err.stack);
      throw new BadGatewayException('Failed to send confirmation email');
    }
  }

  @Get('check-confirmation/:user_id')
  async checkConfirmation(@Param('user_id') user_id: string) {
    if (!user_id) {
      this.logger.warn('checkConfirmation called without user_id');
      throw new BadRequestException('Missing user_id parameter');
    }
    try {
      return await this.emailService.checkConfirmation(user_id);
    } catch (err) {
      this.logger.error(`Failed to check email confirmation for user: ${user_id}`, err.stack);
      throw new BadGatewayException('Failed to check email confirmation status');
    }
  }

  @Get('email-time/:user_id')
  async getEmailTime(@Param('user_id') user_id: string) {
    if (!user_id) {
      this.logger.warn('getEmailTime called without user_id');
      throw new BadRequestException('Missing user_id parameter');
    }
    try {
      return await this.emailService.getUserEmailTime(user_id);
    } catch (err) {
      this.logger.error(`Failed to get email time for user: ${user_id}`, err.stack);
      throw new BadGatewayException('Failed to retrieve email time');
    }
  }

  @Get('confirm-email')
  async confirmEmail(@Query('token') token: string) {
    if (!token) {
      this.logger.warn('confirmEmail called without token');
      throw new BadRequestException('Missing token query parameter');
    }
    try {
      return await this.emailService.confirmEmail(token);
    } catch (err) {
      this.logger.error(`Failed to confirm email with token: ${token}`, err.stack);
      throw new BadGatewayException('Failed to confirm email');
    }
  }

  @Get('get-email/:user_id')
  async getEmail(@Param('user_id') user_id: string) {
    if (!user_id) {
      this.logger.warn('getEmail called without user_id');
      throw new BadRequestException('Missing user_id parameter');
    }
    try {
      return await this.emailService.getEmailAddress(user_id);
    } catch (err) {
      this.logger.error(`Failed to get email for user: ${user_id}`, err.stack);
      throw new BadGatewayException('Failed to retrieve email time');
    }
  }

  @Post('add-time')
  async addEmailTime(@Body() emailTimeInput: EmailTimeInput) {
    if (!emailTimeInput?.id) {
      this.logger.warn('addEmailTime called without id in body');
      throw new BadRequestException('Missing id in request body');
    }
    try {
      return await this.emailService.addEmailTime(emailTimeInput);
    } catch (err) {
      this.logger.error('Failed to add/update email time', err.stack);
      throw new BadGatewayException('Failed to add or update email time');
    }
  }
}
