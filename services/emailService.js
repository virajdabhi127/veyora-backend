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

module.exports = { sendLeadEmail };