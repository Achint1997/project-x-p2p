import { Controller, Post, Get, Body, Param, Query, UseGuards, Request, Headers } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransferService } from './transfer.service';
import { TransferDto } from './dto/transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';
import { TransactionHistoryResponseDto } from './dto/transaction-response.dto';

@ApiTags('Transfers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets/:walletId')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post('transfer')
  @ApiOperation({ summary: 'Transfer funds between wallets with idempotency support' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional idempotency key to prevent duplicate transfers',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Transfer completed successfully', type: TransferResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid transfer request' })
  @ApiResponse({ status: 403, description: 'Transfer limit exceeded' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 409, description: 'Transfer already in progress (idempotency conflict)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async transferFunds(
    @Param('walletId') walletId: string,
    @Request() req,
    @Body() transferDto: TransferDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ): Promise<TransferResponseDto> {
    // Use header idempotency key if provided, otherwise use DTO value
    if (idempotencyKeyHeader && !transferDto.idempotencyKey) {
      transferDto.idempotencyKey = idempotencyKeyHeader;
    }

    return this.transferService.transferFunds(walletId, req.user, transferDto);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get transaction history for a wallet' })
  @ApiResponse({ status: 200, description: 'Transaction history retrieved successfully', type: TransactionHistoryResponseDto })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTransactionHistory(
    @Param('walletId') walletId: string,
    @Request() req,
    @Query() query: TransactionQueryDto,
  ): Promise<TransactionHistoryResponseDto> {
    return this.transferService.getTransactionHistory(walletId, req.user.id, query);
  }

  @Get('transfer-limits')
  @ApiOperation({ summary: 'Get current transfer limits and usage' })
  @ApiResponse({ status: 200, description: 'Transfer limits retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Transfer limits not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTransferLimits(@Request() req): Promise<any> {
    return this.transferService.getTransferLimits(req.user.id);
  }

  @Get('transactions/by-idempotency/:idempotencyKey')
  @ApiOperation({ summary: 'Get transaction by idempotency key (for debugging)' })
  @ApiResponse({ status: 200, description: 'Transaction retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTransactionByIdempotencyKey(
    @Param('idempotencyKey') idempotencyKey: string,
    @Request() req,
  ): Promise<any> {
    const transaction = await this.transferService.getTransactionByIdempotencyKey(idempotencyKey);
    
    if (!transaction) {
      return { exists: false };
    }

    // Only return transaction if user has access to either wallet
    const hasAccess = 
      transaction.metadata?.sourceUserId === req.user.id ||
      transaction.metadata?.destinationUserId === req.user.id;

    if (!hasAccess) {
      return { exists: false, message: 'Access denied' };
    }

    return {
      exists: true,
      transaction: {
        id: transaction.id,
        status: transaction.status,
        transferState: transaction.transferState,
        amount: transaction.amount,
        sourceWalletId: transaction.sourceWalletId,
        destinationWalletId: transaction.destinationWalletId,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        errorDetails: transaction.errorDetails,
        retryCount: transaction.retryCount,
      },
    };
  }

  @Get('health')
  @ApiOperation({ summary: 'Transfer system health check' })
  @ApiResponse({ status: 200, description: 'Health check completed' })
  async healthCheck(): Promise<any> {
    return this.transferService.healthCheck();
  }
} 