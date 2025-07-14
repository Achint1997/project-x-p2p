import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('transfer_limits')
export class TransferLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  dailyLimit: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  monthlyLimit: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  dailyUsed: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  monthlyUsed: number;

  @Column({ type: 'date' })
  lastDailyReset: Date;

  @Column({ type: 'date' })
  lastMonthlyReset: Date;

  @Column({ type: 'uuid' })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => User, user => user.transferLimit)
  @JoinColumn({ name: 'userId' })
  user: User;
} 