# P2P Wallet Transfer System

A secure, scalable peer-to-peer wallet transfer system built with NestJS, PostgreSQL, and Redis. This system provides secure user authentication, wallet management, and P2P transfers with configurable daily and monthly limits.

## 🚀 Features

- **Secure Authentication**: JWT-based authentication with bcrypt password hashing
- **Wallet Management**: Create and manage multiple wallets per user
- **P2P Transfers**: Secure peer-to-peer money transfers between wallets
- **Transfer Limits**: Configurable daily and monthly transfer limits
- **Caching**: Redis-based caching for improved performance
- **Transaction History**: Detailed transaction history with filtering
- **Audit Logging**: Comprehensive audit trail for all operations
- **Containerized**: Full Docker support with docker-compose
- **API Documentation**: Interactive Swagger/OpenAPI documentation

## 🏗️ Architecture

### High Level Design (HLD)
- **Client Layer**: Web, Mobile, and API clients
- **API Gateway**: NGINX load balancer with rate limiting
- **Application Layer**: NestJS microservices (Auth, Wallet, Transfer)
- **Security Layer**: JWT authentication and input validation
- **Business Logic**: Transfer limits, balance validation, transaction handling
- **Data Layer**: PostgreSQL database with Redis caching
- **Infrastructure**: Docker containers with health checks

### Low Level Design (LLD)
- **Database Schema**: Users, Wallets, Transactions, Transfer Limits
- **Caching Strategy**: Wallet balances and transfer limits cached in Redis
- **Transaction Flow**: Atomic database transactions with rollback support
- **Security**: Bearer token authentication with role-based access

## 🛠️ Technology Stack

- **Backend**: NestJS (Node.js/TypeScript)
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **Authentication**: JWT with bcrypt
- **ORM**: TypeORM
- **Validation**: class-validator
- **Documentation**: Swagger/OpenAPI
- **Containerization**: Docker & Docker Compose
- **Testing**: Jest

## 📋 Prerequisites

- Docker Engine 20.10+
- Docker Compose 3.8+
- Node.js 18+ (for local development)
- npm 8+ (for local development)

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd p2p-wallet-system
```

### 2. Environment Setup

Create a `.env` file in the root directory:

```env
# Application Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=password
DB_DATABASE=p2p_wallet

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRES_IN=7d

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Transfer Limits Configuration
DEFAULT_DAILY_LIMIT=10000
DEFAULT_MONTHLY_LIMIT=100000
```

### 3. Production Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### 4. Development Setup

```bash
# Start development services
docker-compose -f docker-compose.dev.yml up -d

# Install dependencies locally
npm install

# Run in development mode
npm run start:dev
```

## 📖 API Documentation

Once the application is running, access the interactive API documentation:

- **Swagger UI**: `http://localhost:3000/api`
- **Health Check**: `http://localhost:3000/health`

## 🧪 API Testing

### Postman Collection

A comprehensive Postman collection is included for testing all APIs:

1. **Import Collection**: `postman/P2P-Wallet-API.postman_collection.json`
2. **Import Environment**: `postman/P2P-Wallet.postman_environment.json`
3. **Follow the testing workflow** described in `postman/README.md`

The collection includes:
- ✅ All API endpoints with example requests
- ✅ Automatic authentication and token management
- ✅ Environment variables for seamless testing
- ✅ Pre-built test scripts for response validation
- ✅ Error scenario testing
- ✅ Complete testing workflow documentation

### Quick API Test Script

Run the automated test script to verify the complete API flow:

```bash
# Make sure the application is running first
docker-compose up -d

# Run the automated test
./test-api.sh
```

This script will:
1. Create a new user account
2. Create and fund a wallet
3. Perform a P2P transfer
4. Verify balances and transaction history
5. Check transfer limits

## 🔐 Authentication

### 1. Sign Up

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

### 2. Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123"
  }'
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenType": "bearer",
  "expiresIn": 604800,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

## 💼 Wallet Operations

### 1. Create Wallet

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Primary Wallet",
    "currency": "USD"
  }'
```

### 2. Add Funds

```bash
curl -X POST http://localhost:3000/wallets/{wallet_id}/add-funds \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100.00,
    "description": "Initial deposit"
  }'
```

### 3. Get Wallet Balance

```bash
curl -X GET http://localhost:3000/wallets/{wallet_id}/balance \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 💸 Transfer Operations

### 1. Transfer Funds

```bash
curl -X POST http://localhost:3000/wallets/{wallet_id}/transfer \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationWalletId": "destination-wallet-uuid",
    "amount": 50.00,
    "description": "Payment for dinner"
  }'
```

### 2. Get Transaction History

```bash
curl -X GET "http://localhost:3000/wallets/{wallet_id}/transactions?page=1&limit=10&type=TRANSFER" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Check Transfer Limits

```bash
curl -X GET http://localhost:3000/wallets/{wallet_id}/transfer-limits \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 📊 Database Schema

### Users Table
- `id`: UUID primary key
- `email`: Unique email address
- `password`: Hashed password
- `firstName`: User's first name
- `lastName`: User's last name
- `phoneNumber`: Optional phone number
- `isActive`: Account status
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp

### Wallets Table
- `id`: UUID primary key
- `userId`: Foreign key to Users
- `balance`: Current wallet balance
- `currency`: Currency type (USD, EUR, GBP)
- `name`: Wallet name
- `isActive`: Wallet status
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp

### Transactions Table
- `id`: UUID primary key
- `sourceWalletId`: Source wallet UUID
- `destinationWalletId`: Destination wallet UUID
- `amount`: Transaction amount
- `type`: Transaction type (DEPOSIT, WITHDRAWAL, TRANSFER)
- `status`: Transaction status (PENDING, COMPLETED, FAILED, CANCELLED)
- `description`: Transaction description
- `metadata`: Additional transaction data (JSON)
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp

### Transfer Limits Table
- `id`: UUID primary key
- `userId`: Foreign key to Users
- `dailyLimit`: Daily transfer limit
- `monthlyLimit`: Monthly transfer limit
- `dailyUsed`: Used daily amount
- `monthlyUsed`: Used monthly amount
- `lastDailyReset`: Last daily reset date
- `lastMonthlyReset`: Last monthly reset date
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Application port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_USERNAME` | Database username | `postgres` |
| `DB_PASSWORD` | Database password | `password` |
| `DB_DATABASE` | Database name | `p2p_wallet` |
| `JWT_SECRET` | JWT secret key | Required |
| `JWT_EXPIRES_IN` | JWT expiration | `7d` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `DEFAULT_DAILY_LIMIT` | Default daily limit | `10000` |
| `DEFAULT_MONTHLY_LIMIT` | Default monthly limit | `100000` |

### Transfer Limits

- **Daily Limit**: Configurable per user (default: $10,000)
- **Monthly Limit**: Configurable per user (default: $100,000)
- **Auto Reset**: Limits reset automatically at midnight (daily) and month start (monthly)
- **Validation**: All transfers validate against current usage

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:cov

# Run tests in watch mode
npm run test:watch
```

### Integration Tests

```bash
# Run end-to-end tests
npm run test:e2e
```

### Manual Testing

Use the provided Postman collection or curl commands to test the API endpoints.

## 📈 Performance & Scalability

### Caching Strategy
- **Wallet Balances**: Cached for 5 minutes
- **Transfer Limits**: Cached until reset
- **Cache Invalidation**: Automatic on balance changes

### Database Optimizations
- **Indexes**: Strategic indexes on frequently queried columns
- **Transactions**: Atomic database transactions for consistency
- **Connection Pooling**: Efficient database connection management

### Scalability Features
- **Horizontal Scaling**: Multiple app instances behind load balancer
- **Database Replicas**: Read replicas for improved performance
- **Message Queues**: Async processing for notifications

## 🔒 Security Features

### Authentication & Authorization
- **JWT Tokens**: Secure token-based authentication
- **Password Hashing**: bcrypt with salt rounds
- **Route Guards**: Protected endpoints with auth guards
- **Input Validation**: Comprehensive input sanitization

### Security Best Practices
- **HTTPS**: SSL/TLS encryption in production
- **Rate Limiting**: API rate limiting to prevent abuse
- **CORS**: Cross-origin resource sharing configuration
- **Environment Variables**: Sensitive data in environment variables

## 📝 Logging & Monitoring

### Application Logs
- **Structured Logging**: JSON-formatted logs
- **Log Levels**: Error, warn, info, debug
- **Audit Trail**: Complete audit trail for all operations

### Health Checks
- **Database Health**: PostgreSQL connection status
- **Cache Health**: Redis connection status
- **Application Health**: Service availability

### Monitoring
- **Metrics**: Custom metrics for business operations
- **Alerts**: Configurable alerts for critical issues
- **Dashboards**: Real-time monitoring dashboards

## 🐳 Docker Commands

### Production Commands

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down

# Remove volumes (⚠️ This will delete all data)
docker-compose down -v
```

### Development Commands

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up -d

# View development logs
docker-compose -f docker-compose.dev.yml logs -f

# Stop development environment
docker-compose -f docker-compose.dev.yml down
```

### Database Commands

```bash
# Connect to PostgreSQL
docker exec -it p2p-wallet-postgres psql -U postgres -d p2p_wallet

# Connect to Redis
docker exec -it p2p-wallet-redis redis-cli
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support, please contact the development team or create an issue in the repository.

## 🔄 Version History

- **v1.0.0**: Initial release with core P2P transfer functionality
- **v1.1.0**: Added caching and performance optimizations
- **v1.2.0**: Enhanced security and audit logging

## 📁 Project Structure

```
p2p-wallet-system/
├── src/                          # Source code
│   ├── auth/                     # Authentication module
│   ├── wallet/                   # Wallet management module
│   ├── transfer/                 # P2P transfer module
│   ├── database/                 # Database entities and modules
│   └── cache/                    # Redis caching module
├── postman/                      # Postman collection for API testing
│   ├── P2P-Wallet-API.postman_collection.json
│   ├── P2P-Wallet.postman_environment.json
│   └── README.md
├── docker-compose.yml            # Production Docker setup
├── docker-compose.dev.yml       # Development Docker setup
├── Dockerfile                    # Production Docker image
├── Dockerfile.dev               # Development Docker image
├── test-api.sh                  # Automated API test script
├── README.md                    # Main documentation
├── DESIGN_DIAGRAMS.md           # Design diagrams information
└── .env                         # Environment variables
```

## 📚 Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/documentation)
- [Docker Documentation](https://docs.docker.com/)
- [JWT.io](https://jwt.io/)
- [Postman Documentation](https://learning.postman.com/)

---

**Built with ❤️ by the Frex Team** 