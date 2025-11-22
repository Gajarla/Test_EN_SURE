// smbClient.js
const SMB2 = require('smb2')
const { promisify } = require('util')

const smb2Client = new SMB2({
    share: process.env.SMB_SHARE,
    domain: process.env.SMB_DOMAIN,
    username: process.env.SMB_USERNAME,
    password: process.env.SMB_PASSWORD,
    autoCloseTimeout: 0,
})

module.exports = {
    readFile: promisify(smb2Client.readFile).bind(smb2Client),
    readdir: promisify(smb2Client.readdir).bind(smb2Client),
    writeFile: promisify(smb2Client.writeFile).bind(smb2Client),
    unlink: promisify(smb2Client.unlink).bind(smb2Client),
    mkdir: promisify(smb2Client.mkdir).bind(smb2Client),
}
