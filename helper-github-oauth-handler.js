const axios = require('axios');
const qs = require('qs');

// Handles the GitHub OAuth callback.
// 1. Exchanges the authorisation code for an access token via GitHub's token endpoint.
// 2. Uses the access token to fetch the user's profile from the GitHub API.
// 3. Fetches the user's primary email (since GitHub profile may not include it).
async function githubOauthHandler(req, res) {
    try {
        const code = req.query.code;

        // Exchange code for access token
        const tokens = await getGitHubAuthTokens(code);
        if (!tokens || !tokens.access_token) {
            return res.status(500).send('Error getting GitHub tokens');
        }

        // Get user profile
        const githubUser = await getGitHubUserInfo(tokens.access_token);

        // Get user email (may not be in profile if set to private)
        if (!githubUser.email) {
            const emails = await getGitHubUserEmails(tokens.access_token);
            const primary = emails.find(e => e.primary) || emails[0];
            if (primary) {
                githubUser.email = primary.email;
            }
        }

        return { githubUser, tokens };

    } catch (error) {
        console.error('Error handling GitHub OAuth:', error);
        return res.status(500).send('Error handling GitHub OAuth');
    }
}
exports.githubOauthHandler = githubOauthHandler;

async function getGitHubAuthTokens(code) {
    const url = 'https://github.com/login/oauth/access_token';
    const options = {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: code,
        redirect_uri: process.env.GITHUB_REDIRECT_URI
    };

    try {
        const res = await axios.post(url, qs.stringify(options), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            }
        });
        return res.data;
    } catch (error) {
        console.error('Error getting GitHub tokens:', error);
        return null;
    }
}

async function getGitHubUserInfo(accessToken) {
    try {
        const res = await axios.get('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });
        return res.data;
    } catch (error) {
        console.error('Error getting GitHub user info:', error);
        return null;
    }
}

async function getGitHubUserEmails(accessToken) {
    try {
        const res = await axios.get('https://api.github.com/user/emails', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });
        return res.data;
    } catch (error) {
        console.error('Error getting GitHub user emails:', error);
        return [];
    }
}
