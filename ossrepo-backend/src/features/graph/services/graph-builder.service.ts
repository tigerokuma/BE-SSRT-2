type PythonBuildResponse = {
  message: string;
  taskId: string;
  status: string;
};

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class GraphBuilderService {
  constructor(private readonly httpService: HttpService) {}

  async triggerBuild(payload: any): Promise<PythonBuildResponse> {
    const url = 'http://localhost:8000/internal/build';
    const response$ = this.httpService.post<PythonBuildResponse>(url, payload);
    const response = await firstValueFrom(response$);
    return response.data;
  }
}
