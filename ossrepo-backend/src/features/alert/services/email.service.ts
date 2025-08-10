import { Injectable } from '@nestjs/common';
import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';
import { EmailTimeInput } from '../dto/email.dto';
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

  private async sendEmail(
    user_id: string,
    subject: string,
    html: string,
    text: string
  ) {
    // get the email from the user_id
    const email = await this.emailRepository.GetEmail(user_id);
    if(!email){
      throw new Error("Recipient email not defined");
    }
    const recipients = [ new Recipient(
      email?.email, 
      user_id) ];

    if(!recipients) {
      throw new Error('Unknown recipient')
    }

    // send the email
    const emailParams = new EmailParams()
    .setFrom(this.sentFrom)                  
    .setTo(recipients)                    
    .setReplyTo(this.sentFrom)              
    .setSubject(subject)        
    .setHtml(html)                                       
    .setText(text);
    
    await this.mailerSend.email.send(emailParams);

  }

  async sendConfirmation(user_id) {
    const newToken = randomUUID();
    const confirmTokenInsert = {
      user_id: user_id,
      token: newToken,
      expires_at: new Date()
    };

    this.emailRepository.InsertToken(confirmTokenInsert);

    // Generate the confirmation link
    const confirmUrlBase = process.env.EMAIL_CONFIRM_URL;
    const confirmUrl = `${confirmUrlBase}?token=${encodeURIComponent(newToken)}`;

    const subject = 'Confirm your email';
    const text = `Hi ${user_id},\nConfirm your email: ${confirmUrl}`;

    const html = `
      <p>Hi ${user_id},</p>
      <p>Click <a href="${confirmUrl}">here</a> to confirm your email.</p>
    `;

    this.sendEmail(user_id, subject, html, text);
  }

  async checkConfirmation(user_id: string) {
    return await this.emailRepository.CheckConfirmation(user_id);
  }

  async getUserEmailTime(user_id: string) {
    return await this.emailRepository.getUserEmailTime(user_id);
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
    const emailTime = {
      id : emailTimeInput.id,
      wait_unit : emailTimeInput.wait_unit,
      wait_value : emailTimeInput.wait_value,
      next_email_time : emailTimeInput.first_email_time,
      last_email_time : new Date(),
    };
    
    await this.emailRepository.InsertEmailTime(emailTime);
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


  // Checks every 3 minutes to see if there are any emails to send
  @Cron('*/3 * * * *')
  private async sendTimedEmails() {
    const emailTimes = await this.emailRepository.getEmailTimes();

    for (const emailTime of emailTimes) {
      // Get the top 10 most severe alerts and send them with the email

      const alerts = await this.emailRepository.getAlerts({
        user_id: emailTime.id,
        last_email_time: emailTime.last_email_time
      });
      
      const severityRank = { critical: 3, moderate: 2, mild: 1 };

      // Top 10 alerts sorted by alert_level
      const topAlerts = alerts.sort((a, b) => severityRank[b.alert_level] - severityRank[a.alert_level]).slice(0, 10);

      // Format alerts into HTML
      const alertHtml = topAlerts.map( (alert, index) => `<li><strong>Level ${alert.alert_level}</strong>: ${alert.description}</li>` ).join('');
      const alertSectionHtml = `
        <p>You have new security alerts since your last email:</p>
        <ul>${alertHtml}</ul>`;

      // Text fallback
      const alertText = topAlerts.map((alert, index) => `• Level ${alert.alert_level}: ${alert.description}`).join('\n');
      const alertSectionText = `Top 10 Alerts:\n\n${alertText}`;
      
      const subject = 'Top 10 Security Alerts from ${emailTime.last_email_time}';

      this.sendEmail(emailTime.id, subject, alertSectionHtml, alertSectionText);
      
      this.emailRepository.updateEmailTime({
        user_id: emailTime.id, 
        next_email_time: this.updateEmailTime(emailTime)
      })
    }

  }
    
}
