import { ApiProperty } from '@nestjs/swagger';
import { TransactionType, TransactionStatus } from '../../database/entities/transaction.entity';

export class TransactionResponseDto {
  @ApiProperty({ example: 'uuid-string' })
  id: string;

  @ApiProperty({ example: 100.50 })
  amount: number;

  @ApiProperty({ example: 'TRANSFER', enum: TransactionType })
  type: TransactionType;

  @ApiProperty({ example: 'COMPLETED', enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty({ example: 'Payment for dinner' })
  description: string;

  @ApiProperty({ example: 'incoming', enum: ['incoming', 'outgoing', 'internal'] })
  direction: 'incoming' | 'outgoing' | 'internal';

  @ApiProperty({ example: 'uuid-of-source-wallet', nullable: true })
  sourceWalletId: string | null;

  @ApiProperty({ example: 'uuid-of-destination-wallet', nullable: true })
  destinationWalletId: string | null;

  @ApiProperty({ example: { sourceUserId: 'uuid', destinationUserId: 'uuid' } })
  metadata: Record<string, any>;

  @ApiProperty({ example: '2023-12-01T10:00:00Z' })
  createdAt: Date;
}

export class PaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 10 })
  totalPages: number;
}

export class TransactionHistoryResponseDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  transactions: TransactionResponseDto[];

  @ApiProperty({ type: PaginationDto })
  pagination: PaginationDto;
} 