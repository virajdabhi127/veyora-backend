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
            `Name: ${lead.name}\n\n` +
            `WhatsApp: +${from}\n\n` +
            `Phone (form): ${lead.formPhone}\n\n` +
            `Install at: ${lead.installType}\n\n` +
            `Monthly bill: ${lead.monthlyBill}\n\n`,
    });
}

module.exports = { sendLeadEmail };