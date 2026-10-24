const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

async function sendLeadEmail(lead, from) {
    const to = process.env.LEAD_EMAIL_TO;
    if (!to) {
        console.error("LEAD_EMAIL_TO is not set in .env");
        return;
    }
    await transporter.sendMail({
        from: `"Veyora Leads" <${process.env.SMTP_USER}>`,
        to,
        subject: `New Veyora Lead: ${lead.name}`,
        text:
            `Source: ${lead.source || "Website form"}\n` +
            `Name: ${lead.name}${lead.nameNote ? ` (${lead.nameNote})` : ""}\n` +
            `WhatsApp: +${from}\n` +
            `Tap to chat: https://wa.me/${from}\n` +
            (lead.formPhone ? `Phone (form): ${lead.formPhone}\n` : "") +
            (lead.installType ? `Install at: ${lead.installType}\n` : "") +
            (lead.monthlyBill ? `Monthly bill: ${lead.monthlyBill}\n` : "") +
            (lead.orderItems ? `Ordered: ${lead.orderItems}\n` : "") +
            (lead.note ? `Customer note: ${lead.note}\n` : ""),
    });
}

async function sendComplaintEmail(c, from) {
    const to = process.env.SUPPORT_EMAIL_TO || process.env.LEAD_EMAIL_TO;
    if (!to) throw new Error("SUPPORT_EMAIL_TO / LEAD_EMAIL_TO is not set");
    await transporter.sendMail({
        from: `"Veyora Support" <${process.env.SMTP_USER}>`,
        to,
        subject: `New Complaint: ${c.name} (${c.deviceIds})`,
        text:
            `Name: ${c.name}\n` +
            `Device ID: ${c.deviceIds}\n\n` +
            `Problem:\n${c.problem}\n\n` +
            `WhatsApp: +${from}\n` +
            `Tap to chat: https://wa.me/${from}\n`,
    });
}

module.exports = { sendLeadEmail, sendComplaintEmail };