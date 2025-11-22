const config = require('../config/auth.config')
const User = require('../Models/User')
const logger = require('../utils/logger')
const jwt = require('jsonwebtoken')
const common = require('../utils/common')
const moment = require('moment')

const crypto = require('crypto')
const mySecretKey = 'ASuperSecureSecretKey'
// Define a fixed IV (16 bytes for AES-256-CBC)
const FIXED_IV = Buffer.from('00000000000000000000000000000000', 'hex')

// Define a fixed secret key (32 bytes for AES-256)
const FIXED_SECRET_KEY = Buffer.from(
    'a3338ed32037f92099b6819f4295540e7c638b3d1a551fdd1abd00aca199f81f',
    'hex'
)

function encryptString(text) {
    const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        FIXED_SECRET_KEY,
        FIXED_IV
    )
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return encrypted
}
function decryptString(encryptedText) {
    const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        FIXED_SECRET_KEY,
        FIXED_IV
    )
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
}

exports.signin = async (req, res) => {
    // const decryptedText = decryptString(encryptedText);
    try {
        const user = await User.findOne({ email: req.body.email })
            .populate({ path: 'company', model: 'Company' })
            .populate({ path: 'role', model: 'Role' })

        if (!user) {
            logger.warn(`Unable to find user with email: ${req.body.email}`)
            res.status(400).json({ message: 'Invalid username or password' })
        } else {
            const encryptedText = encryptString(req.body.password)
            console.log(req.body.password, ':', encryptedText)
            if (encryptedText === user.password) {
                let token = jwt.sign({ id: user._id }, config.secret, {
                    expiresIn: 86400,
                })
                let ctime = moment().format('MM/DD/YYYY hh:mm:ss')
                let logaudit = await common.UserLoginActivity(
                    user._id,
                    user.firstName,
                    ctime,
                    'LOG_IN',
                    user.company._id
                )
                res.json({
                    token: token,
                    user: user,
                    loggedintime: ctime,
                })
            } else {
                logger.warn(
                    `Invalid password. DB pass: ${user.password}, sent: ${req.body.password}`
                )
                res.status(400).json({
                    message: 'Invalid Username or Password',
                })
            }
        }
    } catch (error) {
        logger.error(`Error while finding user with email ${req.body.email}`, {
            stack: err,
        })
        res.status(500).json({ message: err.message })
    }
}
