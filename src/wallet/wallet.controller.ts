import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { AddFundsDto } from './dto/add-funds.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';

@ApiTags('Wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new wallet' })
  @ApiResponse({ status: 201, description: 'Wallet created successfully', type: WalletResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createWallet(@Request() req, @Body() createWalletDto: CreateWalletDto): Promise<WalletResponseDto> {
    return this.walletService.createWallet(req.user, createWalletDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all user wallets' })
  @ApiResponse({ status: 200, description: 'Wallets retrieved successfully', type: [WalletResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserWallets(@Request() req): Promise<WalletResponseDto[]> {
    return this.walletService.getUserWallets(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get wallet by ID' })
  @ApiResponse({ status: 200, description: 'Wallet retrieved successfully', type: WalletResponseDto })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getWalletById(@Param('id') walletId: string, @Request() req): Promise<WalletResponseDto> {
    return this.walletService.getWalletById(walletId, req.user.id);
  }

  @Post(':id/add-funds')
  @ApiOperation({ summary: 'Add funds to a wallet' })
  @ApiResponse({ status: 200, description: 'Funds added successfully', type: WalletResponseDto })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 400, description: 'Invalid amount' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async addFunds(
    @Param('id') walletId: string,
    @Request() req,
    @Body() addFundsDto: AddFundsDto,
  ): Promise<WalletResponseDto> {
    return this.walletService.addFunds(walletId, req.user.id, addFundsDto);
  }

  @Get(':id/balance')
  @ApiOperation({ summary: 'Get wallet balance' })
  @ApiResponse({ status: 200, description: 'Balance retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getWalletBalance(@Param('id') walletId: string, @Request() req): Promise<{ balance: number }> {
    const balance = await this.walletService.getWalletBalance(walletId, req.user.id);
    return { balance };
  }

  @Get(':id/cache-health')
  @ApiOperation({ summary: 'Check wallet cache consistency' })
  @ApiResponse({ status: 200, description: 'Cache health check completed' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async checkCacheHealth(@Param('id') walletId: string, @Request() req): Promise<{
    dbBalance: number;
    cacheBalance: number | null;
    consistent: boolean;
    version: number | null;
    status: 'healthy' | 'inconsistent' | 'cache_miss';
  }> {
    const result = await this.walletService.checkWalletCacheConsistency(walletId, req.user.id);
    
    let status: 'healthy' | 'inconsistent' | 'cache_miss';
    if (result.cacheBalance === null) {
      status = 'cache_miss';
    } else if (result.consistent) {
      status = 'healthy';
    } else {
      status = 'inconsistent';
    }

    return {
      ...result,
      status,
    };
  }
} 