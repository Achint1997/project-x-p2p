import { ApiProperty } from '@nestjs/swagger';
import { TransactionStatus } from '../../database/entities/transaction.entity';

export class TransferResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  id: string;

  @ApiProperty({ example: 50.25 })
  amount: number;

  @ApiProperty({ example: 'Payment for dinner' })
  description: string;

  @ApiProperty({ example: 'uuid-of-source-wallet' })
  sourceWalletId: string;

  @ApiProperty({ example: 'uuid-of-destination-wallet' })
  destinationWalletId: string;

  @ApiProperty({ example: 'COMPLETED', enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({ example: '2023-12-01T10:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: { sourceUserId: 'uuid', destinationUserId: 'uuid' } })
  metadata: Record<string, any>;
} 