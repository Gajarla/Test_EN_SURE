const mongoose = require('mongoose')
const { Blob } = require('node-fetch')
const testRunSchema = new mongoose.Schema({
    modules: [
        {
            moduleID: {
                type: String,
                required: [true, 'Module ID is mandatory'],
            },
            tags: {
                type: [String],
                required: [true, 'Tags is a mandatory field'],
            },
            status: {
                type: String,
                enum: [
                    'PASSED',
                    'FAILED',
                    'SKIPPED',
                    'UNTESTED',
                    'BLOCKED',
                    'RUNNING',
                ],
                required: [true, 'Test status is mandatory'],
            },
            testNodes: [
                {
                    testNodeID: {
                        type: String,
                        required: [true, 'Test node ID is mandatory'],
                    },
                    status: {
                        type: String,
                        enum: [
                            'PASSED',
                            'FAILED',
                            'SKIPPED',
                            'UNTESTED',
                            'BLOCKED',
                            'RUNNING',
                        ],
                        required: [true, 'Test status is mandatory'],
                    },
                    testCases: [
                        {
                            testCaseID: {
                                type: String,
                                required: [true, 'Test case ID is mandatory'],
                            },
                            status: {
                                type: String,
                                enum: [
                                    'PASSED',
                                    'FAILED',
                                    'SKIPPED',
                                    'UNTESTED',
                                    'BLOCKED',
                                    'RUNNING',
                                ],
                                required: [true, 'Test status is mandatory'],
                            },
                            screenshot: {
                                type: Array,
                            },
                            log: {
                                type: String,
                            },
                            executionStart: {
                                type: String,
                            },
                            executionEnd: {
                                type: String,
                            },
                            executionDuration: {
                                type: String,
                            },
                        },
                    ],
                },
            ],
            ReRunStatus: Number,
            executionStart: {
                type: String,
            },
            executionEnd: {
                type: String,
            },
            executionDuration: {
                type: String,
            },
        },
    ],
})
module.exports = mongoose.model('TestRun', testRunSchema)
