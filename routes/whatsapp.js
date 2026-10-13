const express = require("express");
const db = require("../database");
const { sendButtonMenu, sendTextMessage } = require("../services/whatsappService");
const router = express.Router();
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const pendingVerifications = new Map();

const WELCOME_TEXT = `Welcome to Veyora!
Smarter Energy. Better Living. ⚡

Veyora helps you monitor your electricity consumption, understand your energy usage, identify energy-saving opportunities, and make smarter decisions about your electricity consumption.

With Veyora, you can:
⚡ Monitor energy consumption in real time.
📊 Analyse your electricity usage.
💡 Discover opportunities to save energy.
📈 Track your energy consumption history.

🌐 Discover Veyora!
Visit our website to explore our products, learn about their features, and discover how Veyora can help you manage your energy smarter.
🔗 https://veyora.in

Let's make energy smarter! 🚀

📝 Note (for existing customers): If you want to change your registered mobile number, enter your Device ID to continue.`;

const DEVICE_VERIFIED_TEXT = `🔐 Device Verification
Your Device ID has been received.
Please enter the Product Key associated with your Veyora device to verify ownership and continue with mobile registration.`;

const REGISTRATION_SUCCESS_TEXT = `✅ Mobile Number Registered Successfully!
Your WhatsApp number has been registered with your Veyora device.
You can now use WhatsApp to access your Veyora services.

Welcome aboard! ⚡
Veyora — Smarter Energy. Better Living.`;

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
    res.sendStatus(200);
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    if (!messages || messages.length === 0) {
        console.log("Webhook received without incoming messages.");
        return;
    }
    for (const msg of messages) {
        const from = msg.from;
        const type = msg.type;
        let rawBody = "";
        if (type === "text") {
            rawBody = msg.text?.body?.trim() || "";
        } else if (type === "button") {
            rawBody = msg.button?.text?.trim() || "";
        } else if (type === "interactive") {
            const interactive = msg.interactive;
            if (interactive?.type === "button_reply") {
                rawBody = interactive.button_reply?.id || "";
            } else if (interactive?.type === "list_reply") {
                rawBody = interactive.list_reply?.id || "";
            }
            rawBody = rawBody.trim();
        } else {
            console.log(`Unsupported message type: ${type} from ${from}`);
            continue;
        }
        const body = rawBody.toLowerCase();
        console.log(`SENDER: ${from} | TYPE: ${type} | MESSAGE: "${rawBody}"`);
        handleIncomingMessage(from, rawBody, body);
    }
});

function handleIncomingMessage(from, rawBody, body) {
    db.getUserByWhatsapp(from, (err, user) => {
        if (err) {
            console.error("DB lookup error:", err.message);
            return;
        }
        if (user) {
            // Registered number — existing menu flow
            if (body === "hi" || body === "hello") {
                handleGreeting(from, user);
            } else if (body === "explore") {
                console.log(`Explore selected by ${from}`);
            } else if (body === "support") {
                console.log(`Support selected by ${from}`);
            } else if (body === "my_devices") {
                console.log(`My Devices selected by ${from}`);
            }
            return;
        }
        // Unregistered number — verification flow
        handleUnregisteredFlow(from, rawBody);
    });
}

function handleGreeting(from, user) {
    sendButtonMenu(
        from,
        `Welcome back, ${user.username}! What would you like to do?`,
        [
            { id: "explore", title: "Explore" },
            { id: "support", title: "Support" },
            { id: "my_devices", title: "My Devices" },
        ]
    ).catch((e) => console.error("Menu send error:", e.message));
}

function handleUnregisteredFlow(from, rawBody) {
    const pending = pendingVerifications.get(from);
    if (!pending) {
        // First contact — send welcome, start the flow
        pendingVerifications.set(from, { step: "awaiting_device_id" });
        sendTextMessage(from, WELCOME_TEXT).catch((e) =>
            console.error("Welcome send error:", e.message)
        );
        return;
    }
    if (pending.step === "awaiting_device_id") {
        const deviceId = rawBody; // device IDs are case-sensitive, keep raw
        db.getDevice(deviceId, (err, device) => {
            if (err) {
                console.error("Device lookup error:", err.message);
                return;
            }
            if (!device) {
                sendTextMessage(
                    from,
                    "❌ Device ID not found. Please check and enter your Device ID again."
                ).catch((e) => console.error("Send error:", e.message));
                return; // stay on awaiting_device_id, let them retry
            }
            pendingVerifications.set(from, {
                step: "awaiting_product_key",
                deviceId,
            });
            sendTextMessage(from, DEVICE_VERIFIED_TEXT).catch((e) =>
                console.error("Send error:", e.message)
            );
        });
        return;
    }
    if (pending.step === "awaiting_product_key") {
        const productKey = rawBody;
        db.getDevice(pending.deviceId, (err, device) => {
            if (err) {
                console.error("Device lookup error:", err.message);
                return;
            }
            if (!device || device.product_key !== productKey) {
                sendTextMessage(
                    from,
                    "❌ Incorrect Product Key. Please try again."
                ).catch((e) => console.error("Send error:", e.message));
                return; // stay on awaiting_product_key, let them retry
            }
            db.linkWhatsappNumberToDevice(pending.deviceId, from, (linkErr) => {
                if (linkErr) {
                    console.error("Linking error:", linkErr.message);
                    sendTextMessage(
                        from,
                        "⚠️ Something went wrong linking your number. Please try again later."
                    ).catch(() => {});
                    return;
                }
                pendingVerifications.delete(from);
                sendTextMessage(from, REGISTRATION_SUCCESS_TEXT).catch((e) =>
                    console.error("Send error:", e.message)
                );
            });
        });
        return;
    }
}

module.exports = router;