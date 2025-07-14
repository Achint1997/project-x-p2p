import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Wallet } from '../database/entities/wallet.entity';
import { Transaction, TransactionType, TransactionStatus } from '../database/entities/transaction.entity';
import { User } from '../database/entities/user.entity';
import { CacheService, WalletBalanceWithVersion } from '../cache/cache.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { AddFundsDto } from './dto/add-funds.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    private cacheService: CacheService,
    private dataSource: DataSource,
  ) {}

  async createWallet(user: User, createWalletDto: CreateWalletDto): Promise<WalletResponseDto> {
    const { name, currency = 'USD' } = createWalletDto;

    const wallet = this.walletRepository.create({
      userId: user.id,
      name: name || `${user.firstName}'s Wallet`,
      currency,
      balance: 0,
    });

    const savedWallet = await this.walletRepository.save(wallet);

    // Cache the initial balance with version
    await this.cacheService.setWalletBalanceWithVersion(savedWallet.id, 0, 1);

    return this.mapToResponseDto(savedWallet);
  }

  async getUserWallets(userId: string): Promise<WalletResponseDto[]> {
    const wallets = await this.walletRepository.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });

    return wallets.map(wallet => this.mapToResponseDto(wallet));
  }

  async getWalletById(walletId: string, userId: string): Promise<WalletResponseDto> {
    const wallet = await this.walletRepository.findOne({
      where: { id: walletId, userId, isActive: true },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return this.mapToResponseDto(wallet);
  }

  /**
   * Add funds to wallet with distributed lock and transactional consistency
   */
  async addFunds(walletId: string, userId: string, addFundsDto: AddFundsDto): Promise<WalletResponseDto> {
    const { amount, description } = addFundsDto;

    if (amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    return await this.cacheService.withWalletLock(walletId, async () => {
      const wallet = await this.walletRepository.findOne({
        where: { id: walletId, userId, isActive: true },
      });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Get current cached balance with version for consistency
        const cachedData = await this.cacheService.getWalletBalanceWithVersion(walletId);
        const currentVersion = cachedData ? cachedData.version : 0;
        const newVersion = currentVersion + 1;

        // Update wallet balance in database
        await queryRunner.manager.update(Wallet, walletId, {
          balance: () => `balance + ${amount}`,
        });

        // Create transaction record
        const transaction = this.transactionRepository.create({
          amount,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
          description: description || 'Funds added to wallet',
          destinationWalletId: walletId,
        });

        await queryRunner.manager.save(transaction);

        // Get updated wallet from database
        const updatedWallet = await queryRunner.manager.findOne(Wallet, {
          where: { id: walletId },
        });

        if (!updatedWallet) {
          throw new Error('Failed to retrieve updated wallet');
        }

        // Commit database transaction first
        await queryRunner.commitTransaction();

        // Update cache with new version atomically
        await this.cacheService.setWalletBalanceWithVersion(
          walletId,
          updatedWallet.balance,
          newVersion
        );

        this.logger.log(`Added funds: wallet=${walletId}, amount=${amount}, newBalance=${updatedWallet.balance}, version=${newVersion}`);

        return this.mapToResponseDto(updatedWallet);
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Failed to add funds to wallet ${walletId}:`, error);
        throw error;
      } finally {
        await queryRunner.release();
      }
    });
  }

  /**
   * Get wallet balance with cache consistency checks
   */
  async getWalletBalance(walletId: string, userId: string): Promise<number> {
    // First try to get from cache with version
    const cachedData = await this.cacheService.getWalletBalanceWithVersion(walletId);
    
    if (cachedData) {
      // Check if cache is recent (within 1 minute for high-frequency reads)
      const cacheAge = Date.now() - cachedData.lastUpdated.getTime();
      if (cacheAge < 60000) { // 1 minute
        this.logger.debug(`Cache hit for wallet ${walletId}, balance=${cachedData.balance}, version=${cachedData.version}`);
        return cachedData.balance;
      }
    }

    // Cache miss or stale - get from database with lock to ensure consistency
    return await this.cacheService.withWalletLock(walletId, async () => {
      // Double-check cache after acquiring lock
      const reCheckCachedData = await this.cacheService.getWalletBalanceWithVersion(walletId);
      if (reCheckCachedData) {
        const recheckAge = Date.now() - reCheckCachedData.lastUpdated.getTime();
        if (recheckAge < 60000) {
          return reCheckCachedData.balance;
        }
      }

      // Get from database
      const wallet = await this.walletRepository.findOne({
        where: { id: walletId, userId, isActive: true },
      });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      // Update cache with fresh data
      const newVersion = reCheckCachedData ? reCheckCachedData.version + 1 : 1;
      await this.cacheService.setWalletBalanceWithVersion(walletId, wallet.balance, newVersion);

      this.logger.debug(`Database read for wallet ${walletId}, balance=${wallet.balance}, version=${newVersion}`);
      return wallet.balance;
    }, 5000); // Shorter timeout for read operations
  }

  /**
   * Update wallet balance atomically (used by transfer service)
   */
  async updateWalletBalanceAtomic(
    walletId: string,
    newBalance: number,
    queryRunner?: any
  ): Promise<void> {
    const manager = queryRunner ? queryRunner.manager : this.dataSource.manager;
    
    // Update database
    await manager.update(Wallet, walletId, { balance: newBalance });
    
    // Get current cache version
    const cachedData = await this.cacheService.getWalletBalanceWithVersion(walletId);
    const newVersion = cachedData ? cachedData.version + 1 : 1;
    
    // Update cache with new version
    await this.cacheService.setWalletBalanceWithVersion(walletId, newBalance, newVersion);
    
    this.logger.debug(`Updated wallet balance atomically: wallet=${walletId}, balance=${newBalance}, version=${newVersion}`);
  }

  /**
   * Batch update multiple wallet balances (for transfers)
   */
  async updateWalletBalancesBatch(
    updates: Array<{ walletId: string; newBalance: number }>,
    queryRunner?: any
  ): Promise<void> {
    const manager = queryRunner ? queryRunner.manager : this.dataSource.manager;
    
    // Update all wallets in database
    for (const { walletId, newBalance } of updates) {
      await manager.update(Wallet, walletId, { balance: newBalance });
    }
    
    // Update cache for all wallets
    const cacheUpdates = await Promise.all(
      updates.map(async ({ walletId, newBalance }) => {
        const cachedData = await this.cacheService.getWalletBalanceWithVersion(walletId);
        const newVersion = cachedData ? cachedData.version + 1 : 1;
        return { walletId, newBalance, newVersion };
      })
    );
    
    // Batch update cache
    await Promise.all(
      cacheUpdates.map(({ walletId, newBalance, newVersion }) =>
        this.cacheService.setWalletBalanceWithVersion(walletId, newBalance, newVersion)
      )
    );
    
    this.logger.debug(`Updated ${updates.length} wallet balances in batch`);
  }

  // Legacy method for backward compatibility
  async updateWalletBalance(walletId: string, newBalance: number): Promise<void> {
    await this.updateWalletBalanceAtomic(walletId, newBalance);
  }

  async invalidateWalletCache(walletId: string): Promise<void> {
    await this.cacheService.invalidateWalletBalance(walletId);
  }

  /**
   * Health check for wallet cache consistency
   */
  async checkWalletCacheConsistency(walletId: string, userId: string): Promise<{
    dbBalance: number;
    cacheBalance: number | null;
    consistent: boolean;
    version: number | null;
  }> {
    const [wallet, cachedData] = await Promise.all([
      this.walletRepository.findOne({
        where: { id: walletId, userId, isActive: true },
      }),
      this.cacheService.getWalletBalanceWithVersion(walletId),
    ]);

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const dbBalance = wallet.balance;
    const cacheBalance = cachedData?.balance || null;
    const consistent = cacheBalance !== null && Math.abs(dbBalance - cacheBalance) < 0.01;

    return {
      dbBalance,
      cacheBalance,
      consistent,
      version: cachedData?.version || null,
    };
  }

  private mapToResponseDto(wallet: Wallet): WalletResponseDto {
    return {
      id: wallet.id,
      balance: wallet.balance,
      currency: wallet.currency,
      name: wallet.name,
      isActive: wallet.isActive,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
} 