// src/app.module.ts
import {Module} from '@nestjs/common';
import {WatchlistModule} from './features/watchlist/watchlist.module';
import {PrismaModule} from './common/prisma/prisma.module';
import {GraphModule} from './features/graph/graph.module';
import {ConfigModule} from '@nestjs/config';
import {PackagesModule} from './features/packages/packages.module';
import { UserModule } from './features/user/user.module';
import { AuthModule } from './features/auth/auth.module';
import { SbomModule } from './features/sbom/sbom.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true, // Loads .env automatically
        }),
        ConfigModule,
        PackagesModule,
        WatchlistModule,
        SbomModule,
        PrismaModule,
        GraphModule,
        UserModule,
        AuthModule
    ],
})
export class AppModule {
}
