import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ChatDto {
  @ApiProperty({
    example: 'What should I do about the brake alert on VH-2047?',
    minLength: 2,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({
    description:
      'Conversation session to continue. Omit to start a new one; the response returns the id to reuse.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
