// Every terminal that runs a Node.js script must load dotenv
// The below line does that job
require('dotenv').config()
const connectDB = require('../config/db')

const edit = require('../migration/updateCompanyOrProject')

// This job is specifically used to update Company and Project attributes
// against older records for different tables

// Cannot use Promise.allSettled below as the first three functions
// needs to be executed sequentially

const updateCompanyOrProject = async () => {
    try {
        const db = await connectDB()
        await edit.updateCompanyForModules()
        await edit.updateCompanyAndProjectForReleases()
        await edit.updateCompanyAndProjectForJobs()
        // await edit.updateCompanyAndProjectForDefects()
        await edit.updateCompanyForUserAudits()
        await edit.updateCompanyForLoginActivities()
        console.log('All updates completed successfully!')
        process.exit(0)
    } catch (error) {
        console.error('Error updating company or project:', error)
        process.exit(1)
    }
}

updateCompanyOrProject()
