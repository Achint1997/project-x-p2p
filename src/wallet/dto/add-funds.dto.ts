import { IsNumber, IsPositive, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AddFundsDto {
  @ApiProperty({ example: 100.50 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @ApiProperty({ example: 'Deposit from bank account', required: false })
  @IsOptional()
  @IsString()
  description?: string;
} 