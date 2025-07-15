// src/app.module.ts
import {Module} from '@nestjs/common';
import {WatchlistModule} from './features/watchlist/watchlist.module';
import {PrismaModule} from './common/prisma/prisma.module';
import {GraphModule} from './features/graph/graph.module';
import {ConfigModule} from '@nestjs/config';
import {PackagesModule} from './features/packages/packages.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true, // Loads .env automatically
        }),
        ConfigModule,
        PackagesModule,
        WatchlistModule,
        PrismaModule,
        GraphModule
    ],
})
export class AppModule {
}
