const mongoose = require('mongoose')

const companySchema = new mongoose.Schema(
    {
        company: {
            type: String,
            required: [true, 'please enter your Company Name'],
            trim: true,
        },
        code: String,
        description: String,
        rpAccessToken: {
            type: String,
            trim: true,
        },
        rpUsername: {
            type: String,
            trim: true,
        },
        createdBy: {
            type: String,
        },

        updatedBy: {
            type: String,
        },
        status: {
            type: Number,
            default: 1,
        }, // 1 - Active , 0 - In Avtice / Deleted
    },
    { timestamps: true }
)

module.exports = mongoose.model('Company', companySchema)
