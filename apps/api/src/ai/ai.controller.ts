import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AiTelemetryService } from '../telemetry/ai-telemetry.service';
import { AiService } from './ai.service';
import type { ChatStreamEvent } from './ai.types';
import { ClassificationService } from './classification.service';
import { ConversationService } from './conversation.service';
import { ChatDto } from './dto/chat.dto';
import { ClassifyDto } from './dto/classify.dto';
import { SearchDto } from './dto/search.dto';
import { IndexBuilderService } from './index-builder.service';
import { RetrievalService } from './retrieval.service';

@ApiTags('AI copilot')
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly retrieval: RetrievalService,
    private readonly classifier: ClassificationService,
    private readonly conversation: ConversationService,
    private readonly telemetry: AiTelemetryService,
    private readonly indexBuilder: IndexBuilderService,
  ) {}

  @Post('chat')
  @ApiOperation({
    summary: 'Ask the grounded fleet operations copilot a question',
  })
  @ApiOkResponse({
    description:
      'Grounded answer with session id, route, confidence, citations, tool calls, token usage, and the full execution trace.',
  })
  @ApiBadRequestResponse({ description: 'The message failed DTO validation.' })
  chat(@Body() body: ChatDto) {
    return this.ai.chat(body.message.trim(), { sessionId: body.sessionId });
  }

  /**
   * Server-sent events. Emits route, retrieval, tool, and token events as they
   * happen, then a final `done` event carrying the complete response object.
   */
  @Post('chat/stream')
  // A stream is not a creation, so answer 200 rather than the POST default.
  @HttpCode(200)
  @ApiOperation({ summary: 'Stream a copilot answer over server-sent events' })
  async stream(@Body() body: ChatDto, @Res() response: Response): Promise<void> {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    const send = (event: ChatStreamEvent): void => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.ai.chat(body.message.trim(), {
        sessionId: body.sessionId,
        onEvent: send,
      });
    } catch (error) {
      send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Generation failed',
      });
    } finally {
      response.end();
    }
  }

  @Get('search')
  @ApiOperation({ summary: 'Run semantic search over incidents and knowledge' })
  @ApiOkResponse({
    description:
      'Two-stage results: dense recall from the vector index, reranked with BM25 and MMR. Each result reports its vector and lexical component scores.',
  })
  search(@Query() query: SearchDto) {
    return this.retrieval.search(query.q, query.scope, query.limit ?? 8);
  }

  @Post('classify')
  @ApiOperation({ summary: 'Classify and triage a new operational report' })
  @ApiOkResponse({
    description:
      'Category, severity, escalation decision, rationale, recommended action, prompt version, and token usage.',
  })
  @ApiBadRequestResponse({ description: 'The report text failed DTO validation.' })
  classify(@Body() body: ClassifyDto) {
    return this.classifier.classify(body.text.trim());
  }

  @Get('telemetry')
  @ApiOperation({ summary: 'AI run telemetry for this process' })
  @ApiOkResponse({
    description:
      'Aggregate latency, grounding rate, fallback rate, token totals, and cost across recorded runs.',
  })
  getTelemetry() {
    return {
      snapshot: this.telemetry.snapshot(),
      recent: this.telemetry.recent(20),
      index: this.indexBuilder.result,
    };
  }

  @Delete('session/:sessionId')
  @ApiOperation({ summary: 'Clear a conversation session' })
  @ApiOkResponse({ description: 'The session history was discarded.' })
  resetSession(@Param('sessionId') sessionId: string) {
    this.conversation.reset(sessionId);
    return { sessionId, cleared: true };
  }
}
