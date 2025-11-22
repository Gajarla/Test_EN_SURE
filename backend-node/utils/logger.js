const winston = require('winston');

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console()
  ],
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      info => `${info.timestamp} ${info.level}: ${info.message}` +
        (info.stack ? info.stack : ""))
  )
})

module.exports = logger;