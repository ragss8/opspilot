import { Global, Module } from '@nestjs/common';
import { AiTelemetryService } from './ai-telemetry.service';

/** Global so both the fleet and AI layers can record and read runs without a cycle. */
@Global()
@Module({
  providers: [AiTelemetryService],
  exports: [AiTelemetryService],
})
export class TelemetryModule {}
