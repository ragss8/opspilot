import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ClassifyDto {
  @ApiProperty({
    example:
      'Driver reports smoke from the left rear wheel and the brake temperature is 225 C.',
    minLength: 3,
    maxLength: 4000,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  text!: string;
}
