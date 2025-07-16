import { Controller, Get, Post, Patch, Delete } from '@nestjs/common';
import { AlertCentreService } from  '../services/alert-centre.service';
import { UpdateAlertDto } from '../dto/create-alert.dto';

@Controller('alert_centre/alert')
export class AlertCentreController {
  constructor(private readonly service: AlertCentreService) {}

  @Get()
  getAlert(body: any) {
    return this.service.getAlert(body);
  }

  @Patch()
  updateAlert(alert_id: string, updateAlertDto: UpdateAlertDto) {
    return this.service.updateAlert(alert_id, updateAlertDto);
  }

  @Delete()
  deletesAlert(body: any) {
    return this.service.deletesAlert(body);
  }

  @Post()
  createAlert(userWatchlistId: string, body: any) {
    return this.service.createAlert(userWatchlistId, body);
  }
}