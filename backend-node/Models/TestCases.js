const mongoose = require('mongoose')

const TestCasesSchema = new mongoose.Schema(
    {
        moduleID: {
            type: String,
            required: [true, 'Module ID is mandatory'],
        },

        data: {
            type: Object,
            required: [true, 'please enter data'],
            trim: true,
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('TestCases', TestCasesSchema)
