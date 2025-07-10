import { Controller, Get, Post, Patch, Delete } from '@nestjs/common';
import { AlertCentreService } from  '../services/alert-centre.service';

@Controller('alert_centre/alert')
export class AlertCentreController {
  constructor(private readonly service: AlertCentreService) {}

  @Get()
  getAlert(body: any) {
    return this.service.getAlert(body);
  }

  @Patch()
  updateAlert(body: any) {
    return this.service.updateAlert(body);
  }

  @Delete()
  deletesAlert(body: any) {
    return this.service.deletesAlert(body);
  }

  @Post()
  createAlert(body: any) {
    return this.service.createAlert(body);
  }
}