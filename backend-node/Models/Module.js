const mongoose = require('mongoose')

const testStepSchema = new mongoose.Schema({}, { strict: false })

const testCaseSchema = new mongoose.Schema({
    testCaseID: {
        type: String,
        required: [true, 'Test Case ID is mandatory'],
    },
    testCaseTitle: {
        type: String,
        required: [true, 'Test Case Title is mandatory'],
    },
    testCaseDescription: {
        type: String,
        required: [true, 'Test Case Description is mandatory'],
    },
    priority: {
        type: String,
        // required: [true, "Test Case priority is mandatory"],
    },
    dependsOn: {
        type: String,
    },
    REQID: {
        type: String,
    },
    tags: {
        type: [String],
        required: [true, 'Tags is mandatory'],
    },
    testCaseSteps: {
        type: [testStepSchema],
        required: [true, 'Test Case Steps are mandatory'],
    },
    automationStatus: {
        type: Boolean,
        required: [true, 'Automated status is mandatory'],
        default: false,
    },
})

const testNodeSchema = new mongoose.Schema({
    testNode: {
        type: [testCaseSchema],
        required: [true, 'Test Case Schema is mandatory'],
    },
})

const moduleSchema = new mongoose.Schema(
    {
        projectID: {
            type: String,
            required: [true, 'Project ID is mandatory'],
        },
        company: {
            type: String,
            required: [true, 'please enter your company'],
            trim: true,
        },
        suiteName: {
            type: String,
            required: [true, 'Suite Name is mandatory'],
        },
        suiteDescription: {
            type: String,
            required: [true, 'Suite Description is mandatory'],
        },
        businessProcess: {
            type: String,
            // required: [true, "Test Case Title is mandatory"],
        },
        initialTestNodes: {
            type: [testNodeSchema],
        },
        testNodes: {
            type: [testNodeSchema],
            required: [true, 'Test Case Schema is mandatory'],
        },
        testPlaceholders: {
            type: mongoose.Schema.Types.Mixed,
        },
        locatorProperties: {
            type: mongoose.Schema.Types.Mixed,
        },
        outputVariables: {
            type: mongoose.Schema.Types.Mixed,
        },
        automationStatus: {
            type: Boolean,
            required: [true, 'Automated status is mandatory'],
            default: false,
        },
        createdBy: {
            type: String,
        },
        updatedBy: {
            type: String,
        },
        version: {
            type: String,
        },
    },
    { timestamps: true }
)

const Module = mongoose.model('Module', moduleSchema)
const TestNode = mongoose.model('TestNode', testNodeSchema)
const TestCase = mongoose.model('TestCase', testCaseSchema)
const TestStep = mongoose.model('TestStep', testStepSchema)

module.exports = {
    Module,
    TestNode,
    TestCase,
    TestStep,
}
