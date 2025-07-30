import { Controller, Get, Param } from '@nestjs/common';
import { AlertCentreService } from  '../services/alert-centre.service';

@Controller('alert_centre')
export class AlertCentreController {
  constructor(private readonly service: AlertCentreService) {}

  @Get("alert/:alert_id")
  getAlert(@Param('alert_id') alert_id: string) {
    return this.service.getAlert(alert_id);
  }

  @Get("user/:user_id")
  getUserAlerts(@Param("user_id") user_id: string) {
    return this.service.getUserAlerts(user_id);
  }

}