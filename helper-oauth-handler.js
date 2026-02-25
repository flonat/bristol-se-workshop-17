
const axios = require('axios');
const qs = require('qs');
const jwt = require('jsonwebtoken');


async function googleOauthHandler(req, res) {
    try {
        //get the code from query string
        const code = req.query.code;

        //get the id and access token with the code
        const tokens = await getGoogleAuthTokens(code);

        if (tokens == null) {
            return res.status(500).send('Error getting tokens');
        }
        //get user with tokens
        const googleUser = jwt.decode(tokens.id_token);
        // const googleUser = await getGoogleUserInfo(tokens.access_token);
        
        return {googleUser, tokens};

    } 
    catch (error) {
        console.error('Error handling Google OAuth:', error);
        return res.status(500).send('Error handling Google OAuth')
    }


}
exports.googleOauthHandler = googleOauthHandler;

async function getGoogleAuthTokens(code) {
    const url = 'https://oauth2.googleapis.com/token';
    let options = {
        code: code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
    }
    try {
        const res = await axios.post(url, qs.stringify(options), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        return res.data;

    } catch (error) {
        console.error('Error getting tokens:', error);
        return null;
    }
}

async function getGoogleUserInfo(access_token) {
    try {
        const res = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: {
                Authorization: `Bearer ${access_token}`
            }
        });
        return res.data;
    } 
    catch (error) {
        
    }
}


