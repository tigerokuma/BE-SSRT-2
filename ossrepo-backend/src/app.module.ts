// src/app.module.ts
import {Module} from '@nestjs/common';
import {WatchlistModule} from './features/watchlist/watchlist.module';
import {PrismaModule} from './common/prisma/prisma.module';
import {GraphModule} from './features/graph/graph.module';
import {ConfigModule} from '@nestjs/config';
import {PackagesModule} from './features/packages/packages.module';
import { UserModule } from './features/user/user.module';
import { AlertModule } from './features/alert/alert.module';
import { SbomModule } from './features/sbom/sbom.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true, // Loads .env automatically
        }),
        ConfigModule,
        PackagesModule,
        WatchlistModule,
        AlertModule,
        SbomModule,
        PrismaModule,
        GraphModule,
        UserModule
    ],
})
export class AppModule {
}
