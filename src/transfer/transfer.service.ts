import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as dayjs from 'dayjs';
import { Wallet } from '../database/entities/wallet.entity';
import { Transaction, TransactionType, TransactionStatus, TransferState } from '../database/entities/transaction.entity';
import { TransferLimit } from '../database/entities/transfer-limit.entity';
import { User } from '../database/entities/user.entity';
import { CacheService } from '../cache/cache.service';
import { IdempotencyService, IdempotencyRequest } from '../common/services/idempotency.service';
import { SagaService, SagaContext } from '../common/services/saga.service';
import { WalletService } from '../wallet/wallet.service';
import { TransferDto } from './dto/transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';
import { TransactionResponseDto, TransactionHistoryResponseDto } from './dto/transaction-response.dto';

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    @InjectRepository(TransferLimit)
    private transferLimitRepository: Repository<TransferLimit>,
    private cacheService: CacheService,
    private idempotencyService: IdempotencyService,
    private sagaService: SagaService,
    private walletService: WalletService,
    private dataSource: DataSource,
  ) {}

  /**
   * Transfer funds with full idempotency and distributed transaction support
   */
  async transferFunds(sourceWalletId: string, user: User, transferDto: TransferDto): Promise<TransferResponseDto> {
    const { destinationWalletId, amount, description, externalReferenceId } = transferDto;

    // Generate or use provided idempotency key
    const idempotencyKey = transferDto.idempotencyKey || 
      this.idempotencyService.generateIdempotencyKey({
        sourceWalletId,
        destinationWalletId,
        amount,
        userId: user.id,
        timestamp: Date.now(),
      });

    // Create idempotency request
    const idempotencyRequest: IdempotencyRequest = {
      key: idempotencyKey,
      requestHash: this.idempotencyService.createRequestHash(
        'POST',
        `/wallets/${sourceWalletId}/transfer`,
        transferDto,
        user.id
      ),
      endpoint: `/wallets/${sourceWalletId}/transfer`,
      method: 'POST',
      userId: user.id,
      payload: transferDto,
    };

    // Check idempotency
    const idempotencyResult = await this.idempotencyService.checkIdempotency<TransferResponseDto>(
      idempotencyKey,
      idempotencyRequest
    );

    if (!idempotencyResult.isNew) {
      if (idempotencyResult.existingResult) {
        this.logger.log(`Returning cached result for idempotency key: ${idempotencyKey}`);
        return idempotencyResult.existingResult;
      }

      if (idempotencyResult.transaction) {
        return this.handleExistingTransaction(idempotencyResult.transaction);
      }
    }

    // Validate transfer request
    await this.validateTransferRequest(sourceWalletId, destinationWalletId, amount, user);

    try {
      // Execute transfer with saga pattern
      const result = await this.executeTransferSaga(
        sourceWalletId,
        destinationWalletId,
        amount,
        description,
        user,
        idempotencyKey,
        externalReferenceId
      );

      // Store successful result
      await this.idempotencyService.storeResult(idempotencyKey, result);

      return result;

    } catch (error) {
      // Store failure for idempotency
      await this.idempotencyService.storeFailure(idempotencyKey, error);
      throw error;
    }
  }

  /**
   * Execute transfer using saga pattern
   */
  private async executeTransferSaga(
    sourceWalletId: string,
    destinationWalletId: string,
    amount: number,
    description: string,
    user: User,
    idempotencyKey: string,
    externalReferenceId?: string
  ): Promise<TransferResponseDto> {

    // Create transaction record
    const transaction = await this.createTransactionRecord(
      sourceWalletId,
      destinationWalletId,
      amount,
      description,
      user,
      idempotencyKey,
      externalReferenceId
    );

    // Create saga context
    const sagaContext: SagaContext = {
      transactionId: transaction.id,
      sourceWalletId,
      destinationWalletId,
      amount,
      userId: user.id,
      idempotencyKey,
      externalReferenceId,
      metadata: {
        description,
        userEmail: user.email,
        timestamp: new Date().toISOString(),
      },
    };

    try {
      // Create saga steps
      const sagaSteps = this.sagaService.createTransferSagaSteps(sagaContext);

      // Execute saga
      const completedTransaction = await this.sagaService.executeSaga(
        transaction,
        sagaSteps,
        sagaContext
      );

      // Update transfer limits after successful completion
      await this.updateTransferLimitsUsage(user.id, amount);

      this.logger.log(
        `Transfer completed successfully: ${sourceWalletId} -> ${destinationWalletId}, ` +
        `amount=${amount}, txId=${completedTransaction.id}, idempotencyKey=${idempotencyKey}`
      );

      return this.mapToTransferResponseDto(completedTransaction);

    } catch (error) {
      this.logger.error(
        `Transfer saga failed: ${sourceWalletId} -> ${destinationWalletId}, ` +
        `amount=${amount}, txId=${transaction.id}, error=${error.message}`
      );
      throw error;
    }
  }

  /**
   * Create initial transaction record
   */
  private async createTransactionRecord(
    sourceWalletId: string,
    destinationWalletId: string,
    amount: number,
    description: string,
    user: User,
    idempotencyKey: string,
    externalReferenceId?: string
  ): Promise<Transaction> {

    const transaction = this.transactionRepository.create({
      amount,
      type: TransactionType.TRANSFER,
      status: TransactionStatus.PENDING,
      transferState: TransferState.INITIATED,
      description: description || 'P2P Transfer',
      sourceWalletId,
      destinationWalletId,
      idempotencyKey,
      externalReferenceId,
      metadata: {
        sourceUserId: user.id,
        userEmail: user.email,
        initiatedAt: new Date().toISOString(),
      },
    });

    return await this.transactionRepository.save(transaction);
  }

  /**
   * Validate transfer request
   */
  private async validateTransferRequest(
    sourceWalletId: string,
    destinationWalletId: string,
    amount: number,
    user: User
  ): Promise<void> {

    if (amount <= 0) {
      throw new BadRequestException('Transfer amount must be positive');
    }

    if (sourceWalletId === destinationWalletId) {
      throw new BadRequestException('Cannot transfer to the same wallet');
    }

    // Validate wallets exist and are accessible
    const sourceWallet = await this.walletRepository.findOne({
      where: { id: sourceWalletId, userId: user.id, isActive: true },
    });

    if (!sourceWallet) {
      throw new NotFoundException('Source wallet not found or not accessible');
    }

    const destinationWallet = await this.walletRepository.findOne({
      where: { id: destinationWalletId, isActive: true },
    });

    if (!destinationWallet) {
      throw new NotFoundException('Destination wallet not found or inactive');
    }

    if (sourceWallet.currency !== destinationWallet.currency) {
      throw new BadRequestException('Currency mismatch between wallets');
    }

    // Check balance
    if (sourceWallet.balance < amount) {
      throw new BadRequestException('Insufficient balance');
    }

    // Check transfer limits
    await this.validateTransferLimits(user.id, amount);
  }

  /**
   * Handle existing transaction (for idempotency)
   */
  private handleExistingTransaction(transaction: Transaction): TransferResponseDto {
    switch (transaction.status) {
      case TransactionStatus.COMPLETED:
        return this.mapToTransferResponseDto(transaction);

      case TransactionStatus.PROCESSING:
      case TransactionStatus.PENDING:
        throw new ConflictException({
          message: 'Transfer is already in progress',
          transactionId: transaction.id,
          status: transaction.status,
          transferState: transaction.transferState,
        });

      case TransactionStatus.FAILED:
      case TransactionStatus.CANCELLED:
        throw new BadRequestException({
          message: 'Transfer has failed',
          transactionId: transaction.id,
          status: transaction.status,
          errorDetails: transaction.errorDetails,
        });

      default:
        throw new BadRequestException({
          message: 'Transfer has unknown status',
          transactionId: transaction.id,
          status: transaction.status,
        });
    }
  }

  /**
   * Validate transfer limits (unchanged from original)
   */
  private async validateTransferLimits(userId: string, amount: number): Promise<void> {
    const transferLimit = await this.transferLimitRepository.findOne({
      where: { userId },
    });

    if (!transferLimit) {
      throw new NotFoundException('Transfer limits not found');
    }

    const now = dayjs();
    const today = dayjs().startOf('day');
    const currentMonth = dayjs().startOf('month');

    // Reset daily limit if needed
    if (dayjs(transferLimit.lastDailyReset).isBefore(today)) {
      transferLimit.dailyUsed = 0;
      transferLimit.lastDailyReset = today.toDate();
    }

    // Reset monthly limit if needed
    if (dayjs(transferLimit.lastMonthlyReset).isBefore(currentMonth)) {
      transferLimit.monthlyUsed = 0;
      transferLimit.lastMonthlyReset = currentMonth.toDate();
    }

    // Check daily limit
    if (transferLimit.dailyUsed + amount > transferLimit.dailyLimit) {
      throw new BadRequestException(
        `Daily transfer limit exceeded. Used: ${transferLimit.dailyUsed}, Limit: ${transferLimit.dailyLimit}`,
      );
    }

    // Check monthly limit
    if (transferLimit.monthlyUsed + amount > transferLimit.monthlyLimit) {
      throw new BadRequestException(
        `Monthly transfer limit exceeded. Used: ${transferLimit.monthlyUsed}, Limit: ${transferLimit.monthlyLimit}`,
      );
    }

    // Save updated limits
    await this.transferLimitRepository.save(transferLimit);
  }

  /**
   * Update transfer limits usage after successful transfer
   */
  private async updateTransferLimitsUsage(userId: string, amount: number): Promise<void> {
    const transferLimit = await this.transferLimitRepository.findOne({
      where: { userId },
    });

    if (!transferLimit) {
      this.logger.warn(`Transfer limits not found for user ${userId}`);
      return;
    }

    // Update usage
    transferLimit.dailyUsed += amount;
    transferLimit.monthlyUsed += amount;

    await this.transferLimitRepository.save(transferLimit);

    // Invalidate cache
    await this.cacheService.invalidateTransferLimitUsage(userId);
  }

  /**
   * Get transfer limits (unchanged)
   */
  async getTransferLimits(userId: string): Promise<any> {
    const transferLimit = await this.transferLimitRepository.findOne({
      where: { userId },
    });

    if (!transferLimit) {
      throw new NotFoundException('Transfer limits not found');
    }

    const now = dayjs();
    const today = dayjs().startOf('day');
    const currentMonth = dayjs().startOf('month');

    // Reset counters if needed
    if (dayjs(transferLimit.lastDailyReset).isBefore(today)) {
      transferLimit.dailyUsed = 0;
    }

    if (dayjs(transferLimit.lastMonthlyReset).isBefore(currentMonth)) {
      transferLimit.monthlyUsed = 0;
    }

    return {
      dailyLimit: transferLimit.dailyLimit,
      dailyUsed: transferLimit.dailyUsed,
      dailyRemaining: transferLimit.dailyLimit - transferLimit.dailyUsed,
      monthlyLimit: transferLimit.monthlyLimit,
      monthlyUsed: transferLimit.monthlyUsed,
      monthlyRemaining: transferLimit.monthlyLimit - transferLimit.monthlyUsed,
      lastDailyReset: transferLimit.lastDailyReset,
      lastMonthlyReset: transferLimit.lastMonthlyReset,
    };
  }

  /**
   * Get transaction history (enhanced with new fields)
   */
  async getTransactionHistory(
    walletId: string,
    userId: string,
    query: TransactionQueryDto,
  ): Promise<TransactionHistoryResponseDto> {
    const { page = 1, limit = 10, type, status, startDate, endDate } = query;

    // Verify wallet ownership
    const wallet = await this.walletRepository.findOne({
      where: { id: walletId, userId, isActive: true },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const queryBuilder = this.transactionRepository
      .createQueryBuilder('transaction')
      .where('transaction.sourceWalletId = :walletId OR transaction.destinationWalletId = :walletId', {
        walletId,
      })
      .orderBy('transaction.createdAt', 'DESC');

    if (type) {
      queryBuilder.andWhere('transaction.type = :type', { type });
    }

    if (status) {
      queryBuilder.andWhere('transaction.status = :status', { status });
    }

    if (startDate) {
      queryBuilder.andWhere('transaction.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('transaction.createdAt <= :endDate', { endDate });
    }

    const [transactions, total] = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      transactions: transactions.map(tx => this.mapToTransactionResponseDto(tx, walletId)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get transaction by idempotency key (for debugging)
   */
  async getTransactionByIdempotencyKey(idempotencyKey: string): Promise<Transaction | null> {
    return await this.transactionRepository.findOne({
      where: { idempotencyKey },
    });
  }

  /**
   * Health check for transfer system
   */
  async healthCheck(): Promise<{
    status: string;
    pendingTransfers: number;
    failedTransfers: number;
    idempotencyStatus: string;
  }> {
    try {
      const [pendingCount, failedCount] = await Promise.all([
        this.transactionRepository.count({
          where: { status: TransactionStatus.PENDING },
        }),
        this.transactionRepository.count({
          where: { status: TransactionStatus.FAILED },
        }),
      ]);

      return {
        status: 'healthy',
        pendingTransfers: pendingCount,
        failedTransfers: failedCount,
        idempotencyStatus: 'operational',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        pendingTransfers: -1,
        failedTransfers: -1,
        idempotencyStatus: 'error',
      };
    }
  }

  /**
   * Map transaction to transfer response DTO
   */
  private mapToTransferResponseDto(transaction: Transaction): TransferResponseDto {
    return {
      id: transaction.id,
      amount: transaction.amount,
      sourceWalletId: transaction.sourceWalletId,
      destinationWalletId: transaction.destinationWalletId,
      description: transaction.description,
      status: transaction.status,
      createdAt: transaction.createdAt,
      metadata: {
        ...transaction.metadata,
        transferState: transaction.transferState,
        idempotencyKey: transaction.idempotencyKey,
        externalReferenceId: transaction.externalReferenceId,
        completedAt: transaction.completedAt,
      },
    };
  }

  /**
   * Map transaction to transaction response DTO
   */
  private mapToTransactionResponseDto(transaction: Transaction, walletId: string): TransactionResponseDto {
    const isIncoming = transaction.destinationWalletId === walletId;
    const isOutgoing = transaction.sourceWalletId === walletId;

    let direction: 'incoming' | 'outgoing' | 'internal';
    if (isIncoming && isOutgoing) {
      direction = 'internal';
    } else if (isIncoming) {
      direction = 'incoming';
    } else {
      direction = 'outgoing';
    }

    return {
      id: transaction.id,
      amount: transaction.amount,
      type: transaction.type,
      status: transaction.status,
      description: transaction.description,
      direction,
      sourceWalletId: transaction.sourceWalletId,
      destinationWalletId: transaction.destinationWalletId,
      createdAt: transaction.createdAt,
      metadata: {
        ...transaction.metadata,
        transferState: transaction.transferState,
        idempotencyKey: transaction.idempotencyKey,
        externalReferenceId: transaction.externalReferenceId,
      },
    };
  }
} 