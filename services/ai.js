const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

async function callGemini(prompt, responseSchema, maxRetries = 4) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await ai.models.generateContent({
                model: "gemini-3.6-flash",
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema,
                    maxOutputTokens: 2000
                }
            });
            const text = response.text;
            if (!text) {
                throw new Error("Gemini returned an empty response");
            }
            return JSON.parse(text);
        } catch (error) {
            lastError = error;
            const status =
                error?.status ||
                error?.response?.status ||
                error?.code;
            console.error(
                `GEMINI ATTEMPT ${attempt + 1} FAILED:`,
                error?.message || error
            );
            const retryable =
                status === 429 ||
                status === 500 ||
                status === 502 ||
                status === 503 ||
                status === 504;
            if (!retryable || attempt === maxRetries) {
                throw error;
            }
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`Retrying Gemini in ${delay / 1000} seconds...`);
            await new Promise(resolve =>
                setTimeout(resolve, delay)
            );
        }
    }
    throw lastError;
}

async function testAI() {
    const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents:
            "Say hello to Veyora in one short sentence."
    });
    return response.text;
}

async function analyzeEnergy(data) {
    const prompt = `
You are Veyora's energy intelligence assistant.

Analyze the following energy-monitoring data.

The Veyora backend is the source of truth.

IMPORTANT RULES:

- Use ONLY the supplied data.
- Never invent measurements.
- Never modify numerical values.
- Never recalculate backend values.
- Clearly distinguish observations from predictions.
- Give practical and safe energy-saving suggestions.
- Do not provide dangerous electrical instructions.
- If data is insufficient, clearly state that.
- Return only valid JSON.

Required JSON structure:

{
    "summary": "short overall summary",
    "observations": [
        "observation 1",
        "observation 2"
    ],
    "concerns": [
        "concern 1"
    ],
    "suggestions": [
        "suggestion 1",
        "suggestion 2"
    ]
}

Veyora data:

${JSON.stringify(data, null, 2)}
`;

    const responseSchema = {
        type: "object",
        properties: {
            summary: {
                type: "string"
            },
            observations: {
                type: "array",
                items: {
                    type: "string"
                }
            },
            concerns: {
                type: "array",
                items: {
                    type: "string"
                }
            },
            suggestions: {
                type: "array",
                items: {
                    type: "string"
                }
            }
        },
        required: [
            "summary",
            "observations",
            "concerns",
            "suggestions"
        ]
    };
    return await callGemini(
        prompt,
        responseSchema
    );
}

async function explainPrediction(data) {

    const prompt = `
You are Veyora's energy intelligence assistant.

The Veyora backend has already calculated an energy prediction.

Your job is ONLY to explain the backend's prediction.
DO NOT recalculate the prediction.
DO NOT modify any numerical values.
DO NOT create your own prediction.
Use only the values supplied below.

IMPORTANT RULES:

- Backend calculations are authoritative.
- Historical values are observations.
- Predicted values are predictions.
- If historical data is limited, mention it.
- If anomalies were excluded by the backend, explain that.
- Do not invent missing months.
- Do not invent energy consumption.
- Do not calculate a different prediction.
- Give practical and safe suggestions.
- Return valid JSON only.

Required JSON structure:

{
    "summary": "short explanation",
    "trend": "increasing | decreasing | stable",
    "predictionExplanation": "explain how the backend prediction should be interpreted",
    "concerns": [
        "concern 1"
    ],

    "suggestions": [
        "suggestion 1",
        "suggestion 2"
    ]
}

Backend prediction data:

${JSON.stringify(data, null, 2)}
`;

    const responseSchema = {
        type: "object",
        properties: {
            summary: {
                type: "string"
            },
            trend: {
                type: "string",
                enum: [
                    "increasing",
                    "decreasing",
                    "stable"
                ]
            },
            predictionExplanation: {
                type: "string"
            },
            concerns: {
                type: "array",
                items: {
                    type: "string"
                }
            },
            suggestions: {
                type: "array",
                items: {
                    type: "string"
                }
            }
        },
        required: [
            "summary",
            "trend",
            "predictionExplanation",
            "concerns",
            "suggestions"
        ]
    };
    return await callGemini(
        prompt,
        responseSchema
    );
}

async function analyzeChannels(data) {
    const prompt = `
You are Veyora's energy intelligence assistant.

Analyze the following Veyora channel-energy data.

IMPORTANT:

The channel energy values are CUMULATIVE energy readings.
The backend has already calculated:

- first cumulative reading
- last cumulative reading
- consumed energy
- contribution percentage
- dominant channel

DO NOT sum cumulative readings.
DO NOT recalculate consumed energy.
DO NOT modify backend-calculated values.

Your job is ONLY to interpret the supplied results.

IMPORTANT RULES:

1. Use only supplied backend data.
2. Do not invent channel readings.
3. Do not add channels that are not supplied.
4. Do not sum cumulative readings.
5. Do not recalculate percentages.
6. Explain which channels contribute more or less.
7. Mention unusual usage only when supported by the data.
8. Give practical and safe suggestions.
9. Return valid JSON only.

Required JSON structure:

{
    "summary": "overall channel usage summary",
    "channelInsights": [
        {
            "channelId": "1",
            "insight": "explanation of this channel's usage"
        }
    ],
    "dominantChannel": "channel id",
    "concerns": [
        "concern 1"
    ],
    "suggestions": [
        "suggestion 1",
        "suggestion 2"
    ]
}

Channel data:

${JSON.stringify(data, null, 2)}
`;

    const responseSchema = {
        type: "object",
        properties: {
            summary: {
                type: "string"
            },
            channelInsights: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        channelId: {
                            type: "string"
                        },

                        insight: {
                            type: "string"
                        }
                    },
                    required: [
                        "channelId",
                        "insight"
                    ]
                }
            },
            dominantChannel: {
                type: "string"
            },
            concerns: {
                type: "array",
                items: {
                    type: "string"
                }
            },
            suggestions: {
                type: "array",
                items: {
                    type: "string"
                }
            }
        },
        required: [
            "summary",
            "channelInsights",
            "dominantChannel",
            "concerns",
            "suggestions"
        ]
    };
    return await callGemini(
        prompt,
        responseSchema
    );
}

module.exports = {
    testAI,
    analyzeEnergy,
    explainPrediction,
    analyzeChannels
};