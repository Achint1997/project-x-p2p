import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export interface WalletBalanceWithVersion {
  balance: number;
  version: number;
  lastUpdated: Date;
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: RedisClientType;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.client = createClient({
      socket: {
        host: this.configService.get('REDIS_HOST', 'localhost'),
        port: this.configService.get('REDIS_PORT', 6379),
      },
      password: this.configService.get('REDIS_PASSWORD', ''),
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    await this.client.connect();
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.disconnect();
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.setEx(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Acquires a distributed lock for wallet operations
   */
  async acquireWalletLock(walletId: string, timeoutMs: number = 30000): Promise<string | null> {
    const lockKey = `wallet_lock:${walletId}`;
    const lockValue = `${Date.now()}_${Math.random()}`;
    const lockTtlSeconds = Math.ceil(timeoutMs / 1000);

    try {
      // Use SET with NX (only if not exists) and EX (expire time)
      const result = await this.client.set(lockKey, lockValue, {
        NX: true,
        EX: lockTtlSeconds,
      });

      if (result === 'OK') {
        this.logger.debug(`Acquired lock for wallet ${walletId}`);
        return lockValue;
      }
      
      this.logger.warn(`Failed to acquire lock for wallet ${walletId} - already locked`);
      return null;
    } catch (error) {
      this.logger.error(`Error acquiring lock for wallet ${walletId}:`, error);
      return null;
    }
  }

  /**
   * Releases a distributed lock for wallet operations
   */
  async releaseWalletLock(walletId: string, lockValue: string): Promise<boolean> {
    const lockKey = `wallet_lock:${walletId}`;
    
    // Lua script to ensure we only delete our own lock
    const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.client.eval(luaScript, {
        keys: [lockKey],
        arguments: [lockValue],
      }) as number;

      const success = result === 1;
      if (success) {
        this.logger.debug(`Released lock for wallet ${walletId}`);
      } else {
        this.logger.warn(`Failed to release lock for wallet ${walletId} - lock not owned`);
      }
      
      return success;
    } catch (error) {
      this.logger.error(`Error releasing lock for wallet ${walletId}:`, error);
      return false;
    }
  }

  /**
   * Executes a function with a distributed lock
   */
  async withWalletLock<T>(
    walletId: string,
    operation: () => Promise<T>,
    timeoutMs: number = 30000
  ): Promise<T> {
    const lockValue = await this.acquireWalletLock(walletId, timeoutMs);
    
    if (!lockValue) {
      throw new Error(`Unable to acquire lock for wallet ${walletId} within ${timeoutMs}ms`);
    }

    try {
      return await operation();
    } finally {
      await this.releaseWalletLock(walletId, lockValue);
    }
  }

  /**
   * Gets wallet balance with version for consistency checking
   */
  async getWalletBalanceWithVersion(walletId: string): Promise<WalletBalanceWithVersion | null> {
    const data = await this.get(`wallet_balance_v2:${walletId}`);
    if (!data) return null;

    try {
      const parsed = JSON.parse(data);
      return {
        balance: parseFloat(parsed.balance),
        version: parseInt(parsed.version),
        lastUpdated: new Date(parsed.lastUpdated),
      };
    } catch (error) {
      this.logger.error(`Error parsing wallet balance data for ${walletId}:`, error);
      return null;
    }
  }

  /**
   * Sets wallet balance with version using atomic operation
   */
  async setWalletBalanceWithVersion(
    walletId: string,
    balance: number,
    version: number,
    ttl: number = 300
  ): Promise<void> {
    const data = JSON.stringify({
      balance: balance.toString(),
      version: version.toString(),
      lastUpdated: new Date().toISOString(),
    });

    await this.set(`wallet_balance_v2:${walletId}`, data, ttl);
  }

  /**
   * Atomically updates wallet balance if version matches (optimistic locking)
   */
  async updateWalletBalanceIfVersionMatches(
    walletId: string,
    newBalance: number,
    expectedVersion: number,
    newVersion: number,
    ttl: number = 300
  ): Promise<boolean> {
    const cacheKey = `wallet_balance_v2:${walletId}`;
    
    // Lua script for atomic compare-and-swap operation
    const luaScript = `
      local current = redis.call("GET", KEYS[1])
      if current == false then
        -- No cached value, proceed with set
        local data = cjson.encode({
          balance = ARGV[1],
          version = ARGV[3],
          lastUpdated = ARGV[4]
        })
        redis.call("SETEX", KEYS[1], ARGV[5], data)
        return 1
      end
      
      local currentData = cjson.decode(current)
      if tonumber(currentData.version) == tonumber(ARGV[2]) then
        -- Version matches, update
        local data = cjson.encode({
          balance = ARGV[1],
          version = ARGV[3],
          lastUpdated = ARGV[4]
        })
        redis.call("SETEX", KEYS[1], ARGV[5], data)
        return 1
      else
        -- Version mismatch
        return 0
      end
    `;

    try {
      const result = await this.client.eval(luaScript, {
        keys: [cacheKey],
        arguments: [
          newBalance.toString(),
          expectedVersion.toString(),
          newVersion.toString(),
          new Date().toISOString(),
          ttl.toString(),
        ],
      }) as number;

      return result === 1;
    } catch (error) {
      this.logger.error(`Error updating wallet balance for ${walletId}:`, error);
      return false;
    }
  }

  // Legacy methods for backward compatibility
  async getWalletBalance(walletId: string): Promise<number | null> {
    const data = await this.getWalletBalanceWithVersion(walletId);
    return data ? data.balance : null;
  }

  async setWalletBalance(walletId: string, balance: number): Promise<void> {
    await this.setWalletBalanceWithVersion(walletId, balance, 1, 300);
  }

  async invalidateWalletBalance(walletId: string): Promise<void> {
    await Promise.all([
      this.del(`wallet_balance:${walletId}`),
      this.del(`wallet_balance_v2:${walletId}`),
    ]);
  }

  /**
   * Batch invalidate multiple wallet balances atomically
   */
  async invalidateWalletBalances(walletIds: string[]): Promise<void> {
    if (walletIds.length === 0) return;

    const keys = walletIds.flatMap(id => [
      `wallet_balance:${id}`,
      `wallet_balance_v2:${id}`,
    ]);

    await this.client.del(keys);
  }

  async getTransferLimitUsage(userId: string, period: 'daily' | 'monthly'): Promise<number | null> {
    const usage = await this.get(`transfer_limit:${userId}:${period}`);
    return usage ? parseFloat(usage) : null;
  }

  async setTransferLimitUsage(userId: string, period: 'daily' | 'monthly', usage: number): Promise<void> {
    const ttl = period === 'daily' ? 86400 : 2592000; // 1 day or 30 days
    await this.set(`transfer_limit:${userId}:${period}`, usage.toString(), ttl);
  }

  async invalidateTransferLimitUsage(userId: string): Promise<void> {
    await this.del(`transfer_limit:${userId}:daily`);
    await this.del(`transfer_limit:${userId}:monthly`);
  }
} 