const express = require("express");

const router = express.Router();

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

router.get("/", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("WHATSAPP_WEBHOOK_VERIFIED");
        return res.status(200).send(challenge);
    }
    console.log("WHATSAPP_WEBHOOK_VERIFICATION_FAILED");
    return res.sendStatus(403);
});

router.post("/", (req, res) => {
    console.log("WHATSAPP_WEBHOOK_RECEIVED");
    console.log(JSON.stringify(req.body, null, 2));

    res.sendStatus(200);
});

module.exports = router;