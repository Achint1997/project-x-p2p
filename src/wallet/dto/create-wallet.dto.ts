import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWalletDto {
  @ApiProperty({ example: 'My Primary Wallet', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'USD', default: 'USD' })
  @IsOptional()
  @IsEnum(['USD', 'EUR', 'GBP'])
  currency?: string;
} 