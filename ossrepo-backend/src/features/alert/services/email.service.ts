import { Injectable } from '@nestjs/common';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import { SendEmailParams, ConfirmTokenInsert, EmailTime, EmailTimeInput } from '../dto/email.dto';
import { randomUUID } from 'crypto';
import { EmailRepository } from '../repositories/email.repository';

@Injectable()
export class EmailService{
  private readonly mailerSend: MailerSend;
  private readonly sentFrom: Sender;

  constructor(private emailRepository: EmailRepository) {
    const key = process.env.EMAIL_API_KEY;
    if (!key) {
      throw new Error('apiKey is not defined in environment variables');
    }
    this.mailerSend = new MailerSend({
      apiKey: key,
    });

    const fromEmail = process.env.FROM_EMAIL;
    if (!fromEmail) {
      throw new Error('from email is not defined in environment variables');
    }
    this.sentFrom = new Sender(
      fromEmail,
      'App',
    );
  }

  async sendEmail(sendEmailParams: SendEmailParams) {
    try {
      const recipients = [ new Recipient(sendEmailParams.rec_add, sendEmailParams.rec_name) ];
      const emailParams = new EmailParams()
      .setFrom(this.sentFrom)
      .setTo(recipients)
      .setReplyTo(this.sentFrom)
      .setSubject(sendEmailParams.subject)
      .setHtml(sendEmailParams.html)
      .setText(sendEmailParams.message);
      await this.mailerSend.email.send(emailParams);
    }
    catch (error) {
      console.error('Failed to send email.', error);
      throw error;
    }
  }

  async sendConfirmation() {
    const user_id = 'henry';
    const newToken = randomUUID();
    const confirmTokenInsert = new ConfirmTokenInsert();
    confirmTokenInsert.user_id = user_id;
    confirmTokenInsert.token = newToken;
    confirmTokenInsert.expires_at = new Date();

    this.emailRepository.InsertToken(confirmTokenInsert);

    const confirmUrl = process.env.EMAIL_CONFIRM_URL;
    const email = await this.emailRepository.GetEmail(user_id);
    if(!email){
      throw new Error("Recipient email not defined");
    }
    const recipients = [ new Recipient(email?.email, user_id) ];

    const emailParams = new EmailParams()
    .setFrom(this.sentFrom)                  
    .setTo(recipients)                    
    .setReplyTo(this.sentFrom)              
    .setSubject('Confirm your email')        
    .setHtml(`
      <p>Hi ${user_id},</p>
      <p>Click <a href="${confirmUrl}">here</a> to confirm your email.</p>
    `)                                       
    .setText(`Hi ${user_id},\nConfirm your email: ${confirmUrl}`);
    await this.mailerSend.email.send(emailParams);

  }

  async confirmEmail(token: string) {
    const userDto = await this.emailRepository.GetUser(token);
    if(!userDto || !userDto.user_id) {
        throw new Error("Issue with the token or user")
    }
    await this.emailRepository.UpdateConfirmation(userDto.user_id);
    await this.emailRepository.DeleteFromToken(token);
  }

  async addEmailTime(emailTimeInput: EmailTimeInput) {
    const emailTime = new EmailTime();
    emailTime.id = emailTimeInput.id;
    emailTime.wait_unit = emailTimeInput.wait_unit;
    emailTime.wait_value = emailTimeInput.wait_value;

    const result = new Date(emailTimeInput.first_email_time);

    switch (emailTime.wait_value) {
      case 'DAY':
        result.setDate(result.getDate() - emailTime.wait_unit);
        break;
      case 'WEEK':
        result.setDate(result.getDate() - (emailTime.wait_unit * 7));
        break;
      case 'MONTH':
        result.setMonth(result.getMonth() - emailTime.wait_unit);
        break;
      case 'YEAR':
        result.setFullYear(result.getFullYear() - emailTime.wait_unit);
      break;

      default:
        throw new Error(`Unsupported unit: ${emailTime.wait_value}`);
    }

    emailTime.last_email_time = result;

    
    await this.emailRepository.InsertEmailTime(emailTime);
  }
    
}
