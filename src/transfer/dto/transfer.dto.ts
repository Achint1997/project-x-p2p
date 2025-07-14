import { IsUUID, IsNumber, IsPositive, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class TransferDto {
  @ApiProperty({ example: 'uuid-of-destination-wallet' })
  @IsUUID()
  destinationWalletId: string;

  @ApiProperty({ example: 50.25 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Type(() => Number)
  amount: number;

  @ApiProperty({ example: 'Payment for dinner', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ 
    example: 'unique-idempotency-key-12345',
    description: 'Unique key to prevent duplicate transfers. If not provided, one will be generated.',
    required: false 
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  idempotencyKey?: string;

  @ApiProperty({ 
    example: 'external-ref-12345',
    description: 'External reference ID for tracking (e.g., from external payment system)',
    required: false 
  })
  @IsOptional()
  @IsString()
  externalReferenceId?: string;
} 