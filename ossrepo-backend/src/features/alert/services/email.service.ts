import { Injectable } from '@nestjs/common';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import { ConfirmTokenInsert, EmailTime, EmailTimeInput } from '../dto/email.dto';
import { randomUUID } from 'crypto';
import { EmailRepository } from '../repositories/email.repository';
import { Cron } from '@nestjs/schedule';

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

  async sendConfirmation(user_id) {
    const newToken = randomUUID();
    const confirmTokenInsert = new ConfirmTokenInsert();
    confirmTokenInsert.user_id = user_id;
    confirmTokenInsert.token = newToken;
    confirmTokenInsert.expires_at = new Date();

    this.emailRepository.InsertToken(confirmTokenInsert);

    const confirmUrlBase = process.env.EMAIL_CONFIRM_URL;
    const confirmUrl = `${confirmUrlBase}?token=${encodeURIComponent(newToken)}`;
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
    try{
      await this.mailerSend.email.send(emailParams);
    }
    catch{
      console.log('email sent');
    }

  }

  async confirmEmail(token: string) {
    const userDto = await this.emailRepository.GetUser(token);
    if(!userDto || !userDto.user_id) {
        throw new Error("Issue with the token or user")
    }
    await this.emailRepository.UpdateConfirmation(userDto.user_id);
    await this.emailRepository.DeleteFromToken(token);
  }

  @Cron('*/3 * * * *')
  private async checkEmailTime() {
    const emailTimes = await this.emailRepository.getEmailTimes();
    for (const emailTime of emailTimes) {
      const alerts = await this.emailRepository.getAlerts(
        emailTime.id,
        emailTime.last_email_time
      );

      const severityRank = { critical: 3, moderate: 2, mild: 1 };

      const topAlerts = alerts.sort((a, b) => severityRank[b.alert_level] - severityRank[a.alert_level]).slice(0, 10);

      // Format alerts into HTML
      const alertHtml = topAlerts.map( (alert, index) => `<li><strong>Level ${alert.alert_level}</strong>: ${alert.description}</li>` ).join('');

      const alertSectionHtml = `
        <p>You have new security alerts since your last email:</p>
        <ul>${alertHtml}</ul>`;

      // Text fallback
      const alertText = topAlerts.map((alert, index) => `• Level ${alert.alert_level}: ${alert.description}`).join('\n');

      
      const recipients = (await this.emailRepository.GetEmail(emailTime.id))
      const emailParams = new EmailParams()
      .setFrom(this.sentFrom)                  
      .setTo(recipients ? [recipients] : [])                    
      .setReplyTo(this.sentFrom)              
      .setSubject(`Top 10 Security Alerts from ${emailTime.last_email_time} `)        
      .setHtml(alertSectionHtml)                                       
      .setText(`Top 10 Alerts:\n\n${alertText}`);
      await this.mailerSend.email.send(emailParams);
      
      this.emailRepository.updateEmailTime(emailTime.id, this.updateEmailTime(emailTime))
    }

  }

  private updateEmailTime(emailTime){
    
    const result = new Date(emailTime.last_email_time);

    switch (emailTime.wait_value) {
      case 'DAY':
        result.setDate(result.getDate() + emailTime.wait_unit);
        break;
      case 'WEEK':
        result.setDate(result.getDate() + (emailTime.wait_unit * 7));
        break;
      case 'MONTH':
        result.setMonth(result.getMonth() + emailTime.wait_unit);
        break;
      case 'YEAR':
        result.setFullYear(result.getFullYear() + emailTime.wait_unit);
      break;

      default:
        throw new Error(`Unsupported unit: ${emailTime.wait_value}`);
    }

    return result;
  }

  async addEmailTime(emailTimeInput: EmailTimeInput) {
    const emailTime = new EmailTime();
    emailTime.id = emailTimeInput.id;
    emailTime.wait_unit = emailTimeInput.wait_unit;
    emailTime.wait_value = emailTimeInput.wait_value;
    emailTime.next_email_time = emailTimeInput.first_email_time;
    emailTime.last_email_time = new Date();

    
    await this.emailRepository.InsertEmailTime(emailTime);
  }
    
}
