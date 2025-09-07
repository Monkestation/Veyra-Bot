const winston = require("winston");
const { getFilenameFriendlyUTCDate, sleep } = require("./other");
const { join: pathJoin } = require("node:path");
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const Sentry = require('@sentry/node');
const config = require("../config/config");
const SentryTransport = require('./WinstonSentryTransport');

if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    tracesSampleRate: 1.0,
    integrations: [
      Sentry.expressIntegration()
    ]
  });
}

if (config.DEBUG_MODE) {
  console.warn(`Debug mode enabled${config.SENTRY_DSN && !process.env.SENTRY_DEBUG ? "; Sentry debug can be enabled with SENTRY_DEBUG env.": ""}`);
}

if (config.LOGGER_NEW) {
  const logPath = pathJoin(process.cwd(), "logs", `${IS_PRODUCTION ? "prod" : "dev"}_${getFilenameFriendlyUTCDate()}.json`);
  console.log(`"Logging (JSON Lines) to ${logPath}"`);
  const transports = [];

  transports.push(
    new winston.transports.File({
      filename: logPath,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      handleExceptions: true,
    })
  );

  if (config.SENTRY_DSN) {
    transports.push(
      new SentryTransport({
        sentry: {
          dsn: config.SENTRY_DSN,
        },
        level: 'error', // just errors
        exceptionLevels: ['error'],
      })
    );
  }
  if (config.LOGGER_PRETTY) {
    const { inspect } = require("util");
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize({
            message: true,
            colors: {
              info: "blue",
            },
            level: true
          }),
          winston.format.timestamp(),
          winston.format.printf((info) => {
            let message = info.message;
            if (typeof message === "object") {
              message = inspect(message, { depth: null, colors: true });
            }
            return `[${info.timestamp}] ${info.level}: ${message}${info.stack ? "\n" + info.stack : ""}`;
          })
        ),
      })
    );
  } else {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      })
    );
  }

  const logger = winston.createLogger({ transports });

  const flush = async () => {
    const promises = logger.transports.map((transport) => {
      return new Promise((resolve) => {
        if (transport._stream && transport._stream.end) {
          transport._stream.end(resolve);
        } else if (transport.close) {
          transport.close();
          resolve();
        } else {
          resolve();
        }
      });
    });
    await Promise.all(promises);
  };

  globalThis._oldExit = process.exit;
  process.exit = async (...args) => {
    // Ample amount of time for anything to do it's thing.
    await sleep(500);
    await flush();
    globalThis._oldExit(...args)
  }

  module.exports = logger;
} else {
  module.exports = console;
}