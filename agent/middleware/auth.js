const jwt = require("jsonwebtoken");

module.exports = function check(req, res, next){
    const token = req.cookies?.token;

    if (token){
        jwt.verify(token, process.env.JWT_SECRET, (err, decodedtoken)=>{
            if (err){
                return res.status(401).json({ error: 'Unauthorized' })
            }
            else{
                req.user = decodedtoken
                next();
            }

        })
    }
    else{
        return res.status(401).json({ error: 'Unauthorized' })
    }
}