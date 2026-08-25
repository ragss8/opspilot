import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FleetService } from './fleet.service';

@ApiTags('Fleet operations')
@Controller()
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  @Get('incidents')
  @ApiOperation({ summary: 'List synthetic fleet incidents' })
  @ApiOkResponse({ description: 'Incident feed with severity and SLA rollups.' })
  getIncidents() {
    return this.fleetService.getIncidents();
  }

  @Get('documents')
  @ApiOperation({ summary: 'List indexed fleet knowledge documents' })
  @ApiOkResponse({ description: 'Knowledge articles available to RAG retrieval.' })
  getDocuments() {
    return this.fleetService.getDocuments();
  }
}
