import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from './ai/ai.module';
import { ApiKeyGuard } from './common/api-key.guard';
import { FleetModule } from './fleet/fleet.module';
import { HealthController } from './health.controller';
import { OverviewModule } from './overview/overview.module';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      // Generation is the expensive path, so the default budget is modest.
      { name: 'short', ttl: 10_000, limit: 15 },
      { name: 'sustained', ttl: 60_000, limit: 60 },
    ]),
    TelemetryModule,
    FleetModule,
    AiModule,
    OverviewModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
