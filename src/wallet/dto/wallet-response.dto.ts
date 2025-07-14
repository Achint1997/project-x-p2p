import { ApiProperty } from '@nestjs/swagger';

export class WalletResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  id: string;

  @ApiProperty({ example: 150.75 })
  balance: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 'My Primary Wallet' })
  name: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2023-12-01T10:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-12-01T10:00:00Z' })
  updatedAt: Date;
} 