const express = require("express");
const router = express.Router();

const database = require("../database");
const mqtt = require("../mqtt");
const config = require("../config");
const authenticate = require("../middleware/auth");
const requireAdmin = require("../middleware/admin");

router.use(authenticate);
router.use(requireAdmin);

function isValidProductCode(productCode) {
    return Object.values(config.productCodes).includes(productCode);
}

function isValidChannelCount(channelCount) {
    return Number.isInteger(channelCount) &&
        channelCount >= 0 &&
        channelCount <= config.maxChannelCount;
}

function validateDeviceInput(req, res) {
    const channelCount = Number(req.body.channelCount);
    if (
        typeof req.body.deviceId !== "string" ||
        req.body.deviceId.trim().length === 0 ||
        !isValidProductCode(req.body.productCode) ||
        !isValidChannelCount(channelCount)
    ) {
        res.status(400).json({
            success: false,
            message: `Invalid device details. Channel count must be between 0 and ${config.maxChannelCount}.`
        });
        return null;
    }
    return channelCount;
}

router.post("/create-user", (req, res) => {
    const { userid, username, password, role } = req.body;
    if (
        typeof userid !== "string" || userid.trim().length === 0 ||
        typeof username !== "string" || username.trim().length === 0 ||
        typeof password !== "string" || password.length < 8 ||
        !["user", "admin"].includes(role)
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid user details. Passwords must be at least 8 characters."
        });
    }
    database.createUser(
        userid,
        username,
        password,
        role,
        (err, userId) => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.message
                });
            }
            res.json({
                success: true,
                message: "User created successfully.",
                userId
            });
        }
    );
});

router.get("/users", (req, res) => {
    database.getAllUsers((err, users) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            users
        });
    });
});

router.delete("/user/:userid", (req, res) => {
    const userid = req.params.userid;
    if (userid === req.user.userid) {
        return res.status(400).json({
            success: false,
            message: "You cannot delete your own account."
        });
    }
    database.deleteUser(userid, (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            message: "User deleted successfully."
        });
    });
});

router.put("/user/:userid", (req, res) => {
    const userid = req.params.userid;
    const { username, password, role } = req.body;
    if (
        typeof username !== "string" || username.trim().length === 0 ||
        (password && (typeof password !== "string" || password.length < 8)) ||
        !["user", "admin"].includes(role)
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid user details. Passwords must be at least 8 characters."
        });
    }
    database.updateUser(
        userid,
        username,
        password,
        role,
        (err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Database error."
                });
            }
            res.json({
                success: true,
                message: "User updated successfully."
            });
        }
    );
});

router.get("/devices", (req, res) => {
    database.getAllDevices((err, devices) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            devices
        });
    });
});

router.post("/device/:deviceId/set-energy", (req, res) => {
    const deviceId = req.params.deviceId;
    const { energyKWh } = req.body;
    const value = Number(energyKWh);
    if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid energy value."
        });
    }
    database.getDevice(deviceId, (err, device) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found."
            });
        }
        const deviceData = mqtt.latestDevices.get(deviceId);
        if (!deviceData || !deviceData.connected) {
            return res.status(409).json({
                success: false,
                message: "Device is offline. Cannot send energy update."
            });
        }
        mqtt.setEnergy(deviceId, value)
            .then(() => {
                res.json({
                    success: true,
                    message: "Energy update sent to device."
                });
            })
            .catch((err) => {
                console.error("Set energy error:", err.message);
                res.status(500).json({
                    success: false,
                    message: "Failed to send energy update."
                });
            });
    });
});

router.post("/assign-device", (req, res) => {
    const {
        deviceId,
        userid,
        productCode,
        channelCount
    } = req.body;
    const validChannelCount = validateDeviceInput(req, res);
    if (validChannelCount === null) {
        return;
    }
    database.getUserByUserId(userid, (err, user) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }
        database.assignDevice(
            deviceId,
            user.user_id,
            productCode,
            validChannelCount,
            (err) => {
                if (err) {
                    return res.status(400).json({
                        success: false,
                        message: err.message
                    });
                }
                res.json({
                    success: true,
                    message: "Device assigned successfully."
                });
            }
        );
    });
});

router.put("/device/:deviceId", (req, res) => {
    const deviceId = req.params.deviceId;
    const {
        userid,
        productCode,
        channelCount
    } = req.body;
    const validChannelCount = validateDeviceInput(
        { body: { ...req.body, deviceId } },
        res
    );
    if (validChannelCount === null) {
        return;
    }
    database.getUserByUserId(userid, (err, user) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }
        database.updatedevice(
            deviceId,
            user.user_id,
            productCode,
            validChannelCount,
            (err) => {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        message: "Database error."
                    });
                }
                res.json({
                    success: true,
                    message: "Device updated successfully."
                });
            }
        );
    });
});

router.delete("/device/:deviceId", (req, res) => {
    const deviceId = req.params.deviceId;
    if (!deviceId || deviceId.trim().length === 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid device ID."
        });
    }
    database.getDevice(
        deviceId,
        (err, device) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Database error."
                });
            }
            if (!device) {
                return res.status(404).json({
                    success: false,
                    message: "Device not found."
                });
            }
            database.deleteDevice(
                deviceId,
                (err) => {
                    if (err) {
                        console.error(
                            `Failed to delete device ${deviceId}:`,
                            err.message
                        );
                        return res.status(500).json({
                            success: false,
                            message: "Database error."
                        });
                    }
                    mqtt.latestDevices.delete(deviceId);
                    if (mqtt.pendingWiFiRequests) {
                        mqtt.pendingWiFiRequests.delete(deviceId);
                    }
                    if (mqtt.lastDatabaseSave) {
                        mqtt.lastDatabaseSave.delete(deviceId);
                    }
                    if (mqtt.lastLoadHistorySave) {
                        mqtt.lastLoadHistorySave.delete(deviceId);
                    }
                    if (mqtt.dailyLoadFinalized) {
                        mqtt.dailyLoadFinalized.delete(deviceId);
                    }
                    return res.json({
                        success: true,
                        message: "Device deleted successfully."
                    });
                }
            );
        }
    );
});

router.get("/stats", (req, res) => {
    database.getAdminStats((err, stats) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            totalUsers: stats.totalUsers,
            totalDevices: stats.totalDevices
        });
    });
});

module.exports = router;
