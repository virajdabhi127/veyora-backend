// {
//   "object": "whatsapp_business_account",
//   "entry": [
//     {
//       "id": "28161412583558706",
//       "changes": [
//         {
//           "value": {
//             "messaging_product": "whatsapp",
//             "metadata": {
//               "display_phone_number": "919429587233",
//               "phone_number_id": "1366092386585389"
//             },
//             "contacts": [
//               {
//                 "profile": { "name": "Viraj Dabhi" },
//                 "wa_id": "919409205916"
//               }
//             ],
//             "messages": [
//               {
//                 "from": "919409205916",
//                 "id": "wamid.test123",
//                 "timestamp": "1791898182",
//                 "text": { "body": "hi" },
//                 "type": "text"
//               }
//             ]
//           },
//           "field": "messages"
//         }
//       ]
//     }
//   ]
// }
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

async function sendButtonMenu(to, bodyText, buttons) {
  // buttons: array of { id, title } — max 3, title max 20 chars
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
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
    console.error(`Button menu send failed for ${to}:`, JSON.stringify(detail));
    return { success: false, error: detail };
  }
}

async function sendTextMessage(to, text) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
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
    console.error(`Text send failed for ${to}:`, JSON.stringify(detail));
    return { success: false, error: detail };
  }
}

module.exports = { sendWelcomeMessage, sendTemplate, sendButtonMenu, sendTextMessage };