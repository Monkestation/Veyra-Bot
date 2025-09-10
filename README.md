# Veyra Discord Bot implementation

A Discord bot that provides secure identity verification for Veyra. This system ensures only ID verified users enter Veyra with a unique method and flag.

## Verification Flow

### Standard Verification Process

1. **[User Initiation](https://github.com/Monkestation/Veyra-Bot/blob/main/commands/commandHandlers.js#L15)**: User runs `/verify <ckey>` command in Discord
2. **Limit Check**: System checks if daily verification limit has been reached
3. **[Session Creation](https://github.com/Monkestation/Veyra-Bot/blob/main/commands/commandHandlers.js#L15)**: If under limit, creates iDenfy verification session
4. **Identity Verification**: User completes document scan and facial recognition via iDenfy
5. **[Webhook Processing](https://github.com/Monkestation/Veyra-Bot/blob/main/webhook/webhookServer.js#L142)**: iDenfy sends verification result to webhook endpoint which is also hosted on this bot
7. **[User Notification](https://github.com/Monkestation/Veyra-Bot/blob/main/webhook/webhookServer.js#L11)**: User receives confirmation via Discord response.
8. **[Data Deletion](https://github.com/Monkestation/Veyra-Bot/blob/main/webhook/webhookServer.js#L81)**: Data is deleted from iDenfy's system leaving only a scanRef which we can use as proof of identification in the future.

### Verification Statuses from iDenfy

- **APPROVED**: Document and facial verification passed all checks
- **DENIED**: Verification failed due to document or facial recognition issues
- **EXPIRED**: User did not complete verification within time limit
- **SUSPECTED**: Potential fraud detected, requires manual review

## Security Considerations

### Access Control

- **Role Validation**: Admin commands verify Discord role membership before execution
- **Command Isolation**: Regular users cannot access administrative functions
- **Audit Logging**: All admin actions logged to designated Discord channel

### Privacy Compliance & Data Protection

- **Data Minimization**: Only necessary identity data processed through iDenfy
- **User Consent**: Clear verification process with user-initiated actions
- **Data Retention**: iDenfy verification data is deleted immediately after processing
- **Access Control**: Admin commands restricted by Discord role permissions

## Installation and Setup

### Prerequisites

- Node.js 16.0 or higher
- Discord bot token with appropriate permissions
- iDenfy API credentials (API key and secret)
- Setup instance of Veyra
- Public webhook endpoint accessible by iDenfy set in .env file

### Installation Steps

1. **Clone and Install Dependencies**
   ```bash
   git clone https://github.com/Monkestation/Veyra-Bot/
   cd veyra-bot
   npm install
   ```

2. **Create Required Directories**
   ```bash
   mkdir data
   ```

3. **Configure Environment**
   - Create a copy of [`.env.example`](.env.example) and rename it to `.env`. Fill in the required values.
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

### Development Commands (`DEBUG=true` only)

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

- **`DAILY_VERIFICATION_LIMIT`**: Maximum automatic verifications per day (default: 25)
- **Behavior**: When exceeded, new verifications require manual admin approval
- **Bypass**: Admin debug commands ignore daily limits

### Webhook Configuration

- **`WEBHOOK_PORT`**: Port for Express webhook server (default: 3001)
- **Public Access**: Must be accessible by iDenfy servers for callbacks
- **SSL**: Recommended for production deployments

### Debug Settings

- **`DEBUG`**: Enables detailed logging and test commands (default: false)
- **Test Commands**: Additional slash commands for development testing

## Error Handling and Recovery

### Graceful Shutdown

- **Signal Handling**: Responds to SIGINT and SIGTERM for clean shutdown
- **Data Persistence**: Forces final save of all pending verifications
- **Connection Cleanup**: Properly closes Discord and webhook connections

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

## Other Notes

- Logs are located in the `logs` folder,
- Veyra uses a json file to keep track of pending verifications across bot restarts, so data isn't lost, @ `data/pending_verifications.json`
