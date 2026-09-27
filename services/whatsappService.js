const axios = require('axios');

const WHATSAPP_API_URL = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * Generic template sender.
 * @param {string} to - E.164 number without '+', e.g. '919876543210'
 * @param {string} templateName - approved template name in WhatsApp Manager
 * @param {object} options
 * @param {string[]} [options.bodyParams] - ordered values for {{1}}, {{2}}... in the BODY
 * @param {string[]} [options.headerParams] - ordered values for {{1}}... in the HEADER
 */
async function sendTemplate(to, templateName, { bodyParams = [], headerParams = [] } = {}) {
  const components = [];

  if (headerParams.length > 0) {
    components.push({
      type: 'header',
      parameters: headerParams.map((text) => ({ type: 'text', text: String(text) })),
    });
  }

  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })),
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  try {
    const res = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    return { success: true, id: res.data?.messages?.[0]?.id };
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`WhatsApp send failed for ${to} (${templateName}):`, JSON.stringify(detail));
    return { success: false, error: detail };
  }
}

/**
 * Sends the approved "veyora_summary" daily template.
 * All 6 variables are in the BODY.
 * @param {string} to
 * @param {object} data - { name, date, kwh, cost, peakW, tip }
 */
function sendDailySummary(to, data) {
  return sendTemplate(to, 'veyora_summary', {
    bodyParams: [data.name, data.date, data.kwh, data.cost, data.peakW, data.tip],
  });
}

/**
 * Sends the approved "veyora_welcome" template when a new user is created.
 * The {{1}} variable is in the HEADER ("Welcome to Veyora, {{1}}"), not the body.
 * @param {string} to
 * @param {object} data - { name }
 */
function sendWelcomeMessage(to, data) {
  return sendTemplate(to, 'veyora_welcome', {
    headerParams: [data.name],
  });
}

module.exports = { sendDailySummary, sendWelcomeMessage, sendTemplate };