const mongoose = require('mongoose')

const LoginActivity = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: [true, 'please enter ROLE ID'],
        },
        userName: String,
        loginAt: String,
        logoutAt: String,
        location: {
            lat: String,
            lang: String,
            ipaddress: String,
        },
        status: {
            type: Number,
            default: 1,
        }, // 1 - Login , 0 - Logout
        company: {
            type: String,
            // required: [true, 'please enter your company'],
        },
    },
    { timestamps: true }
)

// lat and lang, ipaddress
module.exports = mongoose.model('LoginActivity', LoginActivity)
