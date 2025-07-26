import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma } from 'generated/prisma';

@Injectable()
export class SbomRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
     return true; //this.prisma.sbom.create({ data });
  }

  async findById(id: string) {
    return true; //this.prisma.sbom.findUnique({ where: { id } });
  }

  async getAllSboms(uwlId: string) {
    return true; //this.prisma.
  }
}
