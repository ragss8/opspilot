import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { FleetModule } from '../fleet/fleet.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

/**
 * Sits above both feature modules so the overview can compose fleet facts with
 * AI health without either module depending on the other.
 */
@Module({
  imports: [FleetModule, AiModule],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
