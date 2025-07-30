import { Injectable } from '@nestjs/common';
import { AlertCentreRepository } from '../repositories/alert.repository';

@Injectable()
export class AlertCentreService {
  constructor(private readonly alertRepository: AlertCentreRepository) {}

  getAlert(alert_id: string ) {
    return this.alertRepository.getAlert(alert_id);
  }

  getUserAlerts(user_watchlist_id: string) {
    return this.alertRepository.getUserAlerts(user_watchlist_id);
  }

}
