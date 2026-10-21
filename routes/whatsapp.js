const express = require("express");
const db = require("../database");
const { sendButtonMenu, sendTextMessage, sendCatalogMessage } = require("../services/whatsappService");
const { sendLeadEmail } = require("../services/emailService");
const router = express.Router();
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const pendingVerifications = new Map();
const enquiries = new Map(); 
const ENQUIRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const pendingOrders = new Map();
const NAME_NUDGE_MS = 5 * 60 * 1000;
const NAME_FINAL_MS = 15 * 60 * 1000;

const NAME_QUESTION_TEXT = "Thanks for your interest in the Veyora Energy Monitor! 😊\n\nMay I know your name so our customer executive can address you properly?";

const NAME_NUDGE_TEXT = "Just checking in 🙂 We're waiting for your name to complete your enquiry. Please reply with it whenever you're ready.";

const PRODUCT_NAMES = { oah2r3vifc: "Veyora Energy Monitor (4 Channel)", };

const FALLBACK_TEXT = 'Send "Hi" to continue.';

const LEAD_MARKER = "i would like to know more about the smart energy monitor";

const ENQUIRY_THANKS_TEXT = "Thank you for reaching out to us!\n\nOur customer executive will contact you within 24 hours.";

const ENQUIRY_EXISTS_TEXT = "You have already started an enquiry with us.\n\nKindly wait for our customer executive to contact you.";

const WELCOME_TEXT = `Welcome to Veyora! ⚡
Smarter Energy. Better Living.

Veyora builds smart energy solutions that help homes and businesses understand their electricity usage and make smarter decisions about it.

🌐 Know more about us: https://veyora.in/energy-monitor

Browse our products below 👇`;

const DEVICE_VERIFIED_TEXT = `Your Device ID has been received.
Please enter the Product Key associated with your Veyora device to verify ownership and continue with mobile registration.`;

const REGISTRATION_SUCCESS_TEXT = `✅ Mobile Number Registered Successfully!
You can now use WhatsApp to access your Veyora services.`;

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
        } else if (type === "reaction") {
            continue;
        } else if (type === "order") {
            if (!claimEnquiry(from)) continue;
            const items = (msg.order?.product_items || [])
                .map((i) => `${i.quantity} x ${PRODUCT_NAMES[i.product_retailer_id] || i.product_retailer_id} (₹${i.item_price})`)
                .join(", ");
            holdOrder(
                from,
                {
                    source: "WhatsApp catalog order",
                    orderItems: items || "-",
                    note: msg.order?.text || "",
                },
                value?.contacts?.[0]?.profile?.name
            );
            continue;
        } else {
            console.log(`Unsupported message type: ${type} from ${from}`);
            sendTextMessage(from, FALLBACK_TEXT).catch(() => {});
            continue;
        }
        const body = rawBody.toLowerCase();
        handleIncomingMessage(from, rawBody, body);
    }
});

function handleIncomingMessage(from, rawBody, body) {
    if (body === "cancel") {
        if (pendingVerifications.has(from)) {
            pendingVerifications.delete(from);
            sendTextMessage(
                from,
                "Operation cancelled. No changes have been made.\n\nSend HI whenever you're ready to start again."
            ).catch(() => {});
            return;
        }
    }
    if (pendingOrders.has(from) && rawBody) {
        completeOrder(from, rawBody);
        return;
    }
    db.getUserByWhatsapp(from, (err, user) => {
        if (err) {
            console.error("DB lookup error:", err.message);
            return;
        }
        if (isLeadMessage(rawBody)) {
            if (user) {
                handleGreeting(from, user);
            } else {
                handleLead(from, rawBody);
            }
            return;
        }
        const pending = pendingVerifications.get(from);
        if (pending && pending.step === "awaiting_deregister_device_id") {
            if (Date.now() - pending.lastActivity > 3 * 60 * 1000) {
                pendingVerifications.delete(from);
                sendTextMessage(
                    from,
                    "⌛ Your deregistration session has expired.\n\nSend DEREGISTER to try again."
                ).catch(() => {});
                return;
            }
            const deviceId = rawBody.trim();
            pendingVerifications.set(from, {
                step: "awaiting_deregister_product_key",
                deviceId,
                lastActivity: Date.now()
            });
            sendTextMessage(
                from,
                "🔐 Please enter the Product Key associated with your device to verify ownership."
            ).catch(() => {});
            return;
        }
        if (pending && pending.step === "awaiting_deregister_product_key") {
            if (Date.now() - pending.lastActivity > 3 * 60 * 1000) {
                pendingVerifications.delete(from);
                sendTextMessage(
                    from,
                    "⌛ Your deregistration session has expired.\n\nSend DEREGISTER to try again."
                ).catch(() => {});
                return;
            }
            const productKey = rawBody.trim();
            db.deregisterWhatsappNumberByDevice(
                pending.deviceId,
                productKey,
                from,
                (err, result) => {
                    if (err) {
                        if (err.code === "DEREGISTRATION_FAILED" || err.code === "NUMBER_NOT_LINKED") {
                            pendingVerifications.delete(from);
                            sendTextMessage(
                                from,
                                "❌ Verification failed. Please check your Device ID and Product Key, or contact Veyora Support."
                            ).catch(() => {});
                            return;
                        }
                        console.error("WhatsApp deregistration database error:", err.message);
                        sendTextMessage(
                            from,
                            "⚠️ We're experiencing a temporary issue. Please try again later."
                        ).catch(() => {});
                        return;
                    }
                    pendingVerifications.delete(from);
                    sendTextMessage(
                        from,
                        "✅ WhatsApp Number Deregistered Successfully!"
                    ).catch(() => {});
                }
            );
            return;
        }

        if (user) {
            if (body === "deregister") {
                pendingVerifications.set(from, {
                    step: "awaiting_deregister_device_id",
                    lastActivity: Date.now()
                });
                sendTextMessage(
                    from,
                    "📱 Veyora Number Deregistration\n\nPlease enter your Device ID to continue.\n\nSend CANCEL anytime to stop."
                ).catch(() => {});
                return;
            }
            if (isGreeting(body)) {
                handleGreeting(from, user);
            } else if (body === "explore") {
                sendCatalogMessage(from, "Browse the Veyora catalog 👇").catch(() => {});
            } else if (body === "support") {
                console.log(`Support selected by ${from}`);
            } else if (body === "my_devices") {
                console.log(`My Devices selected by ${from}`);
            } else {
                sendTextMessage(from, FALLBACK_TEXT).catch(() => {});
            }
            return;
        }
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
    const message = String(rawBody || "").trim();
    const command = message.toLowerCase();
    let pending = pendingVerifications.get(from);
    if (pending && Date.now() - pending.lastActivity > 3 * 60 * 1000) {
        pendingVerifications.delete(from);
        pending = null;
        sendTextMessage(
            from,
            "⌛ Your registration session has expired because there was no activity for 3 minutes.\n\nSend REGISTER to start again."
        ).catch(() => {});
        return;
    }
    if (!pending) {
        if (command === "register") {
            pendingVerifications.set(from, {
                step: "awaiting_device_id",
                lastActivity: Date.now()
            });
            sendTextMessage(
                from,
                "📱 Veyora Mobile Number Registration\n\nPlease enter your Device ID to continue.\n\nSend CANCEL anytime to stop."
            ).catch((e) => console.error("Registration prompt error:", e.message));
            return;
        }
        if (command === "catalog") {
            sendCatalogMessage(from, "Browse the Veyora catalog 👇").catch(() => {});
            return;
        }
        if (isGreeting(command)) {
            sendTextMessage(from, WELCOME_TEXT)
                .then(() =>
                    sendCatalogMessage(from, "Tap *View catalogue* to see our products and prices.")
                )
                .catch((e) => console.error("Welcome/catalog send error:", e.message));
            return;
        }
    sendTextMessage(from, FALLBACK_TEXT).catch(() => {});
    return;
    }
    pending.lastActivity = Date.now();
    pendingVerifications.set(from, pending);
    if (pending.step === "awaiting_device_id") {
        const deviceId = message;
        db.getDevice(deviceId, (err, device) => {
            if (err) {
                console.error("Device lookup error:", err.message);
                sendTextMessage(
                    from,
                    "⚠️ We're experiencing a temporary issue. Please try again."
                ).catch(() => {});
                return;
            }
            if (!device) {
                sendTextMessage(
                    from,
                    "❌ Device ID not found. Please check your Device ID and enter it again.\n\nSend CANCEL to stop."
                ).catch(() => {});
                return;
            }
            pendingVerifications.set(from, {
                step: "awaiting_product_key",
                deviceId,
                lastActivity: Date.now()
            });
            sendTextMessage(from, DEVICE_VERIFIED_TEXT).catch((e) =>
                console.error("Device verification prompt error:", e.message)
            );
        });
        return;
    }
    if (pending.step === "awaiting_product_key") {
        const productKey = message;
        db.registerWhatsappNumberByDevice(
            pending.deviceId,
            productKey,
            from,
            (err, result) => {
                if (err) {
                    if (err.code === "NUMBER_ALREADY_REGISTERED") {
                        pendingVerifications.delete(from);
                        sendTextMessage(
                            from,
                            "📱 This mobile number is already registered with an active Veyora account.\n\nIf you need assistance, please contact Veyora Support."
                        ).catch(() => {});
                        return;
                    }
                    if (err.code === "REGISTRATION_FAILED") {
                        pendingVerifications.delete(from);
                        sendTextMessage(
                            from,
                            "❌ Registration failed. Please check your Device ID and Product Key, then send REGISTER to try again."
                        ).catch(() => {});
                        return;
                    }
                    console.error(
                        "WhatsApp registration database error:",
                        err.message
                    );
                    sendTextMessage(
                        from,
                        "⚠️ We're experiencing a temporary issue. Please try again later."
                    ).catch(() => {});
                    return;
                }
                pendingVerifications.delete(from);
                sendTextMessage(
                    from,
                    REGISTRATION_SUCCESS_TEXT
                ).catch((e) =>
                    console.error("Registration success message error:", e.message)
                );
            }
        );
        return;
    }
}

function isLeadMessage(rawBody) {
    return rawBody.toLowerCase().includes(LEAD_MARKER);
}

function parseLead(rawBody) {
    const get = (label) => {
        const m = rawBody.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
        return m ? m[1].trim() : "-";
    };
    return {
        name: get("Name"),
        formPhone: get("Phone"),
        installType: get("Install at"),
        monthlyBill: get("Monthly bill"),
    };
}

function holdOrder(from, lead, profileName) {
    pendingOrders.set(from, {
        lead,
        profileName,
        nudgeTimer: setTimeout(() => {
            sendTextMessage(from, NAME_NUDGE_TEXT).catch(() => {});
        }, NAME_NUDGE_MS),
        finalTimer: setTimeout(() => completeOrder(from, null), NAME_FINAL_MS),
    });
    sendTextMessage(from, NAME_QUESTION_TEXT).catch(() => {});
}

function completeOrder(from, typedName) {
    const pending = pendingOrders.get(from);
    if (!pending) return;
    clearTimeout(pending.nudgeTimer);
    clearTimeout(pending.finalTimer);
    pendingOrders.delete(from);
    const name = typedName
        ? typedName.replace(/\s+/g, " ").trim().slice(0, 60)
        : null;
    const lead = {
        ...pending.lead,
        name: name || pending.profileName || "-",
        nameNote: name
            ? "typed by customer, not verified"
            : "customer did not give a name; this is their WhatsApp profile name",
    };
    sendTextMessage(
        from,
        name
            ? `Thank you for reaching out to us, ${name} !\n\nOur customer executive will contact you within 24 hours.`
            : ENQUIRY_THANKS_TEXT
    ).catch(() => {});
    sendLeadEmail(lead, from).catch((e) =>
        console.error("Order email failed:", e.message)
    );
}

function claimEnquiry(from) {
    const last = enquiries.get(from);
    if (last && Date.now() - last < ENQUIRY_WINDOW_MS) {
        sendTextMessage(from, ENQUIRY_EXISTS_TEXT).catch(() => {});
        return false;
    }
    enquiries.set(from, Date.now());
    return true;
}

function registerEnquiry(from, lead) {
    if (!claimEnquiry(from)) return;
    sendTextMessage(from, ENQUIRY_THANKS_TEXT).catch(() => {});
    sendLeadEmail(lead, from).catch((e) =>
        console.error("Lead email failed:", e.message)
    );
}

function handleLead(from, rawBody) {
    registerEnquiry(from, { source: "Website form", ...parseLead(rawBody) });
}

function isGreeting(body) {
    return /^(hi|hello|hey|hii)[\s!.]*$/.test(body);
}

module.exports = router;