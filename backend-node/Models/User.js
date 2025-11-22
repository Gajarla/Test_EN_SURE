const mongoose = require('mongoose')
const Project = require('./Project')

const userSchema = new mongoose.Schema(
    {
        firstName: {
            type: String,
            required: [true, 'please enter your Name'],
            trim: true,
        },

        lastName: {
            type: String,
            // required: [true, "please enter your Name"],
            trim: true,
        },
        email: {
            type: String,
            required: [true, 'please enter your email'],
            trim: true,
            unique: true,
        },
        mobileNumber: String,
        address: String,
        password: {
            type: String,
            required: [true, 'please enter your password'],
        },

        // TODO: Company enforce
        company: {
            type: String,
            required: [true, 'please enter your company'],
        },

        status: {
            type: String,
            // required: [true, "status is mandatory"]
        },

        role: {
            type: String,
            required: [true, 'Role is required'],
        },
        avatarUrl: {
            type: String,
        },
        createdBy: {
            type: String,
        },

        updatedBy: {
            type: String,
        },
        emailNotification: {
            type: Boolean,
        },
        isSSO: {
            type: Boolean,
        },
        defectTrack: mongoose.Schema.Types.Mixed,
        //lastloggeddin
    },
    { timestamps: true }
)

module.exports = mongoose.model('User', userSchema)
