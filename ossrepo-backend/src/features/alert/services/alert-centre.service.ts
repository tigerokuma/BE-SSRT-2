import { Injectable } from '@nestjs/common';
import { AlertCentreRepository } from '../repositories/alert.repository';
import { CreateAlertDto, UpdateAlertDto } from '../dto/create-alert.dto';

@Injectable()
export class AlertCentreService {
  constructor(private readonly alertRepository: AlertCentreRepository) {}

  getAlert(body: { alert_id: string }) {
    return this.alertRepository.getAlert(body.alert_id);
  }

  createAlert(userWatchlistId: string, createAlertDto: CreateAlertDto) {
    return this.alertRepository.createAlert(userWatchlistId, createAlertDto);
  }

  updateAlert(alert_id: string, updateAlertDto: UpdateAlertDto) {
    return this.alertRepository.updateGeneralAlert(alert_id, updateAlertDto);
  }

  deletesAlert(alert_id: string) {
    return this.alertRepository.deleteGeneralAlert(alert_id);
  }
}
