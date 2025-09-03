# Veyra Discord Bot implementation

A Discord bot that provides secure identity verification for Veyra. This system ensures only ID verified users enter Veyra with a unique method and flag.

## Verification Flow

### Standard Verification Process

1. **User Initiation**: User runs `/verify <ckey>` command in Discord
2. **Limit Check**: System checks if daily verification limit has been reached
3. **Session Creation**: If under limit, creates iDenfy verification session
4. **Identity Verification**: User completes document scan and facial recognition via iDenfy
5. **Webhook Processing**: iDenfy sends verification result to webhook endpoint which is also hosted on this bot
7. **User Notification**: User receives confirmation via Discord response.
8. **Data Deletion**: Data is deleted from Idenfy's system leaving only a scanRef which we can use as proof of identification in the future.

### Verification Statuses from Idenfy

- **APPROVED**: Document and facial verification passed all checks
- **DENIED**: Verification failed due to document or facial recognition issues
- **EXPIRED**: User did not complete verification within time limit
- **SUSPECTED**: Potential fraud detected, requires manual review

## Installation and Setup

### Prerequisites

- Node.js 16.0 or higher
- Discord bot token with appropriate permissions
- iDenfy API credentials (API key and secret)
- Setup instance of Veyra
- Public webhook endpoint accessible by iDenfy set in .env file

### Environment Configuration

Create a `.env` file in the project root:

```bash
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
GUILD_ID=your_discord_server_id
ADMIN_ROLE_ID=admin_role_id_for_commands
VERIFICATION_CHANNEL_ID=channel_for_verification_logs

# Backend API Configuration
API_BASE_URL=https://your-api-server.com
API_USERNAME=api_service_username
API_PASSWORD=api_service_password

# iDenfy Service Configuration
IDENFY_API_KEY=your_idenfy_api_key
IDENFY_API_SECRET=your_idenfy_api_secret
IDENFY_BASE_URL=https://ivs.idenfy.com

# Application Settings
DAILY_VERIFICATION_LIMIT=25
WEBHOOK_PORT=3001
DEBUG_MODE=false
```

### Installation Steps

1. **Clone and Install Dependencies**
   ```bash
   git clone <repository-url>
   cd discord-verification-bot
   npm install
   ```

2. **Create Required Directories**
   ```bash
   mkdir data
   ```

3. **Configure Environment**
   - Copy `.env` template and fill in your credentials
   - Ensure webhook endpoint is publicly accessible
   - Configure Discord bot permissions (Send Messages, Use Slash Commands)

4. **Start the Application**
   ```bash
   # Production mode
   npm start
   
   # Development mode with auto-restart
   npm run dev
   ```

## Available Commands

### User Commands

- **`/verify <ckey>`**: Initiates identity verification process for specified BYOND key
- **`/check-verification`**: Displays current verification status and processes completed verifications

### Administrative Commands

- **`/verify-debug <ckey>`**: Creates debug verification without iDenfy (admin only)

### Development Commands (DEBUG_MODE=true only)

- **`/test-verify <ckey> [status]`**: Creates dummy verification that auto-completes with specified result
- **`/simulate-webhook <scan_ref> [status]`**: Manually triggers webhook for existing pending verification
- **`/list-pending`**: Displays all currently pending verifications

## Testing and Development

### Automated Testing

The bot includes comprehensive testing utilities for development:

```bash
# Interactive testing menu
npm run test-idenfy

# Specific test scenarios
npm run test-approved    # Test successful verification
npm run test-denied      # Test failed verification  
npm run test-webhook     # Test webhook simulation only

# Command line testing
node test/standaloneTest.js approved <discord_id> <ckey>
```

### Test Flow Options

1. **Dummy Sessions**: Creates real iDenfy sessions that auto-complete with specified results
2. **Webhook Simulation**: Directly simulates iDenfy webhook calls to test processing
3. **End-to-End Testing**: Complete verification flow with automated result processing

## Data Management

### Persistent Storage

- **Location**: `data/pending_verifications.json`
- **Format**: JSON object mapping scan references to verification data
- **Backup**: Corrupted files are automatically backed up before cleanup
- **Cleanup**: Automatic removal of verifications older than 24 hours

### Data Security

- **Encryption**: All API communications use HTTPS
- **Data Retention**: iDenfy verification data is deleted immediately after processing
- **Veyra Access**: JWT tokens with automatic refresh on expiration
- **Access Control**: Admin commands restricted by Discord role permissions

## API Integration

### Backend API Endpoints

The bot expects these endpoints on veyra to be working API:

- **POST `/api/auth/login`**: Authentication endpoint returning JWT token
- **GET `/api/analytics`**: Returns verification statistics including daily counts
- **POST `/api/v1/verify`**: Stores completed verification data
- **GET `/api/v1/verify/{discord_id}`**: Retrieves existing verification for user

### iDenfy Webhook Integration

- **Endpoint**: `POST /webhook/idenfy` (configurable port via WEBHOOK_PORT)
- **Authentication**: iDenfy webhook signatures (automatically handled)
- **Processing**: Real-time verification result processing with user notifications

## Configuration Options

### Verification Limits

- **DAILY_VERIFICATION_LIMIT**: Maximum automatic verifications per day (default: 25)
- **Behavior**: When exceeded, new verifications require manual admin approval
- **Bypass**: Admin debug commands ignore daily limits

### Webhook Configuration

- **WEBHOOK_PORT**: Port for Express webhook server (default: 3001)
- **Public Access**: Must be accessible by iDenfy servers for callbacks
- **SSL**: Recommended for production deployments

### Debug Settings

- **DEBUG_MODE**: Enables detailed logging and test commands (default: false)
- **Test Commands**: Additional slash commands for development testing

## Error Handling and Recovery

### Graceful Shutdown

- **Signal Handling**: Responds to SIGINT and SIGTERM for clean shutdown
- **Data Persistence**: Forces final save of all pending verifications
- **Connection Cleanup**: Properly closes Discord and webhook connections

### API Resilience

- **Automatic Retry**: Failed API calls automatically retried with exponential backoff
- **Token Refresh**: JWT authentication automatically renewed on 401 responses

## Security Considerations

### Access Control

- **Role Validation**: Admin commands verify Discord role membership before execution
- **Command Isolation**: Regular users cannot access administrative functions
- **Audit Logging**: All admin actions logged to designated Discord channel

### Data Protection

- **Minimal Retention**: Verification data deleted immediately after processing
- **Secure Transmission**: All external API calls use HTTPS encryption
- **Environment Isolation**: Sensitive credentials stored in environment variables only

### Privacy Compliance

- **Data Minimization**: Only necessary identity data processed through iDenfy
- **User Consent**: Clear verification process with user-initiated actions
- **Right to Deletion**: Automatic cleanup of temporary verification data

## Troubleshooting Guide

### Common Issues

**Bot fails to start**
- Verify Discord token validity and bot permissions
- Check all required environment variables are set
- Ensure API credentials authenticate successfully

**Verifications not processing**
- Confirm webhook endpoint is publicly accessible
- Validate iDenfy API credentials and service status
- Check webhook server port configuration and firewall rules

**Data not persisting**
- Verify `data/` directory exists and is writable
- Check available disk space and file system permissions
- Review application logs for specific error messages

**Users not receiving notifications**
- Confirm bot has permission to send direct messages
- Check user privacy settings allow messages from server members
- Verify Discord client connection stability

### Log Analysis

Enable DEBUG_MODE for detailed logging including:
- iDenfy API request/response details
- Webhook payload processing
- Database transaction results
- User notification delivery status