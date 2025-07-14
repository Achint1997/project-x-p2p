import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Wallet } from './wallet.entity';

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TRANSFER = 'TRANSFER',
  REFUND = 'REFUND',
  COMPENSATION = 'COMPENSATION',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  COMPENSATED = 'COMPENSATED',
}

export enum TransferState {
  INITIATED = 'INITIATED',
  FUNDS_RESERVED = 'FUNDS_RESERVED',
  VALIDATION_COMPLETE = 'VALIDATION_COMPLETE',
  DEBIT_COMPLETE = 'DEBIT_COMPLETE',
  CREDIT_COMPLETE = 'CREDIT_COMPLETE',
  COMPLETED = 'COMPLETED',
  COMPENSATION_PENDING = 'COMPENSATION_PENDING',
  COMPENSATED = 'COMPENSATED',
  FAILED = 'FAILED',
}

@Entity('transactions')
@Index(['sourceWalletId'])
@Index(['destinationWalletId'])
@Index(['createdAt'])
@Index(['idempotencyKey'])
@Index(['externalReferenceId'])
@Unique(['idempotencyKey'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  @Column({ type: 'enum', enum: TransferState, nullable: true })
  transferState: TransferState;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'uuid', nullable: true })
  sourceWalletId: string;

  @Column({ type: 'uuid', nullable: true })
  destinationWalletId: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  // Idempotency and distributed transaction fields
  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  externalReferenceId: string;

  @Column({ type: 'uuid', nullable: true })
  parentTransactionId: string;

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  failedAt: Date;

  @Column({ type: 'json', nullable: true })
  errorDetails: Record<string, any>;

  // Saga and compensation fields
  @Column({ type: 'json', nullable: true })
  sagaState: Record<string, any>;

  @Column({ type: 'json', nullable: true })
  compensationActions: Array<{
    action: string;
    params: Record<string, any>;
    executedAt?: Date;
    status: 'pending' | 'executed' | 'failed';
  }>;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  reservedAmount: number;

  @Column({ type: 'timestamp', nullable: true })
  reservationExpiry: Date;

  // Balance snapshots for consistency verification
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  sourceBalanceBefore: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  sourceBalanceAfter: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  destinationBalanceBefore: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  destinationBalanceAfter: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Wallet, wallet => wallet.outgoingTransactions)
  @JoinColumn({ name: 'sourceWalletId' })
  sourceWallet: Wallet;

  @ManyToOne(() => Wallet, wallet => wallet.incomingTransactions)
  @JoinColumn({ name: 'destinationWalletId' })
  destinationWallet: Wallet;

  @ManyToOne(() => Transaction, { nullable: true })
  @JoinColumn({ name: 'parentTransactionId' })
  parentTransaction: Transaction;

  // Helper methods
  isInProgress(): boolean {
    return [
      TransactionStatus.PENDING,
      TransactionStatus.PROCESSING,
    ].includes(this.status);
  }

  isCompleted(): boolean {
    return this.status === TransactionStatus.COMPLETED;
  }

  isFailed(): boolean {
    return [
      TransactionStatus.FAILED,
      TransactionStatus.CANCELLED,
    ].includes(this.status);
  }

  canBeCompensated(): boolean {
    return this.status === TransactionStatus.COMPLETED && 
           this.transferState === TransferState.COMPLETED;
  }

  hasExpiredReservation(): boolean {
    return this.reservationExpiry && new Date() > this.reservationExpiry;
  }
} 