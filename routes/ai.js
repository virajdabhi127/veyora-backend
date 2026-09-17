const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/auth");
const database = require("../database");
const {
    analyzeEnergy,
    explainPrediction,
    analyzeChannels
} = require("../services/ai");

router.get("/:deviceId/analyze", authenticate, async (req, res) => {
    const deviceId = req.params.deviceId;
    const userId = req.user.user_id;
    try {
        const device = await new Promise((resolve, reject) => {
            database.getUserDevice(
                deviceId,
                userId,
                (err, device) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(device);
                }
            );
        });
        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found."
            });
        }
        const energy = await new Promise((resolve, reject) => {
            database.getDailyEnergy(
                deviceId,
                (err, energy) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(energy);
                }
            );
        });
        const monthlyEnergy = await new Promise((resolve, reject) => {
            database.getMonthlyEnergy(
                deviceId,
                (err, energy) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(energy);
                }
            );
        });
        const dailyLoad = await new Promise((resolve, reject) => {
            database.getDailyLoad(
                deviceId,
                (err, load) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(load);
                }
            );
        });
        const aiData = {
            device: {
                deviceId: device.deviceId,
                productCode: device.productCode,
                channelCount: device.channelCount
            },
            energy: {
                todayKWh: energy.today,
                yesterdayKWh: energy.yesterday,
                currentMonthKWh: monthlyEnergy.currentMonth,
                previousMonthKWh: monthlyEnergy.previousMonth
            },
            cost: {
                today: monthlyEnergy.todayCost,
                currentMonth: monthlyEnergy.monthlyCost
            },
            load: dailyLoad
                ? {
                    peakLoadW: dailyLoad.peak_load,
                    peakLoadTime: dailyLoad.peak_load_time,
                    baseLoadW: dailyLoad.base_load
                }
                : null
        };
        const analysis = await analyzeEnergy(aiData);
        res.json({
            success: true,
            deviceId,
            analysis
        });
    } catch (error) {
        console.error("AI_ANALYSIS_ERROR:", error);
        res.status(500).json({
            success: false,
            message: "AI analysis failed."
        });
    }
});

router.get("/:deviceId/predict", authenticate, async (req, res) => {
    const deviceId = req.params.deviceId;
    const userId = req.user.user_id;
    try {
        // --------------------------------------------------
        // 1. Verify device ownership
        // --------------------------------------------------
        const device = await new Promise((resolve, reject) => {
            database.getUserDevice(
                deviceId,
                userId,
                (err, device) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(device);
                }
            );
        });
        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found."
            });
        }
        // --------------------------------------------------
        // 2. Get monthly historical energy
        // --------------------------------------------------
        const history = await new Promise((resolve, reject) => {
            database.getMonthlyEnergyHistory(
                deviceId,
                12,
                (err, history) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(history);
                }
            );
        });
        // --------------------------------------------------
        // 3. Identify current month
        // --------------------------------------------------
        const now = new Date();
        const currentMonth =
            `${now.getFullYear()}-${
                String(now.getMonth() + 1).padStart(2, "0")
            }-01`;
        // --------------------------------------------------
        // 4. Use only completed months
        // --------------------------------------------------
        const completedMonths = history.filter(item => {
            const month = new Date(item.month).toISOString().slice(0, 10);
            return month !== currentMonth;
        });
        // --------------------------------------------------
        // 5. Check minimum history
        // --------------------------------------------------
        if (completedMonths.length < 2) {
            return res.status(400).json({
                success: false,
                message:
                    "Not enough historical monthly data for prediction.",
                availableMonths: completedMonths.length
            });
        }
        // --------------------------------------------------
        // 6. Get energy values
        // --------------------------------------------------
        const values = completedMonths.map( item => item.energyKWh );
        // --------------------------------------------------
        // 7. Calculate median
        // --------------------------------------------------
        const sortedValues = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sortedValues.length / 2);
        let median;
        if (sortedValues.length % 2 === 0) {
            median = ( sortedValues[middle - 1] + sortedValues[middle]) / 2;
        } else {
            median = sortedValues[middle];
        }
        // --------------------------------------------------
        // 8. Detect extreme spikes
        // --------------------------------------------------
        const anomalies = completedMonths
            .filter(item => {
                if (median === 0) {
                    return item.energyKWh > 0;
                }
                return item.energyKWh > median * 5;
            })
            .map(item => ({
                month: item.month,
                energyKWh: item.energyKWh,
                type: "extreme_spike"
            }));
        // --------------------------------------------------
        // 9. Remove extreme spikes from prediction
        // --------------------------------------------------
        let predictionValues =
            values.filter(value => {
                if (median === 0) {
                    return value === 0;
                }
                return value <= median * 5;
            });
        // If removing anomalies leaves too little data,
        // use all available values instead.
        if (predictionValues.length < 2) {
            predictionValues = [...values];
        }
        // --------------------------------------------------
        // 10. Use most recent 3 normal months
        // --------------------------------------------------
        const recentPredictionValues =
            predictionValues.slice(
                -Math.min(3, predictionValues.length)
            );
        // --------------------------------------------------
        // 11. Calculate predicted energy
        // --------------------------------------------------
        const predictedEnergyKWh =
            recentPredictionValues.reduce(
                (sum, value) => sum + value,
                0
            ) / recentPredictionValues.length;
        // --------------------------------------------------
        // 12. Calculate predicted cost
        // --------------------------------------------------
        const predictedCost =database.calculatePGVCLCost(predictedEnergyKWh);
        // --------------------------------------------------
        // 13. Determine trend
        // --------------------------------------------------
        const firstValue = values[0];
        const lastValue = values[values.length - 1];
        let trend = "stable";
        if (lastValue > firstValue * 1.10) {
            trend = "increasing";
        } else if (lastValue < firstValue * 0.90) {
            trend = "decreasing";
        }
        // --------------------------------------------------
        // 14. Determine confidence
        // --------------------------------------------------
        let confidence = "low";
        if (
            completedMonths.length >= 6 &&
            anomalies.length === 0
        ) {
            confidence = "medium";
        }
        if (
            completedMonths.length >= 12 &&
            anomalies.length === 0
        ) {
            confidence = "high";
        }
        // Any anomaly makes confidence low
        if (anomalies.length > 0) {
            confidence = "low";
        }
        // --------------------------------------------------
        // 15. THIS IS predictionData
        // --------------------------------------------------
        const predictionData = {
            device: {
                deviceId: device.deviceId,
                productCode: device.productCode,
                channelCount: device.channelCount
            },
            historicalData: completedMonths,
            prediction: {
                predictedEnergyKWh,
                predictedCost,
                trend,
                confidence
            },
            dataQuality: {
                historicalMonthsAvailable: completedMonths.length,
                anomaliesDetected: anomalies.length
            },
            anomalies,
            methodology: {
                method: "Outlier-aware recent 3-month average",
                historicalMonthsUsed: recentPredictionValues.length,
                outliersExcludedFromPrediction: anomalies.length
            }
        };
        // --------------------------------------------------
        // 16. Send data to Gemini
        // --------------------------------------------------
        const explanation = await explainPrediction(predictionData);
        // --------------------------------------------------
        // 17. THIS IS res.json
        // --------------------------------------------------
        res.json({
            success: true,
            deviceId,
            prediction: {
                predictedEnergyKWh,
                predictedCost,
                trend,
                confidence
            },
            historicalData: completedMonths,
            dataQuality: {
                historicalMonthsAvailable: completedMonths.length,
                anomaliesDetected: anomalies.length
            },
            anomalies,
            methodology: {
                method: "Outlier-aware recent 3-month average",
                historicalMonthsUsed: recentPredictionValues.length,
                outliersExcludedFromPrediction: anomalies.length
            },
            ai: explanation
        });
    } catch (error) {
        console.error(
            "AI_PREDICTION_ERROR:",
            error
        );
        res.status(500).json({
            success: false,
            message: "Energy prediction failed."
        });
    }
});

router.get("/:deviceId/channels", authenticate, async (req, res) => {
    const deviceId = req.params.deviceId;
    const userId = req.user.user_id;
    try {
        // --------------------------------------------------
        // 1. Verify device ownership
        // --------------------------------------------------
        const device = await new Promise((resolve, reject) => {
            database.getUserDevice(
                deviceId,
                userId,
                (err, device) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(device);
                }
            );

        });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found."
            });

        }
        // --------------------------------------------------
        // 2. Get channel history
        // --------------------------------------------------
        const history = await new Promise((resolve, reject) => {
            database.getChannelEnergyHistory(
                deviceId,
                1,
                (err, history) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(history);
                }
            );
        });
               // --------------------------------------------------
        // 3. Calculate channel consumption from cumulative data
        // --------------------------------------------------
        const channelStats = {};
        history.forEach(row => {
            const channelEnergy = row.channel_energy || {};
            Object.entries(channelEnergy).forEach(([channelId, value]) => {
                    const energy = Number(value);
                    if (!Number.isFinite(energy)) {
                        return;
                    }
                    if (!channelStats[channelId]) {
                        channelStats[channelId] = {
                            channelId,
                            firstReading: energy,
                            lastReading: energy,
                            peakCumulative: energy,
                            readings: 1
                        };
                    } else {
                        channelStats[channelId].lastReading = energy;
                        channelStats[channelId].readings += 1;
                        if (
                            energy >
                            channelStats[channelId].peakCumulative
                        ) {
                            channelStats[channelId].peakCumulative = energy;
                        }
                    }
                });
        });
        // --------------------------------------------------
        // 4. Calculate consumed energy
        // --------------------------------------------------
        const channelList = Object.values(channelStats).map(channel => {
                    let consumedEnergy = channel.lastReading - channel.firstReading;
                    // Handle possible meter reset
                    if (consumedEnergy < 0) {
                        consumedEnergy = 0;
                    }
                    return {
                        channelId: channel.channelId,
                        firstCumulativeKWh: channel.firstReading,
                        lastCumulativeKWh: channel.lastReading,
                        consumedEnergyKWh: consumedEnergy,
                        readings: channel.readings
                    };
                });
        // --------------------------------------------------
        // 5. Total channel consumption
        // --------------------------------------------------
        const totalChannelEnergy =
            channelList.reduce(
                (sum, channel) =>
                    sum + channel.consumedEnergyKWh,
                0
            );
        // --------------------------------------------------
        // 6. Calculate channel contribution
        // --------------------------------------------------
        channelList.forEach(channel => {
            channel.contributionPercentage =
                totalChannelEnergy > 0
                    ? (
                        channel.consumedEnergyKWh /
                        totalChannelEnergy
                    ) * 100
                    : 0;
        });
        // --------------------------------------------------
        // 7. Sort highest consumption first
        // --------------------------------------------------
        channelList.sort(
            (a, b) =>
                b.consumedEnergyKWh -
                a.consumedEnergyKWh
        );
        // --------------------------------------------------
        // 8. Dominant channel
        // --------------------------------------------------
        const dominantChannel =
            channelList.length > 0
                ? channelList[0].channelId
                : null;
        // --------------------------------------------------
        // 9. Prepare AI data
        // --------------------------------------------------
        const channelData = {
            device: {
                deviceId: device.deviceId,
                productCode: device.productCode,
                channelCount: device.channelCount
            },
            channels: channelList,
            totalChannelEnergy,
            dominantChannel,
            dataPeriod: "Last 1 month",
            dataType: "Cumulative energy readings"
        };
        // --------------------------------------------------
        // 10. Gemini analysis
        // --------------------------------------------------
        const ai = await analyzeChannels(channelData);
        // --------------------------------------------------
        // 11. Return response
        // --------------------------------------------------
        res.json({
            success: true,
            deviceId,
            channels: channelList,
            totalChannelEnergy,
            dominantChannel,
            dataPeriod: "Last 1 month",
            ai
        });
    } catch (error) {
        console.error(
            "AI_CHANNEL_ANALYSIS_ERROR:",
            error
        );
        res.status(500).json({
            success: false,
            message: "Channel analysis failed."
        });
    }
});

module.exports = router;