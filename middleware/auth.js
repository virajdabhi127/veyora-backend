const jwt = require("jsonwebtoken");
const config = require("../config");
const database = require("../database");

function authenticate(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Authentication required."
        });
    }
    jwt.verify(token, config.jwt.secret, (err, decoded) => {
        if (err) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token."
            });
        }
        // Do not trust authorization data embedded in a long-lived token.
        // Looking up the current account revokes access immediately after an
        // account is deleted or its role is changed.
        database.getUser(decoded.userid, (dbErr, user) => {
            if (dbErr) {
                return res.status(500).json({
                    success: false,
                    message: "Authentication service unavailable."
                });
            }
            if (!user || user.user_id !== decoded.user_id) {
                return res.status(401).json({
                    success: false,
                    message: "Session is no longer valid."
                });
            }
            req.user = {
                user_id: user.user_id,
                userid: user.userid,
                username: user.username,
                role: user.role
            };
            next();
        });
    });
}
module.exports = authenticate;
