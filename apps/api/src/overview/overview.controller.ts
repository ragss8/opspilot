import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OverviewService } from './overview.service';

@ApiTags('Fleet operations')
@Controller()
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Get the control-tower overview, daily brief, and AI health',
  })
  @ApiOkResponse({
    description:
      'Fleet KPIs aggregated from vehicle and incident records, the computed shift briefing, trends, and live AI telemetry.',
  })
  getOverview() {
    return this.overview.getOverview();
  }
}
