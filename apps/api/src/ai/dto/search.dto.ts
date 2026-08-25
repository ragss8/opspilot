import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MaxLength, MinLength } from 'class-validator';
import type { SearchScope } from '../ai.types';

export class SearchDto {
  @ApiProperty({ example: 'brake overheat procedure' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  q!: string;

  @ApiPropertyOptional({
    enum: ['all', 'incidents', 'knowledge'],
    default: 'all',
  })
  @IsIn(['all', 'incidents', 'knowledge'])
  scope: SearchScope = 'all';

  @ApiPropertyOptional({ minimum: 1, maximum: 12, default: 8 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(12)
  limit?: number;
}
