const mongoose = require('mongoose')

const Audit = mongoose.model(
    'Audit',
    new mongoose.Schema({
        collectionName: String,
        documentId: String,
        company: String,
        resource: Object,
        log: [
            {
                action: String,
                who: String,
                state: mongoose.Schema.Types.Mixed,
                when: mongoose.Schema.Types.Date,
            },
        ],
    })
)

function cbe(err, email, action, collectionName, documentId, obj) {
    if (!err) return
    console.error('Error saving to Audit:')
    console.error('email:', email)
    console.error('action', action)
    console.error('collectionName:', collectionName)
    console.error('documentId:', documentId)
    console.error('object:', obj)
    console.error(err)
}

async function upsertAuditLog(
    collectionName,
    action,
    email,
    company,
    oldObject,
    newObject
) {
    try {
        const documentId = action === 'delete' ? oldObject._id : newObject._id
        const exist = await Audit.exists({
            documentId: documentId,
            company,
            collectionName: collectionName,
        })

        if (!exist) {
            await Audit.create({
                documentId: documentId,
                company,
                collectionName: collectionName,
                log: [],
            })
        }

        if (
            action === 'update' &&
            [
                'projects',
                'modules',
                'releases',
                'roles',
                'tags',
                'templates',
                'users',
            ].includes(collectionName)
        ) {
            const oldKeys = Object.keys(oldObject._doc || {})
            const newKeys = Object.keys(newObject._doc || {})
            const leftKeys = newKeys.filter((x) => !oldKeys.includes(x))
            const rightKeys = oldKeys.filter((x) => !newKeys.includes(x))
            const commKeys = oldKeys
                .filter((x) => newKeys.includes(x))
                .filter((x) => !['_id'].includes(x))

            for (const key of leftKeys) {
                const old = await Audit.findOne({
                    documentId: documentId,
                    company,
                    collectionName: collectionName,
                })
                if (old) {
                    old.log.push({
                        who: email,
                        action: 'key_create',
                        state: key,
                        when: new Date(),
                    })
                    try {
                        await old.save()
                    } catch (err) {
                        cbe(err, email, action, collectionName, documentId, key)
                    }
                }
            }

            for (const key of rightKeys) {
                const old = await Audit.findOne({
                    documentId: documentId,
                    company,
                    collectionName: collectionName,
                })
                if (old) {
                    old.log.push({
                        who: email,
                        action: 'key_delete',
                        state: key,
                        when: new Date(),
                    })
                    try {
                        await old.save()
                    } catch (err) {
                        cbe(err, email, action, collectionName, documentId, key)
                    }
                }
            }

            for (const key of commKeys) {
                if (oldObject[key] === newObject[key]) continue
                const old = await Audit.findOne({
                    documentId: documentId,
                    company,
                    collectionName: collectionName,
                })
                if (old) {
                    old.log.push({
                        who: email,
                        action: 'update',
                        state: {
                            key: key,
                            old: oldObject[key],
                            new: newObject[key],
                        },
                        when: new Date(),
                    })
                    try {
                        await old.save()
                    } catch (err) {
                        cbe(err, email, action, collectionName, documentId, key)
                    }
                }
            }
        } else {
            const obj = action === 'delete' ? oldObject : newObject
            const old = await Audit.findOne({
                documentId: documentId,
                company,
                collectionName: collectionName,
            })
            if (old) {
                old.log.push({
                    who: email,
                    action: action,
                    state: obj,
                    when: new Date(),
                })
                try {
                    await old.save()
                } catch (err) {
                    cbe(err, email, action, collectionName, documentId, obj)
                }
            }
        }
    } catch (err) {
        console.error('Unexpected error in upsertAuditLog:', err)
    }
}

async function getAudits(company) {
    return await Audit.find({ company })
}

module.exports = {
    Audit: Audit,
    upsertAuditLog: upsertAuditLog,
    getAudits: getAudits,
}
