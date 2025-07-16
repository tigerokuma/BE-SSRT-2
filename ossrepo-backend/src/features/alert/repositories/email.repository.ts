import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfirmTokenInsert, EmailTime } from '../dto/email.dto';

@Injectable()
export class EmailRepository {
    constructor(private readonly prisma: PrismaService) {}

    async InsertToken(confirmTokenInsert: ConfirmTokenInsert) {
        return this.prisma.emailConfirmation.create({
            data: {
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

    async DeleteFromTime() {
        return await this.prisma.emailConfirmation.deleteMany({
            where: {
                expires_at: {
                lt: new Date(),
                },
            },
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

    async InsertEmailTime(emailTime: EmailTime) {
        this.prisma.emailTime.upsert({
            where: { id: emailTime.id }, 
            update: {
                last_email_time: emailTime.last_email_time,
                wait_value: emailTime.wait_value,
                wait_unit: emailTime.wait_unit,
            },
            create: {
                id: emailTime.id, 
                last_email_time: emailTime.last_email_time,
                wait_value: emailTime.wait_value,
                job_id: "",
                wait_unit: emailTime.wait_unit,
            },
        });

    }

}