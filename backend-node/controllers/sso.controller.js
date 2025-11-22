const User = require('../Models/User')
const logger = require('../utils/logger')

exports.verify = async (req, res) => {
    if (req.body.email) {
        const user = await User.findOne({ email: req.body.email })
        if (!user) {
            return res.status(404).send('User not found')
        }
        res.send(user)
        try {
            const user = await User.findOne(
                { email: req.body.email },
                { isSSO: 1 }
            )

            if (!user) {
                // User does not exist, ask for password
                return res.status(400).json({ message: 'Invalid username' })
            }

            res.status(200).json({
                status: 200,
                message: 'User available',
                data: user,
            })
        } catch (err) {
            logger.error(
                `Error while finding user with email ${req.body.email}`,
                {
                    stack: err,
                }
            )
            // res.status(500).json({ message: err.message })
        }
    }
}
