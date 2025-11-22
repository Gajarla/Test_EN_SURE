const mongoose = require('mongoose')
const dbURI = process.env.MONGOURI
const logger = require('../utils/logger')

const connectDB = async () => {
    try {
        const mongo = await mongoose.connect(dbURI, {
            // useNewUrlParser: true,
            // useUnifiedTopology: true,
            // useCreateIndex: true,
            // useFindAndModify: false,
        })

        logger.info('MongoDB connected')
        return mongo
    } catch (err) {
        logger.error(
            'Unable to connect to mongo, using dbURI: ' + dbURI + ' ',
            {
                stack: err.stack,
            }
        )
        process.exit(1)
    }
}

module.exports = connectDB
