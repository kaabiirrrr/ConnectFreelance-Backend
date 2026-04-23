const logger = {
  log: (...args) => {
    if (process.env.NODE_ENV !== 'production') console.log(...args);
  },
  info: (...args) => {
    if (process.env.NODE_ENV !== 'production') console.log(...args);
  },
  warn: (...args) => {
    if (process.env.NODE_ENV !== 'production') console.warn(...args);
  },
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') console.debug(...args);
  },
  error: (...args) => console.error(...args),
};

module.exports = logger;
