import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { Transaction, TransactionStatus } from '../../database/entities/transaction.entity';
import * as crypto from 'crypto';

export interface IdempotencyRequest {
  key: string;
  requestHash: string;
  endpoint: string;
  method: string;
  userId: string;
  payload: any;
}

export interface IdempotencyResult<T> {
  isNew: boolean;
  existingResult?: T;
  transaction?: Transaction;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly CACHE_TTL = 3600; // 1 hour in seconds
  private readonly REQUEST_TTL = 1800; // 30 minutes in seconds

  constructor(
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    private cacheService: CacheService,
    private dataSource: DataSource,
  ) {}

  /**
   * Generate idempotency key if not provided
   */
  generateIdempotencyKey(request: any): string {
    // Include timestamp to ensure uniqueness for auto-generated keys
    const requestData = {
      ...request,
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(7),
    };
    const requestString = JSON.stringify(requestData);
    return `auto_${crypto.createHash('sha256').update(requestString).digest('hex')}`;
  }

  /**
   * Create request hash for duplicate detection
   */
  createRequestHash(method: string, endpoint: string, payload: any, userId: string): string {
    // Only include core business parameters, exclude auto-generated fields
    const corePayload = {
      destinationWalletId: payload.destinationWalletId,
      amount: payload.amount,
      description: payload.description,
      // Exclude idempotencyKey and externalReferenceId as these can vary for same business operation
    };
    
    const requestData = {
      method,
      endpoint,
      payload: corePayload,
      userId,
    };
    return crypto.createHash('md5').update(JSON.stringify(requestData)).digest('hex');
  }

  /**
   * Check if request is duplicate and handle idempotency
   */
  async checkIdempotency<T>(
    idempotencyKey: string,
    request: IdempotencyRequest
  ): Promise<IdempotencyResult<T>> {
    const cacheKey = `idempotency:${idempotencyKey}`;
    
    try {
      // Check cache first for fast response
      const cachedResult = await this.cacheService.get(cacheKey);
      if (cachedResult) {
        this.logger.debug(`Cache hit for idempotency key: ${idempotencyKey}`);
        return {
          isNew: false,
          existingResult: JSON.parse(cachedResult),
        };
      }

      // Check database for existing transaction
      const existingTransaction = await this.transactionRepository.findOne({
        where: { idempotencyKey },
        order: { createdAt: 'DESC' },
      });

      if (existingTransaction) {
        return await this.handleExistingTransaction<T>(existingTransaction, cacheKey);
      }

      // Only validate request uniqueness for explicitly provided idempotency keys
      // Auto-generated keys (prefixed with 'auto_') are allowed to be different for same request
      const isExplicitKey = !idempotencyKey.startsWith('auto_');
      if (isExplicitKey) {
        await this.validateRequestUniqueness(request, idempotencyKey);
      }

      this.logger.debug(`New request with idempotency key: ${idempotencyKey}`);
      return { isNew: true };

    } catch (error) {
      this.logger.error(`Idempotency check failed for key ${idempotencyKey}:`, error);
      throw error;
    }
  }

  /**
   * Store successful operation result
   */
  async storeResult<T>(idempotencyKey: string, result: T): Promise<void> {
    const cacheKey = `idempotency:${idempotencyKey}`;
    
    try {
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(result),
        this.CACHE_TTL
      );

      // Also store in a separate index for request tracking
      const requestKey = `idempotency_request:${idempotencyKey}`;
      await this.cacheService.set(
        requestKey,
        JSON.stringify({
          completedAt: new Date().toISOString(),
          status: 'completed',
        }),
        this.REQUEST_TTL
      );

      this.logger.debug(`Stored result for idempotency key: ${idempotencyKey}`);
    } catch (error) {
      this.logger.error(`Failed to store idempotency result for ${idempotencyKey}:`, error);
      // Don't throw error as the operation was successful
    }
  }

  /**
   * Store failed operation
   */
  async storeFailure(idempotencyKey: string, error: any): Promise<void> {
    const cacheKey = `idempotency_error:${idempotencyKey}`;
    
    try {
      const errorData = {
        error: error.message || 'Unknown error',
        status: error.status || 500,
        timestamp: new Date().toISOString(),
      };

      await this.cacheService.set(
        cacheKey,
        JSON.stringify(errorData),
        300 // 5 minutes for errors
      );

      this.logger.debug(`Stored failure for idempotency key: ${idempotencyKey}`);
    } catch (cacheError) {
      this.logger.error(`Failed to store idempotency failure for ${idempotencyKey}:`, cacheError);
    }
  }

  /**
   * Handle existing transaction based on its status
   */
  private async handleExistingTransaction<T>(
    transaction: Transaction,
    cacheKey: string
  ): Promise<IdempotencyResult<T>> {
    
    switch (transaction.status) {
      case TransactionStatus.COMPLETED:
        // Try to get cached result first
        const cachedResult = await this.cacheService.get(cacheKey);
        if (cachedResult) {
          return {
            isNew: false,
            existingResult: JSON.parse(cachedResult),
          };
        }

        // Reconstruct result from transaction
        const result = this.reconstructResultFromTransaction(transaction);
        if (result) {
          // Cache the reconstructed result
          await this.storeResult(transaction.idempotencyKey, result);
          return {
            isNew: false,
            existingResult: result,
          };
        }
        break;

      case TransactionStatus.PROCESSING:
      case TransactionStatus.PENDING:
        // Return the transaction so caller can check status
        return {
          isNew: false,
          transaction,
        };

      case TransactionStatus.FAILED:
      case TransactionStatus.CANCELLED:
        // Check if this was a temporary failure that can be retried
        if (this.canRetryFailedTransaction(transaction)) {
          this.logger.log(`Allowing retry for failed transaction: ${transaction.id}`);
          return { isNew: true };
        }

        // Return the failed transaction
        return {
          isNew: false,
          transaction,
        };

      default:
        this.logger.warn(`Unknown transaction status: ${transaction.status}`);
        return {
          isNew: false,
          transaction,
        };
    }

    // Fallback - treat as new if we can't determine status
    return { isNew: true };
  }

  /**
   * Validate that the request is not a duplicate with different idempotency key
   * Only applies to explicitly provided idempotency keys
   */
  private async validateRequestUniqueness(
    request: IdempotencyRequest,
    idempotencyKey: string
  ): Promise<void> {
    const requestHashKey = `request_hash:${request.requestHash}`;
    
    try {
      const existingData = await this.cacheService.get(requestHashKey);
      
      if (existingData) {
        const parsedData = JSON.parse(existingData);
        const existingKey = parsedData.idempotencyKey;
        const createdAt = new Date(parsedData.createdAt);
        const now = new Date();
        
        // Allow requests if the previous one is older than 5 minutes
        // This handles cases where users legitimately retry after some time
        const timeDiffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);
        
        if (existingKey !== idempotencyKey && timeDiffMinutes < 5) {
          this.logger.warn(
            `Duplicate request detected with different idempotency key within 5 minutes. ` +
            `Original: ${existingKey}, New: ${idempotencyKey}, TimeDiff: ${timeDiffMinutes.toFixed(2)}min`
          );
          
          // Check if the original transaction is still pending/processing
          const originalTransaction = await this.transactionRepository.findOne({
            where: { idempotencyKey: existingKey },
            select: ['id', 'status', 'createdAt'],
          });
          
          // Only throw conflict if original transaction is still active
          if (originalTransaction && this.isTransactionInProgress(originalTransaction)) {
            throw new ConflictException(
              `A similar transfer is already in progress. Please wait or use the same idempotency key: ${existingKey}`
            );
          }
          
          // If original transaction is completed/failed, allow the new request
          this.logger.log(
            `Allowing duplicate request as original transaction is no longer active: ${originalTransaction?.status || 'not found'}`
          );
        }
      }

      // Store the mapping with metadata
      const requestData = {
        idempotencyKey,
        createdAt: new Date().toISOString(),
        endpoint: request.endpoint,
        method: request.method,
      };
      
      await this.cacheService.set(
        requestHashKey,
        JSON.stringify(requestData),
        this.REQUEST_TTL
      );

    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      // Log cache errors but don't fail the request for infrastructure issues
      this.logger.error(`Failed to validate request uniqueness (non-blocking):`, error);
    }
  }

  /**
   * Reconstruct API result from completed transaction
   */
  private reconstructResultFromTransaction(transaction: Transaction): any {
    if (!transaction.isCompleted()) {
      return null;
    }

    // Basic transfer response structure
    return {
      id: transaction.id,
      amount: transaction.amount,
      sourceWalletId: transaction.sourceWalletId,
      destinationWalletId: transaction.destinationWalletId,
      description: transaction.description,
      status: transaction.status,
      transferState: transaction.transferState,
      createdAt: transaction.createdAt,
      completedAt: transaction.completedAt,
      metadata: transaction.metadata,
    };
  }

  /**
   * Determine if a failed transaction can be retried
   */
  private canRetryFailedTransaction(transaction: Transaction): boolean {
    // Don't retry if too many attempts
    if (transaction.retryCount >= 3) {
      return false;
    }

    // Don't retry business logic failures
    const nonRetryableErrors = [
      'insufficient_balance',
      'invalid_wallet',
      'limit_exceeded',
      'currency_mismatch',
    ];

    if (transaction.errorDetails?.errorCode && 
        nonRetryableErrors.includes(transaction.errorDetails.errorCode)) {
      return false;
    }

    // Allow retry for network/timeout errors
    return true;
  }

  /**
   * Check if a transaction is currently in progress
   */
  private isTransactionInProgress(transaction: Partial<Transaction>): boolean {
    return [
      TransactionStatus.PENDING,
      TransactionStatus.PROCESSING,
    ].includes(transaction.status as TransactionStatus);
  }

  /**
   * Clean up expired idempotency keys
   */
  async cleanupExpiredKeys(): Promise<void> {
    this.logger.debug('Starting cleanup of expired idempotency keys');
    
    try {
      // This would typically be implemented with a batch job
      // For now, we rely on Redis TTL for cleanup
      
      // Could implement: find expired transactions and clean their cache entries
      const expiredTransactions = await this.transactionRepository
        .createQueryBuilder('transaction')
        .where('transaction.createdAt < :expiry', {
          expiry: new Date(Date.now() - this.CACHE_TTL * 1000)
        })
        .andWhere('transaction.status IN (:...statuses)', {
          statuses: [TransactionStatus.COMPLETED, TransactionStatus.FAILED]
        })
        .getMany();

      this.logger.debug(`Found ${expiredTransactions.length} expired transactions for cleanup`);
      
    } catch (error) {
      this.logger.error('Failed to cleanup expired idempotency keys:', error);
    }
  }

  /**
   * Get idempotency status for debugging
   */
  async getIdempotencyStatus(idempotencyKey: string): Promise<{
    exists: boolean;
    status?: string;
    createdAt?: Date;
    transaction?: Partial<Transaction>;
  }> {
    try {
      const transaction = await this.transactionRepository.findOne({
        where: { idempotencyKey },
        select: ['id', 'status', 'transferState', 'createdAt', 'completedAt', 'errorDetails'],
      });

      if (transaction) {
        return {
          exists: true,
          status: transaction.status,
          createdAt: transaction.createdAt,
          transaction: {
            id: transaction.id,
            status: transaction.status,
            transferState: transaction.transferState,
            errorDetails: transaction.errorDetails,
          },
        };
      }

      return { exists: false };
    } catch (error) {
      this.logger.error(`Failed to get idempotency status for ${idempotencyKey}:`, error);
      return { exists: false };
    }
  }
} 