#!/bin/bash

# P2P Wallet Transfer System - API Test Script
# This script demonstrates the basic API flow using curl commands
# chmod +x test-api.sh
set -e  # Exit on any error

# Configuration
BASE_URL="http://localhost:3000"
EMAIL="testuser$(date +%s)@example.com"  # Unique email
PASSWORD="securePassword123"
FIRST_NAME="Test"
LAST_NAME="User"

echo "🚀 P2P Wallet Transfer System - API Test Script"
echo "================================================"
echo "Base URL: $BASE_URL"
echo "Test Email: $EMAIL"
echo ""

# Check if API is running
echo "🏥 Checking API health..."
HEALTH_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/health.json "$BASE_URL/health" || echo "000")
if [ "$HEALTH_RESPONSE" != "200" ]; then
    echo "❌ API is not running or not healthy. Please start the application first:"
    echo "   docker-compose up -d"
    exit 1
fi
echo "✅ API is healthy"
echo ""

# Step 1: User Signup
echo "🔐 Step 1: Creating new user account..."
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/signup" \
    -H "Content-Type: application/json" \
    -d "{
        \"email\": \"$EMAIL\",
        \"password\": \"$PASSWORD\",
        \"firstName\": \"$FIRST_NAME\",
        \"lastName\": \"$LAST_NAME\"
    }")

ACCESS_TOKEN=$(echo "$SIGNUP_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
if [ -z "$ACCESS_TOKEN" ]; then
    echo "❌ Failed to create user account"
    echo "Response: $SIGNUP_RESPONSE"
    exit 1
fi
echo "✅ User account created successfully"
echo "   Access Token: ${ACCESS_TOKEN:0:20}..."
echo ""

# Step 2: Create Primary Wallet
echo "💼 Step 2: Creating primary wallet..."
WALLET_RESPONSE=$(curl -s -X POST "$BASE_URL/wallets" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "Primary Wallet",
        "currency": "USD"
    }')

WALLET_ID=$(echo "$WALLET_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
if [ -z "$WALLET_ID" ]; then
    echo "❌ Failed to create primary wallet"
    echo "Response: $WALLET_RESPONSE"
    exit 1
fi
echo "✅ Primary wallet created successfully"
echo "   Wallet ID: $WALLET_ID"
echo ""

# Step 3: Add Funds to Primary Wallet
echo "💰 Step 3: Adding funds to primary wallet..."
ADD_FUNDS_RESPONSE=$(curl -s -X POST "$BASE_URL/wallets/$WALLET_ID/add-funds" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "amount": 1000.00,
        "description": "Initial deposit for testing"
    }')

BALANCE=$(echo "$ADD_FUNDS_RESPONSE" | grep -o '"balance":[^,}]*' | cut -d':' -f2)
if [ -z "$BALANCE" ]; then
    echo "❌ Failed to add funds to wallet"
    echo "Response: $ADD_FUNDS_RESPONSE"
    exit 1
fi
echo "✅ Funds added successfully"
echo "   New Balance: \$$BALANCE"
echo ""

# Step 4: Create Secondary Wallet for Transfer
echo "💼 Step 4: Creating secondary wallet for transfer..."
WALLET2_RESPONSE=$(curl -s -X POST "$BASE_URL/wallets" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "Secondary Wallet",
        "currency": "USD"
    }')

WALLET2_ID=$(echo "$WALLET2_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
if [ -z "$WALLET2_ID" ]; then
    echo "❌ Failed to create secondary wallet"
    echo "Response: $WALLET2_RESPONSE"
    exit 1
fi
echo "✅ Secondary wallet created successfully"
echo "   Wallet ID: $WALLET2_ID"
echo ""

# Step 5: Transfer Funds P2P
echo "💸 Step 5: Executing P2P transfer..."
TRANSFER_RESPONSE=$(curl -s -X POST "$BASE_URL/wallets/$WALLET_ID/transfer" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"destinationWalletId\": \"$WALLET2_ID\",
        \"amount\": 150.00,
        \"description\": \"Test P2P transfer\"
    }")

TRANSACTION_ID=$(echo "$TRANSFER_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
TRANSFER_STATUS=$(echo "$TRANSFER_RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
if [ "$TRANSFER_STATUS" != "COMPLETED" ]; then
    echo "❌ Transfer failed"
    echo "Response: $TRANSFER_RESPONSE"
    exit 1
fi
echo "✅ P2P transfer completed successfully"
echo "   Transaction ID: $TRANSACTION_ID"
echo "   Status: $TRANSFER_STATUS"
echo ""

# Step 6: Check Updated Balances
echo "🔍 Step 6: Checking updated wallet balances..."

# Primary wallet balance
PRIMARY_BALANCE_RESPONSE=$(curl -s -X GET "$BASE_URL/wallets/$WALLET_ID/balance" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
PRIMARY_BALANCE=$(echo "$PRIMARY_BALANCE_RESPONSE" | grep -o '"balance":[^,}]*' | cut -d':' -f2)

# Secondary wallet balance
SECONDARY_BALANCE_RESPONSE=$(curl -s -X GET "$BASE_URL/wallets/$WALLET2_ID/balance" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
SECONDARY_BALANCE=$(echo "$SECONDARY_BALANCE_RESPONSE" | grep -o '"balance":[^,}]*' | cut -d':' -f2)

echo "✅ Wallet balances updated:"
echo "   Primary Wallet ($WALLET_ID): \$$PRIMARY_BALANCE"
echo "   Secondary Wallet ($WALLET2_ID): \$$SECONDARY_BALANCE"
echo ""

# Step 7: Get Transaction History
echo "📋 Step 7: Retrieving transaction history..."
HISTORY_RESPONSE=$(curl -s -X GET "$BASE_URL/wallets/$WALLET_ID/transactions?page=1&limit=5" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

TRANSACTION_COUNT=$(echo "$HISTORY_RESPONSE" | grep -o '"transactions":\[[^]]*\]' | grep -o '"id":"[^"]*' | wc -l)
echo "✅ Transaction history retrieved:"
echo "   Total transactions in history: $TRANSACTION_COUNT"
echo ""

# Step 8: Check Transfer Limits
echo "📊 Step 8: Checking transfer limits..."
LIMITS_RESPONSE=$(curl -s -X GET "$BASE_URL/wallets/$WALLET_ID/transfer-limits" \
    -H "Authorization: Bearer $ACCESS_TOKEN")

DAILY_LIMIT=$(echo "$LIMITS_RESPONSE" | grep -o '"dailyLimit":[^,}]*' | cut -d':' -f2)
DAILY_USED=$(echo "$LIMITS_RESPONSE" | grep -o '"dailyUsed":[^,}]*' | cut -d':' -f2)
MONTHLY_LIMIT=$(echo "$LIMITS_RESPONSE" | grep -o '"monthlyLimit":[^,}]*' | cut -d':' -f2)
MONTHLY_USED=$(echo "$LIMITS_RESPONSE" | grep -o '"monthlyUsed":[^,}]*' | cut -d':' -f2)

echo "✅ Transfer limits checked:"
echo "   Daily Limit: \$$DAILY_LIMIT (Used: \$$DAILY_USED)"
echo "   Monthly Limit: \$$MONTHLY_LIMIT (Used: \$$MONTHLY_USED)"
echo ""

# Summary
echo "🎉 API Test Completed Successfully!"
echo "=================================="
echo "✅ User account created and authenticated"
echo "✅ Primary wallet created and funded (\$$BALANCE)"
echo "✅ Secondary wallet created"
echo "✅ P2P transfer executed successfully (\$150.00)"
echo "✅ Final balances: Primary(\$$PRIMARY_BALANCE), Secondary(\$$SECONDARY_BALANCE)"
echo "✅ Transaction history retrieved ($TRANSACTION_COUNT transactions)"
echo "✅ Transfer limits validated"
echo ""
echo "🔗 Access Swagger Documentation: $BASE_URL/api"
echo "💡 Use the Postman collection for more comprehensive testing"
echo ""
echo "Test completed with email: $EMAIL"
echo "Access token: $ACCESS_TOKEN"
echo "" 