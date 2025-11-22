const mongoose = require('mongoose')

const releaseSchema = new mongoose.Schema(
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

        releaseName: {
            type: String,
            required: [true, 'Release name is mandatory'],
            trim: true,
            unique: true,
        },

        description: {
            type: String,
            trim: true,
        },

        version: {
            type: String,
            trim: true,
        },
        releaseVersion: {
            type: String,
            trim: true,
        },
        testRunVersion: {
            type: Number,
            trim: true,
        },

        releaseDate: {
            type: String,
            trim: true,
        },

        schedule: {
            type: String,
            trim: true,
        },

        scheduledOn: {
            type: Object,
            trim: true,
        },

        modules: {
            type: [
                {
                    moduleID: {
                        type: String,
                        required: [true, 'Module ID is a mandatory field'],
                    },
                    tags: {
                        type: [String],
                        required: [true, 'Tags is a mandatory field'],
                    },
                    testNodes: {
                        type: [String],
                        required: [true, 'Test Nodes is a mandatory field'],
                    },
                    dependsOn: {
                        type: String,
                    },
                    testPlaceholders: {
                        type: mongoose.Schema.Types.Mixed,
                    },
                },
            ],
            required: [true, 'Test cases is a mandatory field'],
        },

        templateID: {
            type: String,
            // required: [true, "Template Id is mandatory"],
            trim: true,
        },

        createdBy: {
            type: String,
            required: [true, 'Created By is mandatory'],
            trim: true,
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('Release', releaseSchema)
