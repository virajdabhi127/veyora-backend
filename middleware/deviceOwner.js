const database = require("../database");

function requireDeviceOwner(req, res, next) {
    const { deviceId } = req.params;

    database.getUserDevice(
        deviceId,
        req.user.user_id,
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
            req.device = device;
            next();
        }
    );
}

module.exports = requireDeviceOwner;
