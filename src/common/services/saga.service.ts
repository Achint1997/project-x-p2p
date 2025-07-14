import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Transaction, TransactionStatus, TransferState } from '../../database/entities/transaction.entity';
import { Wallet } from '../../database/entities/wallet.entity';
import { CacheService } from '../../cache/cache.service';

export interface SagaStep {
  name: string;
  execute: () => Promise<any>;
  compensate: () => Promise<any>;
  retryable: boolean;
  maxRetries: number;
}

export interface SagaContext {
  transactionId: string;
  sourceWalletId: string;
  destinationWalletId: string;
  amount: number;
  userId: string;
  idempotencyKey: string;
  externalReferenceId?: string;
  metadata: Record<string, any>;
}

export interface SagaState {
  currentStep: number;
  completedSteps: string[];
  compensatedSteps: string[];
  lastError?: any;
  retryCount: number;
  context: SagaContext;
}

@Injectable()
export class SagaService {
  private readonly logger = new Logger(SagaService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    private cacheService: CacheService,
    private dataSource: DataSource,
  ) {}

  /**
   * Execute a saga with automatic compensation on failure
   */
  async executeSaga(
    transaction: Transaction,
    steps: SagaStep[],
    context: SagaContext
  ): Promise<Transaction> {
    const sagaState: SagaState = {
      currentStep: 0,
      completedSteps: [],
      compensatedSteps: [],
      retryCount: 0,
      context,
    };

    try {
      // Initialize saga state in transaction
      await this.updateSagaState(transaction, sagaState);

      // Execute all steps
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        sagaState.currentStep = i;

        this.logger.log(`Executing saga step ${i}: ${step.name} for transaction ${transaction.id}`);

        try {
          await step.execute();
          sagaState.completedSteps.push(step.name);
          
          // Update progress
          await this.updateSagaState(transaction, sagaState);
          await this.updateTransferState(transaction, this.getTransferStateForStep(i));
          
        } catch (stepError) {
          this.logger.error(`Saga step ${step.name} failed:`, stepError);
          sagaState.lastError = stepError;

          // Attempt retry if step is retryable
          if (step.retryable && sagaState.retryCount < step.maxRetries) {
            sagaState.retryCount++;
            await this.updateSagaState(transaction, sagaState);
            
            this.logger.log(`Retrying step ${step.name}, attempt ${sagaState.retryCount}`);
            i--; // Retry current step
            continue;
          }

          // Step failed, start compensation
          throw stepError;
        }
      }

      // All steps completed successfully
      await this.completeSaga(transaction, sagaState);
      return transaction;

    } catch (error) {
      // Execute compensation for completed steps
      await this.compensateSaga(transaction, steps, sagaState);
      throw error;
    }
  }

  /**
   * Compensate completed saga steps in reverse order
   */
  private async compensateSaga(
    transaction: Transaction,
    steps: SagaStep[],
    sagaState: SagaState
  ): Promise<void> {
    this.logger.error(`Starting saga compensation for transaction ${transaction.id}`);

    // Update transaction status
    await this.updateTransactionStatus(transaction, TransactionStatus.FAILED);
    await this.updateTransferState(transaction, TransferState.COMPENSATION_PENDING);

    // Compensate completed steps in reverse order
    const completedSteps = sagaState.completedSteps.reverse();
    
    for (const stepName of completedSteps) {
      const step = steps.find(s => s.name === stepName);
      if (!step) continue;

      try {
        this.logger.log(`Compensating step: ${stepName}`);
        await step.compensate();
        sagaState.compensatedSteps.push(stepName);
        
      } catch (compensationError) {
        this.logger.error(`Compensation failed for step ${stepName}:`, compensationError);
        // Continue with other compensations even if one fails
      }
    }

    // Update final state
    await this.updateTransferState(transaction, TransferState.COMPENSATED);
    await this.updateSagaState(transaction, sagaState);
    
    this.logger.log(`Saga compensation completed for transaction ${transaction.id}`);
  }

  /**
   * Complete saga execution
   */
  private async completeSaga(transaction: Transaction, sagaState: SagaState): Promise<void> {
    await this.updateTransactionStatus(transaction, TransactionStatus.COMPLETED);
    await this.updateTransferState(transaction, TransferState.COMPLETED);
    
    // Set completion timestamp
    transaction.completedAt = new Date();
    await this.transactionRepository.save(transaction);

    this.logger.log(`Saga completed successfully for transaction ${transaction.id}`);
  }

  /**
   * Update saga state in transaction
   */
  private async updateSagaState(transaction: Transaction, sagaState: SagaState): Promise<void> {
    transaction.sagaState = sagaState;
    transaction.retryCount = sagaState.retryCount;
    
    if (sagaState.lastError) {
      transaction.errorDetails = {
        message: sagaState.lastError.message,
        stack: sagaState.lastError.stack,
        step: sagaState.currentStep,
        timestamp: new Date().toISOString(),
      };
    }

    await this.transactionRepository.save(transaction);
  }

  /**
   * Update transaction status
   */
  private async updateTransactionStatus(
    transaction: Transaction,
    status: TransactionStatus
  ): Promise<void> {
    transaction.status = status;
    transaction.processedAt = new Date();
    
    if (status === TransactionStatus.FAILED) {
      transaction.failedAt = new Date();
    }

    await this.transactionRepository.save(transaction);
  }

  /**
   * Update transfer state
   */
  private async updateTransferState(
    transaction: Transaction,
    transferState: TransferState
  ): Promise<void> {
    transaction.transferState = transferState;
    await this.transactionRepository.save(transaction);
  }

  /**
   * Map saga step to transfer state
   */
  private getTransferStateForStep(stepIndex: number): TransferState {
    const stateMap = [
      TransferState.INITIATED,
      TransferState.VALIDATION_COMPLETE,
      TransferState.FUNDS_RESERVED,
      TransferState.DEBIT_COMPLETE,
      TransferState.CREDIT_COMPLETE,
    ];

    return stateMap[stepIndex] || TransferState.INITIATED;
  }

  /**
   * Create transfer saga steps
   */
  createTransferSagaSteps(context: SagaContext): SagaStep[] {
    return [
      {
        name: 'validate_transfer',
        retryable: true,
        maxRetries: 3,
        execute: async () => {
          await this.validateTransfer(context);
        },
        compensate: async () => {
          // No compensation needed for validation
        },
      },
      {
        name: 'reserve_funds',
        retryable: true,
        maxRetries: 2,
        execute: async () => {
          await this.reserveFunds(context);
        },
        compensate: async () => {
          await this.releaseReservedFunds(context);
        },
      },
      {
        name: 'debit_source_wallet',
        retryable: true,
        maxRetries: 2,
        execute: async () => {
          await this.debitSourceWallet(context);
        },
        compensate: async () => {
          await this.creditSourceWallet(context);
        },
      },
      {
        name: 'credit_destination_wallet',
        retryable: true,
        maxRetries: 2,
        execute: async () => {
          await this.creditDestinationWallet(context);
        },
        compensate: async () => {
          await this.debitDestinationWallet(context);
        },
      },
      {
        name: 'finalize_transfer',
        retryable: false,
        maxRetries: 0,
        execute: async () => {
          await this.finalizeTransfer(context);
        },
        compensate: async () => {
          // Finalization compensation handled by previous steps
        },
      },
    ];
  }

  /**
   * Saga step implementations
   */
  private async validateTransfer(context: SagaContext): Promise<void> {
    // Validate wallets exist and are active
    const [sourceWallet, destinationWallet] = await Promise.all([
      this.walletRepository.findOne({
        where: { id: context.sourceWalletId, isActive: true },
      }),
      this.walletRepository.findOne({
        where: { id: context.destinationWalletId, isActive: true },
      }),
    ]);

    if (!sourceWallet) {
      throw new Error('Source wallet not found or inactive');
    }

    if (!destinationWallet) {
      throw new Error('Destination wallet not found or inactive');
    }

    if (sourceWallet.currency !== destinationWallet.currency) {
      throw new Error('Currency mismatch between wallets');
    }

    // Additional validations can be added here
  }

  private async reserveFunds(context: SagaContext): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { id: context.transactionId },
    });

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Set reservation details
    transaction.reservedAmount = context.amount;
    transaction.reservationExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await this.transactionRepository.save(transaction);
    
    this.logger.debug(`Reserved ${context.amount} for transaction ${context.transactionId}`);
  }

  private async releaseReservedFunds(context: SagaContext): Promise<void> {
    const transaction = await this.transactionRepository.findOne({
      where: { id: context.transactionId },
    });

    if (transaction && transaction.reservedAmount) {
      transaction.reservedAmount = null;
      transaction.reservationExpiry = null;
      await this.transactionRepository.save(transaction);
      
      this.logger.debug(`Released reserved funds for transaction ${context.transactionId}`);
    }
  }

  private async debitSourceWallet(context: SagaContext): Promise<void> {
    const sourceWallet = await this.walletRepository.findOne({
      where: { id: context.sourceWalletId },
    });

    if (!sourceWallet) {
      throw new Error('Source wallet not found');
    }

    if (sourceWallet.balance < context.amount) {
      throw new Error('Insufficient balance');
    }

    // Store balance before for compensation
    context.metadata.sourceBalanceBefore = sourceWallet.balance;
    
    // Debit the wallet
    await this.walletRepository.update(
      { id: context.sourceWalletId },
      { balance: () => `balance - ${context.amount}` }
    );

    // Update cache
    const newBalance = sourceWallet.balance - context.amount;
    const cachedData = await this.cacheService.getWalletBalanceWithVersion(context.sourceWalletId);
    const newVersion = cachedData ? cachedData.version + 1 : 1;
    await this.cacheService.setWalletBalanceWithVersion(context.sourceWalletId, newBalance, newVersion);

    this.logger.debug(`Debited ${context.amount} from wallet ${context.sourceWalletId}`);
  }

  private async creditSourceWallet(context: SagaContext): Promise<void> {
    // Compensation: credit back the debited amount
    await this.walletRepository.update(
      { id: context.sourceWalletId },
      { balance: () => `balance + ${context.amount}` }
    );

    // Update cache
    const sourceWallet = await this.walletRepository.findOne({
      where: { id: context.sourceWalletId },
    });
    
    if (sourceWallet) {
      const cachedData = await this.cacheService.getWalletBalanceWithVersion(context.sourceWalletId);
      const newVersion = cachedData ? cachedData.version + 1 : 1;
      await this.cacheService.setWalletBalanceWithVersion(context.sourceWalletId, sourceWallet.balance, newVersion);
    }

    this.logger.debug(`Compensated: credited ${context.amount} back to wallet ${context.sourceWalletId}`);
  }

  private async creditDestinationWallet(context: SagaContext): Promise<void> {
    const destinationWallet = await this.walletRepository.findOne({
      where: { id: context.destinationWalletId },
    });

    if (!destinationWallet) {
      throw new Error('Destination wallet not found');
    }

    // Store balance before for compensation
    context.metadata.destinationBalanceBefore = destinationWallet.balance;

    // Credit the wallet
    await this.walletRepository.update(
      { id: context.destinationWalletId },
      { balance: () => `balance + ${context.amount}` }
    );

    // Update cache
    const newBalance = destinationWallet.balance + context.amount;
    const cachedData = await this.cacheService.getWalletBalanceWithVersion(context.destinationWalletId);
    const newVersion = cachedData ? cachedData.version + 1 : 1;
    await this.cacheService.setWalletBalanceWithVersion(context.destinationWalletId, newBalance, newVersion);

    this.logger.debug(`Credited ${context.amount} to wallet ${context.destinationWalletId}`);
  }

  private async debitDestinationWallet(context: SagaContext): Promise<void> {
    // Compensation: debit back the credited amount
    await this.walletRepository.update(
      { id: context.destinationWalletId },
      { balance: () => `balance - ${context.amount}` }
    );

    // Update cache
    const destinationWallet = await this.walletRepository.findOne({
      where: { id: context.destinationWalletId },
    });
    
    if (destinationWallet) {
      const cachedData = await this.cacheService.getWalletBalanceWithVersion(context.destinationWalletId);
      const newVersion = cachedData ? cachedData.version + 1 : 1;
      await this.cacheService.setWalletBalanceWithVersion(context.destinationWalletId, destinationWallet.balance, newVersion);
    }

    this.logger.debug(`Compensated: debited ${context.amount} from wallet ${context.destinationWalletId}`);
  }

  private async finalizeTransfer(context: SagaContext): Promise<void> {
    // Update transaction with final balance snapshots
    const [sourceWallet, destinationWallet] = await Promise.all([
      this.walletRepository.findOne({ where: { id: context.sourceWalletId } }),
      this.walletRepository.findOne({ where: { id: context.destinationWalletId } }),
    ]);

    const transaction = await this.transactionRepository.findOne({
      where: { id: context.transactionId },
    });

    if (transaction && sourceWallet && destinationWallet) {
      transaction.sourceBalanceAfter = sourceWallet.balance;
      transaction.destinationBalanceAfter = destinationWallet.balance;
      transaction.sourceBalanceBefore = context.metadata.sourceBalanceBefore;
      transaction.destinationBalanceBefore = context.metadata.destinationBalanceBefore;
      
      await this.transactionRepository.save(transaction);
    }

    this.logger.debug(`Finalized transfer for transaction ${context.transactionId}`);
  }
} 