const jwt = require("jsonwebtoken");
const preferences = require("../services/preferences");

module.exports = function check(req, res, next) {
    const token = req.cookies?.token;

    if (token) {
        jwt.verify(token, process.env.JWT_SECRET, (err, decodedtoken) => {
            if (err) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (!decodedtoken || decodedtoken.epoch !== preferences.getSessionEpoch()) {
                return res.status(401).json({ error: 'Session has been revoked' });
            }
            req.user = decodedtoken;
            next();
        });
    } else {
        return res.status(401).json({ error: 'Unauthorized' });
    }
};
