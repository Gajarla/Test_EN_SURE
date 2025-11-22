const mongoose = require('mongoose')

const testStepSchema = new mongoose.Schema({}, { strict: false })

const testCaseStepSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            trim: true,
        },
        testCaseSteps: {
            type: [testStepSchema],
            trim: true,
        },
    },
    { strict: false }
)

const TestCasesSchema = new mongoose.Schema(
    {
        companyId: {
            type: String,
            required: [true, 'companyID is mandatory'],
        },

        projectId: {
            type: String,
            required: [true, 'ProjectId is mandatory'],
        },

        version: {
            type: Number,
            trim: true,
        },

        methods: {
            type: [testCaseStepSchema],
            required: [true, 'testCaseSteps is mandatory'],
            trim: true,
        },

        jobIds: {
            type: [String],
            trim: true,
        },

        releaseIds: {
            type: [String],
            trim: true,
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('TestCaseSteps', TestCasesSchema)
