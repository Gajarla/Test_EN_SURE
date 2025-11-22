// require('dotenv').config()
import mongoose from 'mongoose'
import { connectDB } from './services.js'
import inputData from './input_data.js'
// import validations from './input_data.js'
import User from '../Models/User.js'
import Company from '../Models/Company.js'
import Role from '../Models/Role.js'
import Template from '../Models/Template.js'
import Validation from '../Models/Validation.js'
import roleManager from '../Models/RoleManager.js'
import crypto from 'crypto'

const { rolesData, validationData, roleManagersData } = inputData

await connectDB()

async function getCompanies() {
    let companies = []
    try {
        // await connectDB()
        companies = await Company.find() // Fetch all documents
    } catch (err) {
        console.error('Error creating collection:', err)
    } finally {
    }
    return companies
}

async function getRoles() {
    let roles = []
    try {
        // await connectDB()
        roles = await Role.find() // Fetch all documents
    } catch (err) {
        console.error('Error creating collection:', err)
    } finally {
    }
    return roles
}

async function getUsers() {
    let users = []
    try {
        // await connectDB()
        users = await User.find() // Fetch all documents
    } catch (err) {
        console.error('Error creating collection:', err)
    } finally {
    }
    return users
}

async function getTemplates() {
    let templates = []
    try {
        // await connectDB()
        templates = await Template.find() // Fetch all documents
    } catch (err) {
        console.error('Error creating collection:', err)
    } finally {
    }
    return templates
}

async function getValidations() {
    let validations = []
    try {
        // await connectDB()
        validations = await Validation.find() // Fetch all documents
    } catch (err) {
        console.error('Error creating collection:', err)
    } finally {
    }
    return validations
}

async function getRoleManagersData() {
    let roleManagers = []
    try {
        // await connectDB()
        roleManagers = await roleManager.find() // Fetch all documents
    } catch (err) {
        console.error('Error creating collection:', err)
    } finally {
    }
    return roleManagers
}

const companies = await getCompanies()
const roles = await getRoles()
const users = await getUsers()
const templates = await getTemplates()
const validations = await getValidations()
const roleManagers = await getRoleManagersData()
console.log('companies', companies)
console.log('users', users)

let companyFound = companies.find(
    (company) => company.company === process.env.COMPANY
)

let userFound = users.find((user) => user.email === process.env.ADMIN_EMAIL)

let templateFound = users.find(
    (template) => template.name === process.env.JENKINS_NAME
)

if (
    process.env.COMPANY &&
    process.env.COMPANY_CODE &&
    process.env.COMPANY_DESCRIPTION
) {
    let insertCompany = false
    if (companies.length === 0) {
        insertCompany = true
    } else if (companies.length >= 1) {
        if (companyFound) insertCompany = false
        else insertCompany = true
    }
    if (insertCompany) {
        let _newcompany = new Company({
            company: process.env.COMPANY,
            code: process.env.COMPANY_CODE,
            description: process.env.COMPANY_DESCRIPTION,
            status: 1,
        })
        companyFound = await _newcompany.save()
    }
}

console.log('companyFound', companyFound)
console.log('rolesData', rolesData)
console.log('roles', roles)

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

const db_roleData = await Promise.all(
    rolesData?.map(async (role) => {
        let roleFound = roles?.find((r) => r.roleName === role.roleName) // NOTE: Fixed '=' to '==='

        if (!roleFound) {
            let _newrole = new Role({
                roleID: role.roleID,
                roleName: role.roleName,
            })

            roleFound = await _newrole.save()
        }

        return roleFound
    })
)

console.log('db_roleData', db_roleData)

const adminRole = db_roleData.find((r) => r.roleID === 'R0001')
console.log('adminRole', adminRole)

const clientAdminRole = db_roleData.find((r) => r.roleID === 'R0002')
console.log('clientAdminRole', clientAdminRole)

if (
    process.env.ADMIN_FIRST_NAME &&
    process.env.ADMIN_LAST_NAME &&
    process.env.ADMIN_EMAIL &&
    process.env.ADMIN_PASSWORD
) {
    let insertUser = false
    if (users.length === 0) {
        insertUser = true
    } else if (users.length >= 1) {
        if (userFound) insertUser = false
        else insertUser = true
    }
    const encryptedText = encryptString(process.env.ADMIN_PASSWORD)
    if (insertUser) {
        const user = new User({
            firstName: process.env.ADMIN_FIRST_NAME,
            lastName: process.env.ADMIN_LAST_NAME,
            email: process.env.ADMIN_EMAIL,
            password: encryptedText,
            company: companyFound._id.toString(),
            status: 'active',
            role: adminRole._id.toString(),
            avatarUrl: '',
            createdBy: adminRole._id.toString(),
        })
        userFound = await user.save()
    }
}

console.log('userFound', userFound)

if (
    process.env.JENKINS_NAME &&
    process.env.JENKINS_ENDPOINT &&
    process.env.JENKINS_USERNAME &&
    process.env.JENKINS_API_TOKEN
) {
    let insertTemplate = false
    if (templates.length === 0) {
        insertTemplate = true
    } else if (templates.length >= 1) {
        if (templateFound) insertTemplate = false
        else insertTemplate = true
    }
    if (insertTemplate) {
        let _newtemplate = new Template({
            name: process.env.JENKINS_NAME,
            endpoint: process.env.JENKINS_ENDPOINT,
            username: process.env.JENKINS_USERNAME,
            password: process.env.JENKINS_API_TOKEN,
            companyID: companyFound._id.toString(),
            createdBy: adminRole._id.toString(),
            updatedBy: adminRole._id.toString(),
        })
        templateFound = await _newtemplate.save()
    }
}

console.log('templateFound', templateFound)

console.log('validations', validations)
if (validations.length === 0) {
    let _newvalidation = new Validation(validationData)
    const validations = await _newvalidation.save()
    console.log('validations', validations)
}
console.log('roleManagersData', roleManagersData)
if (roleManagers.length === 0) {
    const db_roleManagersData = await Promise.all(
        roleManagersData?.map(async (roleM) => {
            let _newRoleManagers = new roleManager(roleM)
            const roleManagers = await _newRoleManagers.save()

            return roleManagers
        })
    )

    console.log('db_roleManagersData', db_roleManagersData)
    // let _newRoleManagers = new roleManager(roleManagersData)
    // const roleManagers = await _newRoleManagers.save()
    // console.log('roleManagers', roleManagers)
}

await mongoose.disconnect()
