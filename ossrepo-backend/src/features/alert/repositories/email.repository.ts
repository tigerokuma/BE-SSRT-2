import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfirmTokenInsert, EmailTime } from '../dto/email.dto';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class EmailRepository {
    constructor(private readonly prisma: PrismaService) {}

    async InsertToken(confirmTokenInsert: ConfirmTokenInsert) {
        return this.prisma.emailConfirmation.upsert({
            where: { user_id: confirmTokenInsert.user_id },
            
            update: { 
                token: confirmTokenInsert.token,
                expires_at: confirmTokenInsert.expires_at 
            },

            create: {
                user_id: confirmTokenInsert.user_id,
                token: confirmTokenInsert.token,
                expires_at: confirmTokenInsert.expires_at
            }
        });
    }

    async DeleteFromToken(conToken: string) {
        return await this.prisma.emailConfirmation.delete({
            where: { token: conToken },
        });
    }

    async GetEmail(userId: string) {
        return await this.prisma.user.findUnique({
            where: { user_id: userId },
            select: { email: true },
        });
    }

    async GetUser(token: string) {
        return await this.prisma.emailConfirmation.findUnique({
            where: { token: token },
            select: { user_id: true },
        });

    }

    async UpdateConfirmation(userId: string) {
        return await this.prisma.user.update({
            where: { user_id: userId },
            data: { email_confirmed: true },
        })
    }

    async CheckConfirmation(userId: string) {
        return await this.prisma.user.findUnique({
            where: { user_id: userId },
            select: { email_confirmed: true}
        })
    }

    async InsertEmailTime(emailTimeDto: EmailTime) {
        return await this.prisma.emailTime.upsert({
            where: { id: emailTimeDto.id }, 
            update: {
                next_email_time: emailTimeDto.next_email_time,
                wait_value: emailTimeDto.wait_value,
                wait_unit: emailTimeDto.wait_unit,
            },
            create: {
                id: emailTimeDto.id, 
                last_email_time: emailTimeDto.last_email_time,
                next_email_time: emailTimeDto.next_email_time,
                wait_value: emailTimeDto.wait_value,
                wait_unit: emailTimeDto.wait_unit,
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

    async getUserEmailTime(userId: string) {
        return await this.prisma.emailTime.findUnique({
            where: {id: userId},
        });
    }

    async updateEmailTime(userId: string, next_email_time: Date) {
        this.prisma.emailTime.update({
            where: {id: userId},
            data: {next_email_time: next_email_time}
        });
    }


    async getAlerts(userId: string, last_email_time: Date) {
        const uwlId = await this.prisma.userWatchlist.findMany({
            where: { user_id: userId },
            select: { id: true }
        });

        const uwlIds = uwlId.map(w => w.id);

        return await this.prisma.alertTriggered.findMany({
            where: {
            user_watchlist_id: {
                in: uwlIds,
                },
                created_at: {
                gt: last_email_time,
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