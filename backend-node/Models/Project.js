const mongoose = require('mongoose')

const testStepSchema = new mongoose.Schema(
    {
        version: {
            type: Number,
        },
    },
    { strict: false }
)

const projectSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'please enter project name'],
            trim: true,
        },

        description: {
            type: String,
        },

        team: [
            {
                type: String,
                required: true,
            },
        ],
        emailNotifications: [
            {
                type: String,
            },
        ],
        company: {
            type: String,
            required: [true, 'please enter your company'],
            trim: true,
        },
        apiRequestFiles: {
            type: Object,
            // required: [true, 'please enter your company'],
            trim: true,
        },

        apiCreds: {
            type: [Object],
            // required: [true, 'please enter your company'],
            trim: true,
        },

        requestFiles: {
            type: [Object],
            // required: [true, 'please enter your company'],
            trim: true,
        },

        status: {
            type: String,
            enum: ['ARCHIVED', 'ACTIVE', 'CLOSED'],
            required: true,
        },

        templateID: {
            type: String,
            required: [true, 'please enter template'],
            trim: true,
        },

        testCaseSteps: {
            type: testStepSchema,
            required: [true, 'Test Case Steps are mandatory'],
        },

        // methods: {
        //     type: [methodsSchema],
        // },

        suiteNames: {
            type: Array,
            required: [true, 'Test Case Steps are mandatory'],
        },

        createdBy: {
            type: String,
        },

        updatedBy: {
            type: String,
        },
        defectTrack: mongoose.Schema.Types.Mixed,
    },
    { timestamps: true }
)

module.exports = mongoose.model('Project', projectSchema)
