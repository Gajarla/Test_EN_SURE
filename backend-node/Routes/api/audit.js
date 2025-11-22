const express = require("express");
const router = express.Router();
const axios = require("axios");
const AuditCreation = require("../../Models/Audits");

//Get Projects By User ID
router.get("/Audit/collection/:name/:id", async (req, res) => {
  try {
    const audit = await AuditCreation.find({
      collectionName: req.params.name,
      documentId: req.params.id,
    });
    res.status(200).send(audit[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

//Get Projects By User ID
router.get("/Audit/:company", async (req, res) => {
  const IGNORE = [undefined, null, ""];
  try {
    const audit = await AuditCreation.getAudits(req.params.company);
    let auditLogs = [];
    let counter = 1;
    audit.map((auditLog) => {
      auditLog.log.map((log) => {
        let auditLogObj = {};
        auditLogObj["id"] = counter;
        auditLogObj["user"] = log.who;
        auditLogObj["action"] = log.action;
        if (log.state.key === undefined) auditLogObj["object"] = "-";
        else auditLogObj["object"] = log.state.key;
        auditLogObj["collection"] = auditLog.collectionName;
        try {
          if (
            (log.state.name || log.state.suiteName || log.state.releaseName) &&
            log.action === "delete"
          ) {
            auditLogObj["oldValue"] =
              log.state.name || log.state.suiteName || log.state.releaseName;
            auditLogObj["resource"] = log.state;
          } else if (!IGNORE.includes(log.state.old))
            auditLogObj["oldValue"] = log.state.old;
          else auditLogObj["oldValue"] = "-";
        } catch (err) {
          auditLogObj["oldValue"] = "-";
        }
        try {
          if (
            (log.state.name || log.state.suiteName || log.state.releaseName) &&
            log.action === "create"
          ) {
            auditLogObj["newValue"] =
              log.state.name || log.state.suiteName || log.state.releaseName;
            auditLogObj["resource"] = log.state;
          } else if (!IGNORE.includes(log.state.new))
            auditLogObj["newValue"] = log.state.new;
          else auditLogObj["newValue"] = "-";
        } catch (err) {
          auditLogObj["newValue"] = "-";
        }
        auditLogObj["updatedAt"] = log.when;
        if (auditLogObj.oldValue.toString() !== auditLogObj.newValue.toString())
          auditLogs.push(auditLogObj);
        counter++;
      });
    });
    res.status(200).send(auditLogs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
