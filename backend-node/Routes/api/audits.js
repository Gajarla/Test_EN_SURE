const express = require('express')
const router = express.Router()
const axios = require('axios')
const AuditCreation = require('../../Models/Audits')

//Get Projects By User ID
router.get('/Audit/collection/:name/:id', async (req, res) => {
    try {
        const audit = await AuditCreation.find({
            collectionName: req.params.name,
            documentId: req.params.id,
        })
        res.status(200).send(audit[0])
    } catch (err) {
        res.status(500).json({ message: err.message })
    }
})

module.exports = router
