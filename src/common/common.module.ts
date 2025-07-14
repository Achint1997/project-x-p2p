import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyService } from './services/idempotency.service';
import { SagaService } from './services/saga.service';
import { Transaction } from '../database/entities/transaction.entity';
import { Wallet } from '../database/entities/wallet.entity';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, Wallet]),
    CacheModule,
  ],
  providers: [
    IdempotencyService,
    SagaService,
  ],
  exports: [
    IdempotencyService,
    SagaService,
  ],
})
export class CommonModule {} 