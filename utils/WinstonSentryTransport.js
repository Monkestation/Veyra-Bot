// Compiled typescript from https://github.com/aandrewww/winston-transport-sentry-node/ 
// simply to avoid package conflicts since it requires @sentry/node v8.

const Sentry = require("@sentry/node");
const TransportStream = require("winston-transport");
const { LEVEL } = require("triple-beam");

var SentrySeverity;
(function (SentrySeverity) {
  SentrySeverity["Debug"] = "debug";
  SentrySeverity["Log"] = "log";
  SentrySeverity["Info"] = "info";
  SentrySeverity["Warning"] = "warning";
  SentrySeverity["Error"] = "error";
  SentrySeverity["Fatal"] = "fatal";
})(SentrySeverity || (SentrySeverity = {}));

const DEFAULT_LEVELS_MAP = {
  silly: SentrySeverity.Debug,
  verbose: SentrySeverity.Debug,
  info: SentrySeverity.Info,
  debug: SentrySeverity.Debug,
  warn: SentrySeverity.Warning,
  error: SentrySeverity.Error,
};

class ExtendedError extends Error {
  constructor(info) {
    super(info.message);

    this.name = info.name || "Error";
    if (info.stack && typeof info.stack === "string") {
      this.stack = info.stack;
    }
  }
}

module.exports = class SentryTransport extends TransportStream {
  silent = false;

  levelsMap = {};

  constructor(opts) {
    super(opts);

    this.levelsMap = this.setLevelsMap(opts && opts.levelsMap);
    this.silent = (opts && opts.silent) || false;

    if (!opts || !opts.skipSentryInit) {
      Sentry.init(SentryTransport.withDefaults((opts && opts.sentry) || {}));
    }
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit("logged", info);
    });

    if (this.silent) return callback();

    const { message, tags, user, ...meta } = info;
    const winstonLevel = info[LEVEL];

    const sentryLevel = this.levelsMap[winstonLevel];

    const scope = Sentry.getCurrentScope();
    scope.clear();

    if (tags !== undefined && SentryTransport.isObject(tags)) {
      scope.setTags(tags);
    }

    scope.setExtras(meta);

    if (user !== undefined && SentryTransport.isObject(user)) {
      scope.setUser(user);
    }

    // TODO: add fingerprints
    // scope.setFingerprint(['{{ default }}', path]); // fingerprint should be an array

    // scope.clear();

    // TODO: add breadcrumbs
    // Sentry.addBreadcrumb({
    //   message: 'My Breadcrumb',
    //   // ...
    // });

    // Capturing Errors / Exceptions
    if (SentryTransport.shouldLogException(sentryLevel)) {
      const error =
        Object.values(info).find((value) => value instanceof Error) ??
        new ExtendedError(info);
      Sentry.captureException(error, { tags, level: sentryLevel });

      return callback();
    }

    // Capturing Messages
    Sentry.captureMessage(message, sentryLevel);
    return callback();
  }

  end(...args) {
    Sentry.flush().then(() => {
      super.end(...args);
    });
    return this;
  }

  get sentry() {
    return Sentry;
  }

  setLevelsMap = (options) => {
    if (!options) {
      return DEFAULT_LEVELS_MAP;
    }

    const customLevelsMap = Object.keys(options).reduce(
      (acc, winstonSeverity) => {
        acc[winstonSeverity] = options[winstonSeverity];
        return acc;
      },
      {}
    );

    return {
      ...DEFAULT_LEVELS_MAP,
      ...customLevelsMap,
    };
  };

  static withDefaults(options) {
    return {
      ...options,
      dsn: (options && options.dsn) || process.env.SENTRY_DSN || "",
      serverName:
        (options && options.serverName) || "winston-transport-sentry-node",
      environment:
        (options && options.environment) ||
        process.env.SENTRY_ENVIRONMENT ||
        process.env.NODE_ENV ||
        "production",
      debug: (options && options.debug) || !!process.env.SENTRY_DEBUG || false,
      sampleRate: (options && options.sampleRate) || 1.0,
      maxBreadcrumbs: (options && options.maxBreadcrumbs) || 100,
    };
  }

  // private normalizeMessage(msg: any) {
  //   return msg && msg.message ? msg.message : msg;
  // }

  static isObject(obj) {
    const type = typeof obj;
    return type === "function" || (type === "object" && !!obj);
  }

  static shouldLogException(level) {
    return level === SentrySeverity.Fatal || level === SentrySeverity.Error;
  }
}
