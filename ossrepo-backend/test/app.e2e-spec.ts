import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// describe('AppController (e2e)', () => {
//   let app: INestApplication<App>;
//
//   beforeEach(async () => {
//     const moduleFixture: TestingModule = await Test.createTestingModule({
//       imports: [AppModule],
//     }).compile();
//
//     app = moduleFixture.createNestApplication();
//     await app.init();
//   });
//
//   it('/ (GET)', () => {
//     return request(app.getHttpServer())
//       .get('/')
//       .expect(200)
//       .expect('Hello World!');
//   });
// });

describe('Graph Build Task (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/graph/build/:repoId (POST) should trigger a build', async () => {
    const repoId = 'microsoft/vscode'; // <--- use org/repo
    const payload = { commitId: '01d4012' };

    const res = await request(app.getHttpServer())
      .post(`/graph/build/${encodeURIComponent(repoId)}`) // encode if repoId has slashes
      .send(payload)
      .expect(202);

    expect(res.body).toHaveProperty('message', 'Build triggered');
    expect(res.body).toHaveProperty('repoId', repoId);
    expect(res.body).toHaveProperty('status', 'in_progress');
    expect(res.body).toHaveProperty('buildTaskId');
  });

  it('/graph/status/:repoId (GET) should return latest build status', async () => {
    const repoId = 'microsoft/vscode';

    const res = await request(app.getHttpServer())
      .get(`/graph/status/${encodeURIComponent(repoId)}`)
      .expect(200);

    expect(res.body).toHaveProperty('repoId', repoId);
    expect(res.body).toHaveProperty('buildTaskId');
    expect(res.body).toHaveProperty('status');
  });
});

