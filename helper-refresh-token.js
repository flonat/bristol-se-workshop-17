const axios = require('axios');
const qs = require('qs');

// Uses the refresh token to obtain a new access token from Google's token endpoint.
// This avoids forcing the user to re-authenticate when the access token expires.
async function refreshAccessToken(refreshToken) {
    const url = 'https://oauth2.googleapis.com/token';
    const options = {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
    };

    try {
        const res = await axios.post(url, qs.stringify(options), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        return res.data;
    } catch (error) {
        console.error('Error refreshing access token:', error.response?.data || error.message);
        return null;
    }
}

module.exports = { refreshAccessToken };
