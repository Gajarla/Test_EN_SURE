require('dotenv').config()
const express = require('express')
const connectDB = require('./config/db')
const websockets = require('./websockets')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const fileUpload = require('express-fileupload')
const app = express()
const controller = require('./controllers/auth.controller')
const ssocontroller = require('./controllers/sso.controller')
const config = require('./config/auth.config')
const jwt = require('jsonwebtoken')
const logger = require('./utils/logger')
const common = require('./utils/common')
const crypto = require('crypto')
const mySecretKey = 'ASuperSecureSecretKey'
// Define a fixed IV (16 bytes for AES-256-CBC)
const FIXED_IV = Buffer.from('00000000000000000000000000000000', 'hex')
// Define a fixed secret key (32 bytes for AES-256)
const FIXED_SECRET_KEY = Buffer.from(
    'a3338ed32037f92099b6819f4295540e7c638b3d1a551fdd1abd00aca199f81f',
    'hex'
)
const moment = require('moment')
const fs = require('fs')
const helmet = require('helmet')
const http = require('http')
const version = fs
    .readFileSync('./metadata/version', {
        flag: 'r',
        encoding: 'utf8',
    })
    .trim()
const gitHash = fs
    .readFileSync('./metadata/githash', {
        flag: 'r',
        encoding: 'utf8',
    })
    .trim()
const ResetPswdToken = require('./Models/resetpswdTokens')
const User = require('./Models/User')
const cluster = require('cluster')
const os = require('os')
const numCPUs = os.cpus().length
connectDB()
// app.use(
//     cors({
//         origin: '*',
//     })
// )
app.disable('x-powered-by')
app.disable('etag')
app.use(
    helmet.contentSecurityPolicy({
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                'https://cdnjs.cloudflare.com',
                'https://www.googletagmanager.com',
                'https://www.google-analytics.com',
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://fonts.googleapis.com',
            ],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https://www.google-analytics.com'],
            connectSrc: ["'self'", 'https://api.yourservice.com'],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
        },
    })
)
const originalStoreHeader = http.OutgoingMessage.prototype._storeHeader
http.OutgoingMessage.prototype._storeHeader = function (firstLine, headers) {
    if (headers) {
        delete headers.date
    }
    originalStoreHeader.call(this, firstLine, headers)
}
// 1️⃣ Serve static files first, with their own cache headers
app.use(
    express.static('public', {
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, path) => {
            // Optionally add security headers to static files too
            res.setHeader('X-Content-Type-Options', 'nosniff')
            res.setHeader('X-Frame-Options', 'DENY')
        },
    })
)
// 2️⃣ Apply your security middleware to everything else
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
    )
    res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
    )
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // res.setHeader(
    //     'Content-Security-Policy',
    //     "default-src 'self'; script-src 'self';"
    // )
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.removeHeader('Server')
    res.removeHeader('Date')
    res.removeHeader('Last-Modified')
    res.setHeader('Server', 'SecureServer')
    res.sendDate = false
    next()
})
app.use((req, res, next) => {
    res.removeHeader('Server')
    res.removeHeader('Date')
    res.sendDate = false
    const _setHeader = res.setHeader
    res.setHeader = function (name, value) {
        if (name.toLowerCase() === 'server' || name.toLowerCase() === 'date')
            return
        _setHeader.call(this, name, value)
    }
    next()
})
// ✅ Define allowed origins
const allowedOrigins = [
    ...(process.env.ALLOWED_ORIGINS?.split(',') || []),
    process.env.APP_URL,
    process.env.JENKINS_HOST,
]
// ✅ CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true)
        } else {
            callback(new Error('Not allowed by CORS'))
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 204,
}
// ✅ Apply CORS globally
app.use(cors(corsOptions))
// ✅ Handle preflight OPTIONS manually for more control (if needed)
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        const origin = req.headers.origin
        const accessControlRequestMethod =
            req.headers['access-control-request-method']
        if (
            origin &&
            accessControlRequestMethod &&
            allowedOrigins.includes(origin)
        ) {
            // Allow only approved CORS origins
            res.setHeader('Access-Control-Allow-Origin', origin)
            res.setHeader(
                'Access-Control-Allow-Methods',
                'GET, POST, PUT, PATCH, DELETE'
            )
            res.setHeader(
                'Access-Control-Allow-Headers',
                'Content-Type, Authorization'
            )
            res.setHeader('Access-Control-Allow-Credentials', 'true')
            return res.sendStatus(204) // OK — no content
        } else {
            // Log the unauthorized OPTIONS attempt
            console.warn(
                `Blocked OPTIONS request from origin: ${origin || 'Unknown'}`
            )
            // Block the OPTIONS request
            res.setHeader('Content-Type', 'text/plain')
            res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE') // no OPTIONS
            return res.status(405).send('OPTIONS method not allowed')
        }
    }
    next()
})
// ✅ Block TRACE method (high severity)
app.use((req, res, next) => {
    if (req.method === 'TRACE') {
        return res.status(405).send('TRACE method not allowed')
    }
    next()
})
var auth = function (req, res, next) {
    const token = req.header('Authorization')
    const userid = req.header('UserId')
    if (!userid || !token) {
        res.send({ Status: 401, Message: 'Un Authorized..' })
    } else {
        jwt.verify(token, config.secret, (err, decoded) => {
            if (err) {
                res.send({ Status: 401, Message: 'Invalid token..', data: err })
            } else {
                next()
            }
        })
    }
}
app.get('/', async function (request, response) {
    const mongo = await connectDB()
    response.json({
        status: 'active',
        mongo: {
            db: mongo.connection.name,
            // host: mongo.connection.host,
        },
        environment: process.env.APP_ENV,
        version,
        gitHash,
    })
})
app.use((req, res, next) => {
    if (req.query && req.query.bypass) {
        logger.warn(
            "Bypassing authentication, please refrain from using it. This won't be allowed in the higher environments"
        )
        next()
    } else {
        try {
            const authToken = req.headers.authorization
            const user = jwt.verify(
                authToken.substring('Bearer '.length),
                config.secret
            )
            req.userId = user.id
            res.setHeader('X-Frame-Options', 'DENY')
            next()
        } catch (e) {
            logger.warn(
                'Invalid token from ' +
                    (req.headers['x-forwarded-for'] ||
                        req.headers.forwarded ||
                        'Unknown source / localhost')
            )
            res.status(401).json({ message: 'Invalid token' })
        }
    }
})
app.use(function (req, res, next) {
    res.header(
        'Access-Control-Allow-Headers',
        'x-access-token, Origin, Content-Type, Accept'
    )
    next()
})
// app.use(express.json());
app.use(express.json({ limit: '100mb', extended: true }))
app.use(
    express.urlencoded({
        limit: '100mb',
        extended: true,
        parameterLimit: 500000,
    })
)
app.use(cookieParser())
app.use(
    fileUpload({
        useTempFiles: false,
    })
)
app.use('/api/users', require('./Routes/api/users'))
app.use('/api/projects', require('./Routes/api/projects'))
app.use('/api/releases', require('./Routes/api/releases'))
app.use('/api/testsuites', require('./Routes/api/testsuites'))
app.use('/api/audits', require('./Routes/api/audit'))
app.use('/api/rolemanage', require('./Routes/api/RolesController'))
app.post('/api/auth/signin', controller.signin)
app.post('/api/auth/verify', ssocontroller.verify)
app.post('/api/auth/signout', async (req, res) => {
    logger.info(`Sign Out: ${req}`)
    let body = req.body
    if (!body.UserId) {
        res.send({ status: 204, message: 'User Id Required', data: [] })
    } else if (!body.logintime) {
        res.send({ status: 204, message: 'Login Time Required', data: [] })
    } else if (!body.jwt) {
        res.send({ status: 204, message: 'Token Required', data: [] })
    } else {
        if (body?.ssosessionToken && body?.refreshToken) {
            const sessionToken = body.ssosessionToken
            const refreshToken = body.refreshToken
            const client = dc.default({ projectId: process.env.SSO_PROJECT_ID })
            const signout = client.signout(sessionToken, refreshToken)
            console.log(signout)
        }
        let logaudit = await common.UserLoginActivity(
            req.body.UserId,
            '',
            req.body.logintime,
            'LOG_OUT'
        )
        if (logaudit) {
            //jwt.destroy(body.token)
            res.send({ status: 200, message: 'Success', data: [] })
        } else {
            res.send({ status: 400, message: 'Something Went Wrong', data: [] })
        }
    }
})
app.post('/api/auth/forgotpassword', async (req, res) => {
    let body = req.body
    // console.log(body)
    let UserDetails = await User.findOne({ email: body.Email })
    if (UserDetails) {
        let token = await ResetPswdToken.findOne({ userId: UserDetails?._id })
        if (token) {
            await ResetPswdToken.deleteMany({ userId: UserDetails._id })
        }
        let resetToken = crypto.randomBytes(32).toString('hex')
        // console.log("Reset Password Link ",resetToken+UserDetails?._id);
        let savetoken = await new ResetPswdToken({
            userId: UserDetails?._id,
            token: resetToken + UserDetails?._id,
            createdAt: Date.now(),
        }).save()
        let email = await common
            .SendEmail(
                UserDetails?.email,
                'Password Reset Assistance: Next Steps to Reset Your Password',
                process.env.APP_URL +
                    '/#/auth/reset-password/' +
                    resetToken +
                    '/' +
                    UserDetails?._id,
                UserDetails,
                'FORGOT_PASSWORD'
            )
            .catch(console.error)
        res.send({ status: 200, message: 'Success', data: savetoken })
    } else {
        res.send({ status: 400, message: 'No user found', data: '' })
    }
})
app.post('/api/auth/resetpassword', async (req, res) => {
    let body = req.body
    let passwordResetToken = await ResetPswdToken.findOne({
        userId: body.userId,
    })
    if (!passwordResetToken) {
        throw new Error('Invalid or expired password reset token')
    } else {
        const dbTime = new Date(passwordResetToken?.createdAt)
        const currentTime = new Date()
        const timeDifference = currentTime.getTime() - dbTime.getTime()
        const expiryDuration = 15 * 60 * 1000
        if (timeDifference >= expiryDuration) {
            console.log('Token has expired.')
        } else {
            console.log('Token is still valid.')
            if (body.Token + body.userId == passwordResetToken.token) {
                //update password
                User.updateOne(
                    {
                        _id: passwordResetToken.userId,
                    },
                    {
                        $set: {
                            password: body.password,
                        },
                    }
                ).then((doc) => {
                    if (doc) {
                        res.send({
                            status: 200,
                            message: 'Password Updated Successfully',
                            data: [],
                        })
                    } else {
                        res.send({
                            status: 204,
                            message: 'Something Went Wrong..',
                            data: [],
                        })
                    }
                })
                res.send({ status: 200, message: 'Password Updated', data: [] })
            } else {
                res.send({ status: 200, message: 'Token Not Valid', data: [] })
            }
        }
    }
})
//updating encrypted password - v1
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
app.post('/api/auth/v1/resetpassword', async (req, res) => {
    let body = req.body
    let passwordResetToken = await ResetPswdToken.findOne({
        userId: body.userId,
    })
    if (!passwordResetToken) {
        throw new Error('Invalid or expired password reset token')
    } else {
        const dbTime = new Date(passwordResetToken?.createdAt)
        const currentTime = new Date()
        const timeDifference = currentTime.getTime() - dbTime.getTime()
        const expiryDuration = 15 * 60 * 1000
        if (timeDifference >= expiryDuration) {
            console.log('Token has expired.')
        } else {
            console.log('Token is still valid.')
            if (body.Token + body.userId == passwordResetToken.token) {
                const encryptedText = encryptString(req.body.password)
                //update password
                User.updateOne(
                    {
                        _id: passwordResetToken.userId,
                    },
                    {
                        $set: {
                            password: encryptedText,
                        },
                    }
                ).then((doc) => {
                    if (doc) {
                        res.send({
                            status: 200,
                            message: 'Password Updated Successfully',
                            data: [],
                        })
                    } else {
                        res.send({
                            status: 204,
                            message: 'Something Went Wrong..',
                            data: [],
                        })
                    }
                })
                res.send({ status: 200, message: 'Password Updated', data: [] })
            } else {
                res.send({ status: 200, message: 'Token Not Valid', data: [] })
            }
        }
    }
})
app.post('/api/auth/v1/getEncrypt', async (req, res) => {
    let body = req.body
    const encryptedText = encryptString(req.body.password)
    res.send({
        status: 200,
        message: 'Encrypted Text',
        data: { password: req.body.password, encryptText: encryptedText },
    })
})
app.post('/api/auth/v1/getDecrypt', async (req, res) => {
    let body = req.body
    const encryptedText = decryptString(req.body.password)
    res.send({
        status: 200,
        message: 'Encrypted Text',
        data: { password: req.body.password, decryptText: encryptedText },
    })
})
function encrypt(pswd) {
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv)
    let encrypted = cipher.update(pswd)
    encrypted = Buffer.concat([encrypted, cipher.final()])
    return { iv: iv.toString('hex'), encryptedData: encrypted.toString('hex') }
}
const dc = require('@descope/node-sdk')
app.post('/api/auth/validation', async (req, res) => {
    const body = req.body
    try {
        if (body?.ssosessionToken && body?.refreshToken && body?.userId) {
            const sessionToken = body.ssosessionToken
            const refreshToken = body.refreshToken
            const client = dc.default({ projectId: process.env.SSO_PROJECT_ID })
            const authInfo = await client.validateAndRefreshSession(
                sessionToken,
                refreshToken
            )
            // const user = await client.management.user.loadByUserId(body.userId);
            if (authInfo.jwt) {
                User.findOne(
                    { email: body.userName },
                    {
                        _id: 1,
                        firstName: 1,
                        lastName: 1,
                        email: 1,
                        company: 1,
                        status: 1,
                        role: 1,
                        avatarUrl: 1,
                        createdBy: 1,
                    },
                    async (err, user) => {
                        if (err) {
                            res.status(500).json({ message: err.message })
                        } else if (!user) {
                            res.status(400).json({
                                message: 'Invalid Credentials',
                            })
                        } else {
                            let token = jwt.sign(
                                { id: user._id },
                                config.secret,
                                {
                                    expiresIn: 86400,
                                }
                            )
                            // let ctime = moment().format("MM/DD/YYYY hh:mm:ss");
                            // let logaudit = await common.UserLoginActivity(
                            //   user._id,
                            //   user.firstName,
                            //   ctime,
                            //   "LOG_IN"
                            // );
                            res.status(200).json({
                                // token: token,
                                user: user,
                                // loggedintime: ctime,
                            })
                        }
                    }
                )
            } else {
                res.status(400).json({ message: 'Login Failed' })
            }
        } else if (body.email && body.password) {
            User.findOne(
                { email: body.email, password: body.password },
                {
                    _id: 1,
                    firstName: 1,
                    lastName: 1,
                    email: 1,
                    company: 1,
                    status: 1,
                    role: 1,
                    avatarUrl: 1,
                    createdBy: 1,
                    company: 1,
                },
                async (err, user) => {
                    if (err) {
                        res.status(500).json({ message: err.message })
                    } else if (!user) {
                        res.status(400).json({ message: 'Invalid Credentials' })
                    } else {
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
                            user: user,
                        })
                    }
                }
            )
        } else {
            res.status(400).json({ message: 'Session token is required' })
        }
    } catch (error) {
        console.log('Could not validate user session', error)
        res.status(500).json({
            message: 'Could not validate user session',
            error: error.message,
        })
    }
})
app.post('/api/auth/getUser', async (req, res) => {
    let body = req.body
    if (!body.userName) {
        res.status(400).json({ message: 'User Name Required' })
    } else {
        User.findOne(
            { email: body?.userName },
            {
                _id: 1,
                firstName: 1,
                lastName: 1,
                email: 1,
                company: 1,
                status: 1,
                role: 1,
                avatarUrl: 1,
                createdBy: 1,
                isSSO: 1,
                company: 1,
            },
            async (err, user) => {
                if (err) {
                    res.status(500).json({ message: err.message })
                } else if (!user) {
                    res.status(400).json({ message: 'User Not Found' })
                } else {
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
                    res.status(200).json({
                        token: token,
                        user: user,
                        loggedintime: ctime,
                    })
                    // res.status(200).json({user: user});
                }
            }
        )
            .populate({ path: 'company', model: 'Company' })
            .populate({ path: 'role', model: 'Role' })
    }
})
const PORT = process.env.PORT || 5000
app.set('port', PORT)
// const server = app.listen(app.get("port"), () =>
//   logger.info(`Server is listening on ${app.get("port")}`)
// );
// websockets(server);
if (cluster.isMaster) {
    console.log(`Master process ${process.pid} is running`)
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork()
    }
    cluster.on('exit', (worker, code, signal) => {
        console.log(
            `Worker process ${worker.process.pid} died with code ${code} and signal ${signal}. Restarting...`
        )
        cluster.fork()
    })
} else {
    const server = app.listen(app.get('port'), () => {
        console.log(
            `Worker process ${process.pid} is listening on port ${app.get('port')}`
        )
    })
    server.on('error', (err) => {
        console.error(`Failed to start server in worker ${process.pid}:`, err)
    })
}
