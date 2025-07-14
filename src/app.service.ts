import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'P2P Wallet Transfer System API is running!';
  }
} 