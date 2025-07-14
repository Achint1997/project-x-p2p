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

### 2. Environment Setup (In production setup with Kubernetes to be picked up from S3 and replaced in the configMap of in Kubernetes)

Create a `.env` file in the root directory:

```env
# Application Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
DB_HOST=database-1.cpusscsgoa7c.ap-south-1.rds.amazonaws.com
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

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
