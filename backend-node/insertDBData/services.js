// require('dotenv').config()
import mongoose from 'mongoose'
const dbURI = process.env.MONGOURI

// console.log('process', process.env)

export const connectDB = async () => {
    try {
        const mongo = await mongoose.connect(dbURI, {})
        console.log('MongoDB connected')
        return mongo
    } catch (err) {
        console.log('Unable to connect to mongo, using dbURI: ' + dbURI + ' ', {
            stack: err.stack,
        })
        process.exit(1)
    }
}

// const db = await connectDB()

// await mongoose.disconnect()
// console.log('MongoDB connection closed')
