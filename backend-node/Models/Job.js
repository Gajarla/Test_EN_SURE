const mongoose = require('mongoose')
const { testRunSchema } = require('./TestRun').schema

const JobsSchema = new mongoose.Schema(
    {
        jenkinsJobID: {
            type: String,
            required: [true, 'Job ID is mandatory'],
        },
        jenkinsPath: {
            type: String,
            required: [true, 'Job Path is mandatory'],
        },
        jenkinsJobName: {
            type: String,
        },
        jenkinsBuildNumber: {
            type: Number,
        },
        releaseID: {
            type: String,
            required: [true, 'Release ID is mandatory'],
        },
        projectID: {
            type: String,
            required: [true, 'Project ID is mandatory'],
        },
        company: {
            type: String,
            required: [true, 'please enter your company'],
            trim: true,
        },
        tpId: {
            type: String,
        },
        dependsOn: mongoose.Schema.Types.Mixed,
        video: {
            type: Boolean,
        },
        testRun: {
            type: [testRunSchema],
        },
        reportPortal: {
            url: {
                type: String,
            },
        },
        lambdatest: {
            video: {
                type: String,
            },
            status: {
                type: String,
            },
        },
        linuxScreenRecord: {
            video: {
                type: String,
            },
            status: {
                type: String,
            },
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
        runningStatus: {
            type: String,
        },
        executeJob: {
            type: String,
        },
        createdBy: {
            type: String,
            required: [true, 'Created By is mandatory'],
        },
        version: {
            type: Number,
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('Job', JobsSchema)
