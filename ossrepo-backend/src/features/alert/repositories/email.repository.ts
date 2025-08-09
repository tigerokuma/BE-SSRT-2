import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfirmTokenInsert, EmailTime, GetAlertsSince, UpdateEmailTime } from '../dto/email.dto';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class EmailRepository {
    constructor(private readonly prisma: PrismaService) {}

    async InsertToken(confirm_token_insert: ConfirmTokenInsert) {
        return this.prisma.emailConfirmation.upsert({
            where: { user_id: confirm_token_insert.user_id },
            
            update: { 
                token: confirm_token_insert.token,
                expires_at: confirm_token_insert.expires_at 
            },

            create: {
                user_id: confirm_token_insert.user_id,
                token: confirm_token_insert.token,
                expires_at: confirm_token_insert.expires_at
            }
        });
    }

    async DeleteFromToken(con_token: string) {
        return await this.prisma.emailConfirmation.delete({
            where: { token: con_token },
        });
    }

    async GetEmail(user_id: string) {
        return await this.prisma.user.findUnique({
            where: { user_id: user_id },
            select: { email: true },
        });
    }

    async GetUser(token: string) {
        return await this.prisma.emailConfirmation.findUnique({
            where: { token: token },
            select: { user_id: true },
        });

    }

    async UpdateConfirmation(user_id: string) {
        return await this.prisma.user.update({
            where: { user_id: user_id },
            data: { email_confirmed: true },
        })
    }

    async CheckConfirmation(user_id: string) {
        return await this.prisma.user.findUnique({
            where: { user_id: user_id },
            select: { email_confirmed: true}
        })
    }

    async InsertEmailTime(email_time: EmailTime) {
        return await this.prisma.emailTime.upsert({
            where: { id: email_time.id }, 
            update: {
                next_email_time: email_time.next_email_time,
                wait_value: email_time.wait_value,
                wait_unit: email_time.wait_unit,
            },
            create: {
                id: email_time.id, 
                last_email_time: email_time.last_email_time,
                next_email_time: email_time.next_email_time,
                wait_value: email_time.wait_value,
                wait_unit: email_time.wait_unit,
            },
        });
    }

    async getEmailTimes() {
        return await this.prisma.emailTime.findMany({
            where: {
                next_email_time: {
                lt: new Date(),
                },
            },
            select: { id: true, last_email_time: true, wait_unit: true, wait_value: true }
        });
    }

    async getUserEmailTime(user_id: string) {
        return await this.prisma.emailTime.findUnique({
            where: {id: user_id},
        });
    }

    async updateEmailTime(update_email_time: UpdateEmailTime) {
        this.prisma.emailTime.update({
            where: {id: update_email_time.user_id},
            data: {next_email_time: update_email_time.next_email_time}
        });
    }


    async getAlerts(get_alerts_since: GetAlertsSince) {
        const uwlId = await this.prisma.userWatchlist.findMany({
            where: { user_id: get_alerts_since.user_id },
            select: { id: true }
        });

        const uwlIds = uwlId.map(w => w.id);

        return await this.prisma.alertTriggered.findMany({
            where: {
            user_watchlist_id: {
                in: uwlIds,
                },
                created_at: {
                gt: get_alerts_since.last_email_time,
                },
            },
            select: {
                alert_level: true,
                description: true,
            },
            
        });
    }


    @Cron('*/15 * * * *') 
    async cleanupExpiredData() {
        await this.prisma.emailConfirmation.deleteMany({
        where: {
            expires_at: {
            lt: new Date(),
            },
        },
        });

    }

}