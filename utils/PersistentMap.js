const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const logger = require('./logger');

// File path for persistent storage
const PENDING_VERIFICATIONS_FILE = path.join(__dirname, '..', 'data', 'pending_verifications.json');

// Real-time save function with error handling and atomic writes
async function savePendingVerifications(dataMap) {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(PENDING_VERIFICATIONS_FILE);
    await fs.mkdir(dataDir, { recursive: true });

    // Convert Map to a plain object for JSON serialization
    const dataToSave = {};
    for (const [key, value] of dataMap.entries()) {
      dataToSave[key] = value;
    }
    
    // Use atomic write by writing to temp file first, then rename
    const tempFile = PENDING_VERIFICATIONS_FILE + '.tmp';
    const jsonData = JSON.stringify(dataToSave, null, 2);
    
    await fs.writeFile(tempFile, jsonData, 'utf8');
    await fs.rename(tempFile, PENDING_VERIFICATIONS_FILE);
    
    if (config.DEBUG_MODE) {
      logger.info(`Saved ${dataMap.size} pending verifications to disk`);
    }
  } catch (error) {
    logger.error('Failed to save pending verifications:', error.message);
    
    // Try to clean up temp file if it exists
    try {
      await fs.unlink(PENDING_VERIFICATIONS_FILE + '.tmp');
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
  }
}

// Enhanced Map wrapper that saves on modification
class PersistentMap extends Map {
  constructor() {
    super();
    this._saving = false;
    this._saveQueued = false;
  }

  async _triggerSave() {
    // Debounce saves to avoid excessive disk I/O
    if (this._saving) {
      this._saveQueued = true;
      return;
    }

    this._saving = true;
    this._saveQueued = false;

    try {
      await savePendingVerifications(this);
    } finally {
      this._saving = false;
      
      // If another save was queued while we were saving, trigger it now
      if (this._saveQueued) {
        setImmediate(() => this._triggerSave());
      }
    }
  }

  set(key, value) {
    const result = super.set(key, value);
    this._triggerSave(); // Don't await to keep it non-blocking
    return result;
  }

  delete(key) {
    const result = super.delete(key);
    if (result) { // Only save if something was actually deleted
      this._triggerSave();
    }
    return result;
  }

  clear() {
    const hadEntries = this.size > 0;
    super.clear();
    if (hadEntries) {
      this._triggerSave();
    }
  }

  // Method to load data from file
  async loadFromFile() {
    try {
      // Check if file exists first
      try {
        await fs.access(PENDING_VERIFICATIONS_FILE);
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.info('No pending verifications file found, starting fresh');
          return;
        }
        throw error;
      }

      const data = await fs.readFile(PENDING_VERIFICATIONS_FILE, 'utf8');
      
      // Handle empty file
      if (!data.trim()) {
        logger.info('Pending verifications file is empty, starting fresh');
        return;
      }
      
      let pendingObject;
      try {
        pendingObject = JSON.parse(data);
      } catch (parseError) {
        logger.error('Failed to parse pending verifications JSON:', parseError.message);
        logger.info('Creating backup of corrupted file and starting fresh');
        
        // Create backup of corrupted file
        const backupFile = `${PENDING_VERIFICATIONS_FILE}.backup.${Date.now()}`;
        await fs.copyFile(PENDING_VERIFICATIONS_FILE, backupFile);
        logger.info(`Corrupted file backed up to: ${backupFile}`);
        
        return;
      }
      
      // Validate the loaded data structure
      if (typeof pendingObject !== 'object' || pendingObject === null) {
        throw new Error('Invalid pending verifications data structure - not an object');
      }
      
      // Clear existing pending verifications
      this.clear();
      
      let loadedCount = 0;
      let skippedCount = 0;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      const now = Date.now();
      
      // Load each entry back into the Map with validation
      for (const [scanRef, verification] of Object.entries(pendingObject)) {
        // Validate required fields
        if (!verification || 
            typeof verification !== 'object' ||
            !verification.discordId || 
            !verification.ckey || 
            !verification.timestamp ||
            !verification.type) {
          logger.warn(`Skipping invalid verification entry for scanRef: ${scanRef}`);
          skippedCount++;
          continue;
        }
        
        // Check if verification is too old (older than 24 hours)
        const age = now - verification.timestamp;
        
        if (age > maxAge) {
          logger.info(`Skipping expired verification for scanRef: ${scanRef} (${Math.round(age / (60 * 60 * 1000))}h old)`);
          skippedCount++;
          continue;
        }
        
        // Validate verification type
        if (!['idenfy', 'manual_approval'].includes(verification.type)) {
          logger.warn(`Skipping verification with unknown type: ${verification.type} for scanRef: ${scanRef}`);
          skippedCount++;
          continue;
        }
        
        // Use the regular Map.set to avoid triggering save during load
        Map.prototype.set.call(this, scanRef, verification);
        loadedCount++;
      }
      
      logger.info(`Loaded ${loadedCount} pending verifications${skippedCount > 0 ? `, skipped ${skippedCount} invalid/expired entries` : ''}`);
      
      // Optional: Log what was loaded for debugging
      if (config.DEBUG_MODE) {
        logger.info('Loaded pending verifications:', Array.from(this.keys()));
      }

      // If we skipped any entries, save the cleaned up version
      if (skippedCount > 0) {
        logger.info('Saving cleaned up pending verifications...');
        await savePendingVerifications(this);
      }
    } catch (error) {
      logger.error('Error loading pending verifications:', error.message);
      logger.info('Starting with empty pending verifications');
      
      // Clear any partial data that might have been loaded
      this.clear();
    }
  }

  // Method to manually save (useful for shutdown)
  async forceSave() {
    await savePendingVerifications(this);
  }

  // Cleanup old entries
  cleanup() {
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [scanRef, verification] of this.entries()) {
      if (now - verification.timestamp > MAX_AGE) {
        this.delete(scanRef);
        cleanedCount++;
        logger.info(`Cleaned up expired verification: ${scanRef} (${verification.type})`);
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`Cleanup completed: removed ${cleanedCount} expired pending verifications`);
    }
  }
}

module.exports = { PersistentMap, savePendingVerifications };